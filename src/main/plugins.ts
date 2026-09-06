import { app, BrowserWindow, ipcMain, shell } from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import type {
  PluginEntry,
  PluginManifest,
} from "../shared/plugin";

/**
 * Main-process plugin manager.
 *
 * Responsibilities:
 *   - discover plugins by scanning plugin root folders
 *   - persist which plugin ids are enabled
 *   - load/unload a plugin's optional main.js entry (full Node access)
 *   - serve renderer sources and route renderer -> main free-form calls
 *
 * Plugin main entry contract (CommonJS):
 *   module.exports = function activate(ctx) { ... }
 * ctx provides: { id, dir, log, registerHandler(name, fn), onDispose(fn) }
 */

interface PluginContext {
  id: string;
  dir: string;
  log: (...args: unknown[]) => void;
  registerHandler: (name: string, fn: (...args: unknown[]) => unknown) => void;
  onDispose: (fn: () => void) => void;
}

interface LoadedPlugin {
  handlers: Map<string, (...args: unknown[]) => unknown>;
  disposers: Array<() => void>;
}

const USER_PLUGIN_DIR = "plugins";
const STATE_FILE = "plugins-state.json";

function userPluginsDir(): string {
  return join(app.getPath("userData"), USER_PLUGIN_DIR);
}

function pluginRoots(): string[] {
  const roots: string[] = [userPluginsDir()];
  // In development, also scan <project>/plugins so bundled samples can be
  // exercised directly from the repository without copying them first.
  if (!app.isPackaged) {
    const dev = join(app.getAppPath(), "plugins");
    if (existsSync(dev)) roots.push(dev);
  }
  return roots;
}

function statePath(): string {
  return join(app.getPath("userData"), STATE_FILE);
}

interface PluginState {
  enabled: string[];
}

function readState(): PluginState {
  try {
    const raw = JSON.parse(readFileSync(statePath(), "utf-8")) as {
      enabled?: unknown;
    };
    if (Array.isArray(raw.enabled)) {
      return {
        enabled: raw.enabled.filter(
          (x): x is string => typeof x === "string" && !!x,
        ),
      };
    }
  } catch {
    /* no state yet */
  }
  return { enabled: [] };
}

const loaded = new Map<string, LoadedPlugin>();
const state = readState();

function persistState(): void {
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error("[plugins] persist state failed", err);
  }
}

function isEnabled(id: string): boolean {
  return state.enabled.includes(id);
}

// ---- manifest helpers ----

function resolveText(
  v: unknown,
): { fallback: string; i18n: Record<string, string> } {
  if (typeof v === "string" && v.trim()) {
    return { fallback: v.trim(), i18n: {} };
  }
  if (v && typeof v === "object") {
    const i18n: Record<string, string> = {};
    let fallback = "";
    for (const [loc, val] of Object.entries(v)) {
      if (typeof val === "string" && val.trim()) {
        i18n[loc] = val.trim();
        if (loc === "en" && !fallback) fallback = i18n[loc] as string;
      }
    }
    if (!fallback) {
      const zh = i18n["zh"];
      if (zh) fallback = zh;
    }
    return { fallback, i18n };
  }
  return { fallback: "", i18n: {} };
}

function scanPluginDir(dir: string): PluginEntry | null {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  let manifest: PluginManifest;
  try {
    manifest = JSON.parse(
      readFileSync(manifestPath, "utf-8"),
    ) as PluginManifest;
  } catch (err) {
    const name = dir.slice(Math.max(dir.lastIndexOf("/"), dir.lastIndexOf("\\")) + 1);
    return {
      id: name,
      version: "0.0.0",
      dir,
      displayName: name,
      names: {},
      descriptions: {},
      main: null,
      renderer: null,
      enabled: false,
      error: `invalid manifest.json: ${String(err)}`,
    };
  }
  if (typeof manifest !== "object" || !manifest) return null;
  const id = typeof manifest.id === "string" ? manifest.id.trim() : "";
  if (!id) return null;
  const version = typeof manifest.version === "string" ? manifest.version : "0.0.0";
  const name = resolveText(manifest.name);
  const description = resolveText(manifest.description);
  const main = typeof manifest.main === "string" && manifest.main ? manifest.main : null;
  const renderer =
    typeof manifest.renderer === "string" && manifest.renderer ? manifest.renderer : null;
  return {
    id,
    version,
    dir,
    displayName: name.fallback || id,
    names: name.i18n,
    description: description.fallback || undefined,
    descriptions: description.i18n,
    main,
    renderer,
    enabled: isEnabled(id),
  };
}

// ---- scanning ----

function scanAll(): PluginEntry[] {
  const out: PluginEntry[] = [];
  const seen = new Set<string>();
  for (const root of pluginRoots()) {
    if (!existsSync(root)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of names) {
      const dir = join(root, name);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      const entry = scanPluginDir(dir);
      if (!entry) continue;
      if (seen.has(entry.id)) continue; // first root wins
      seen.add(entry.id);
      out.push(entry);
    }
  }
  return out;
}

// ---- loading / unloading main.js ----

function makeContext(entry: PluginEntry): PluginContext {
  let h = loaded.get(entry.id);
  if (!h) {
    h = {
      handlers: new Map<string, (...args: unknown[]) => unknown>(),
      disposers: [],
    };
    loaded.set(entry.id, h);
  }
  return {
    id: entry.id,
    dir: entry.dir,
    log: (...args: unknown[]) =>
      console.log(`[plugin:${entry.id}]`, ...args),
    registerHandler: (name, fn) => {
      h.handlers.set(name, fn);
    },
    onDispose: (fn) => {
      h.disposers.push(fn);
    },
  };
}

function loadMain(entry: PluginEntry): void {
  if (!entry.main) return;
  const full = join(entry.dir, entry.main);
  try {
    if (!existsSync(full)) {
      entry.error = `main entry missing: ${entry.main}`;
      return;
    }
    delete require.cache[full];
    const mod = require(full) as unknown;
    const activate =
      typeof mod === "function"
        ? mod
        : mod && typeof (mod as { activate?: unknown }).activate === "function"
          ? ((mod as { activate: unknown }).activate as (...a: unknown[]) => unknown)
          : undefined;
    if (typeof activate !== "function") {
      entry.error = "main entry must export a function or { activate(ctx) }";
      return;
    }
    const ctx = makeContext(entry);
    const ret = activate(ctx);
    if (ret && typeof (ret as Promise<unknown>).then === "function") {
      entry.error =
        "main activate() returned a promise; keep it synchronous so enable/disable stays reliable";
    }
  } catch (err) {
    entry.error = String(err);
    console.error(`[plugins] failed to load main.js of ${entry.id}`, err);
  }
}

function unloadMain(id: string): void {
  const h = loaded.get(id);
  if (!h) return;
  for (const fn of h.disposers) {
    try {
      fn();
    } catch (err) {
      console.error(`[plugins] dispose error for ${id}`, err);
    }
  }
  h.disposers.length = 0;
  h.handlers.clear();
  loaded.delete(id);
}

// ---- public manager surface ----

function refreshEnabled(): PluginEntry[] {
  const list = scanAll();
  const nextEnabled = state.enabled.filter((id) =>
    list.some((e) => e.id === id),
  );
  if (nextEnabled.length !== state.enabled.length) {
    state.enabled = nextEnabled;
    persistState();
  }
  // load main.js for every currently enabled plugin that offers one
  for (const entry of list) {
    if (entry.enabled && entry.main) {
      unloadMain(entry.id);
      loadMain(entry);
    }
  }
  return list;
}

function setEnabled(id: string, enabled: boolean): PluginEntry[] {
  const entry = scanAll().find((e) => e.id === id);
  if (!entry) return scanAll();
  if (enabled) {
    if (!state.enabled.includes(id)) state.enabled.push(id);
  } else {
    state.enabled = state.enabled.filter((x) => x !== id);
    unloadMain(id);
  }
  persistState();
  if (enabled && entry.main) {
    unloadMain(id);
    loadMain(entry);
  }
  broadcastChanged();
  return scanAll().map((e) => ({ ...e }));
}

function broadcastChanged(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("plugin:changed");
  }
}

export function installPluginManager(): void {
  mkdirSync(userPluginsDir(), { recursive: true });

  ipcMain.handle("plugins:list", (): PluginEntry[] =>
    scanAll().map((e) => ({ ...e })),
  );

  ipcMain.handle(
    "plugins:set-enabled",
    (_e, id: string, enabled: boolean): PluginEntry[] => {
      if (typeof id !== "string" || typeof enabled !== "boolean")
        return scanAll().map((e) => ({ ...e }));
      return setEnabled(id, enabled);
    },
  );

  ipcMain.handle("plugins:reload", (): PluginEntry[] => {
    for (const id of [...loaded.keys()]) unloadMain(id);
    const list = refreshEnabled();
    broadcastChanged();
    return list.map((e) => ({ ...e }));
  });

  ipcMain.handle(
    "plugins:renderer-source",
    (_e, id: string): string | null => {
      if (typeof id !== "string") return null;
      const entry = scanAll().find((e) => e.id === id);
      if (!entry || !entry.renderer || !entry.enabled) return null;
      const full = join(entry.dir, entry.renderer);
      try {
        return readFileSync(full, "utf-8");
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle("plugins:open-folder", (): void => {
    void shell.openPath(userPluginsDir());
  });

  ipcMain.handle(
    "plugins:invoke",
    async (
      _e,
      id: string,
      method: string,
      args: unknown[],
    ): Promise<unknown> => {
      const h = loaded.get(id);
      const fn = h?.handlers.get(method);
      if (!fn) throw new Error(`plugin ${id} has no handler "${method}"`);
      return fn(...(Array.isArray(args) ? args : []));
    },
  );

  // load main entries of plugins enabled from a previous session
  refreshEnabled();
}

export type { PluginContext };
