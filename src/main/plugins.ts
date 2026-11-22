import { app, shell } from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  watch as fsWatch,
} from "node:fs";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./jsonStore";
import log from "./logger";
import { IPC } from "../shared/ipc";
import {
  PLUGIN_API_VERSION,
  PLUGIN_API_VERSION_FALLBACK,
  resolveLocalizedText,
  type PluginEngines,
  type PluginEntry,
  type PluginManifest,
} from "../shared/plugin";
import { isInside, isSafeId } from "../shared/path";
import { broadcastToAllWindows } from "./windows";
import { handle } from "./ipcHandle";

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

export function userPluginsDir(): string {
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
  const raw = readJson<{ enabled?: unknown }>(statePath(), () => ({}));
  if (Array.isArray(raw.enabled)) {
    return {
      enabled: raw.enabled.filter(
        (x: unknown): x is string => typeof x === "string" && !!x,
      ),
    };
  }
  return { enabled: [] };
}

const loaded = new Map<string, LoadedPlugin>();
const state = readState();

function persistState(): void {
  writeJsonAtomic(statePath(), state);
}

function isEnabled(id: string): boolean {
  return state.enabled.includes(id);
}

/** Whether a plugin id is currently enabled (used by the marketplace). */
export function isPluginEnabled(id: string): boolean {
  return isEnabled(id);
}

// ---- manifest helpers ----

/** Coerce a manifest `apiVersion` to a positive integer, defaulting to 1. */
function normalizeApiVersion(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return PLUGIN_API_VERSION_FALLBACK;
  return Math.floor(n);
}

function readEngines(v: unknown): PluginEngines | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: PluginEngines = {};
  for (const [k, val] of Object.entries(v)) {
    if (typeof val === "string" && val.trim()) out[k] = val.trim();
  }
  return Object.keys(out).length ? out : undefined;
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
    const name = dir.slice(
      Math.max(dir.lastIndexOf("/"), dir.lastIndexOf("\\")) + 1,
    );
    return {
      id: name,
      version: "0.0.0",
      dir,
      displayName: name,
      names: {},
      descriptions: {},
      main: null,
      renderer: null,
      apiVersion: PLUGIN_API_VERSION_FALLBACK,
      compatible: true,
      enabled: false,
      error: `invalid manifest.json: ${String(err)}`,
    };
  }
  if (typeof manifest !== "object" || !manifest) return null;
  const id = typeof manifest.id === "string" ? manifest.id.trim() : "";
  // The id becomes a folder name and an IPC key; reject separators / reserved
  // names instead of letting a manifest address outside its own folder.
  if (!id || !isSafeId(id)) return null;
  const version =
    typeof manifest.version === "string" ? manifest.version : "0.0.0";
  const name = resolveLocalizedText(manifest.name);
  const description = resolveLocalizedText(manifest.description);
  const main =
    typeof manifest.main === "string" && manifest.main ? manifest.main : null;
  const renderer =
    typeof manifest.renderer === "string" && manifest.renderer
      ? manifest.renderer
      : null;
  const apiVersion = normalizeApiVersion(manifest.apiVersion);
  const compatible = apiVersion <= PLUGIN_API_VERSION;
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
    apiVersion,
    engines: readEngines(manifest.engines),
    compatible,
    enabled: isEnabled(id),
    ...(compatible
      ? {}
      : {
          error: `requires plugin API v${apiVersion}; this host supports up to v${PLUGIN_API_VERSION}`,
        }),
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
  const scoped = log.scope(`plugin:${entry.id}`);
  return {
    id: entry.id,
    dir: entry.dir,
    log: (...args: unknown[]) => scoped.info(...args),
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
  // A manifest entry (`"main": "../../x.js"`) must not escape its plugin folder.
  if (!isInside(entry.dir, full)) {
    entry.error = `main entry escapes the plugin folder: ${entry.main}`;
    return;
  }
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
          ? ((mod as { activate: unknown }).activate as (
              ...a: unknown[]
            ) => unknown)
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
    log.error(`[plugins] failed to load main.js of ${entry.id}`, err);
  }
}

function unloadMain(id: string): void {
  const h = loaded.get(id);
  if (!h) return;
  for (const fn of h.disposers) {
    try {
      fn();
    } catch (err) {
      log.error(`[plugins] dispose error for ${id}`, err);
    }
  }
  h.disposers.length = 0;
  h.handlers.clear();
  loaded.delete(id);
}

// ---- public manager surface ----

function refreshEnabled(): PluginEntry[] {
  const list = scanAll();
  // Do NOT prune enabled ids that are not currently discoverable. A plugin can
  // be transiently absent (a packaged run where the dev plugin folder isn't
  // scanned, a plugin being edited/renamed, a folder not yet synced). Persisting
  // the pruned list here would silently disable the plugin for good. Unknown
  // ids are simply inert until their plugin reappears.
  for (const entry of list) {
    if (entry.enabled && entry.main && entry.compatible) {
      unloadMain(entry.id);
      loadMain(entry);
    }
  }
  return list;
}

export function setEnabled(id: string, enabled: boolean): PluginEntry[] {
  const entry = scanAll().find((e) => e.id === id);
  if (!entry) return scanAll();
  if (enabled) {
    if (!state.enabled.includes(id)) state.enabled.push(id);
  } else {
    state.enabled = state.enabled.filter((x) => x !== id);
    unloadMain(id);
  }
  persistState();
  if (enabled && entry.main && entry.compatible) {
    unloadMain(id);
    loadMain(entry);
  }
  broadcastChanged();
  return scanAll().map((e) => ({ ...e }));
}

function broadcastChanged(): void {
  broadcastToAllWindows(IPC.pluginChanged);
}

/** Rescan plugin roots, (re)load enabled ones and notify renderers. */
export function rescanPlugins(): PluginEntry[] {
  const list = refreshEnabled();
  broadcastChanged();
  return list.map((e) => ({ ...e }));
}

/**
 * Watch the user plugins folder and hot-reload on change, so editing a
 * plugin's renderer.js applies without restarting the app. Changes are
 * debounced (editors often write several times per save).
 */
function installPluginWatcher(): void {
  const dir = userPluginsDir();
  let timer: NodeJS.Timeout | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        rescanPlugins();
        log.info("plugins: hot reload triggered");
      } catch (err) {
        log.warn("plugins: hot reload failed", err);
      }
    }, 250);
  };
  try {
    const watcher = fsWatch(dir, { recursive: true }, schedule);
    watcher.on("error", (err) => log.warn("plugins: watcher error", err));
    app.on("will-quit", () => {
      if (timer) clearTimeout(timer);
      watcher.close();
    });
  } catch (err) {
    // Recursive watching is unsupported on some platforms/filesystems.
    log.warn("plugins: watcher unavailable", err);
  }
}

export function installPluginManager(): void {
  mkdirSync(userPluginsDir(), { recursive: true });
  installPluginWatcher();

  handle("listPlugins", (): PluginEntry[] => scanAll().map((e) => ({ ...e })));

  handle(
    "setPluginEnabled",
    (_e, id: string, enabled: boolean): PluginEntry[] => {
      if (typeof id !== "string" || typeof enabled !== "boolean")
        return scanAll().map((e) => ({ ...e }));
      return setEnabled(id, enabled);
    },
  );

  handle("reloadPlugins", (): PluginEntry[] => {
    for (const id of [...loaded.keys()]) unloadMain(id);
    const list = refreshEnabled();
    broadcastChanged();
    return list.map((e) => ({ ...e }));
  });

  handle("readPluginRenderer", (_e, id: string): string | null => {
    if (typeof id !== "string" || !isSafeId(id)) return null;
    const entry = scanAll().find((e) => e.id === id);
    if (!entry?.renderer || !entry.enabled || !entry.compatible) return null;
    const full = join(entry.dir, entry.renderer);
    // Renderer source is read from disk and executed in the app page, so it
    // must stay inside the plugin folder.
    if (!isInside(entry.dir, full)) return null;
    try {
      return readFileSync(full, "utf-8");
    } catch {
      return null;
    }
  });

  handle("openPluginsFolder", (): void => {
    void shell.openPath(userPluginsDir());
  });

  handle(
    "invokePlugin",
    async (
      _e,
      id: string,
      method: string,
      args: unknown[],
    ): Promise<unknown> => {
      if (typeof id !== "string" || !isSafeId(id))
        throw new Error("invalid plugin id");
      if (typeof method !== "string" || !method)
        throw new Error("invalid plugin method");
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
