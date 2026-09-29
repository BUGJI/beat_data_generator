import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  dialog,
  Menu,
  Notification,
  shell,
} from "electron";
import { autoUpdater } from "electron-updater";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, isAbsolute, join } from "node:path";
import { installPluginManager } from "./plugins";
import { installMarketManager } from "./market";
import { applyProxyMode } from "./network";
import { mt, setMainLocale } from "./i18n";
import log, { setFileLogging } from "./logger";
import {
  defaultSettings,
  sanitizeSettings,
  SETTINGS_VERSION,
} from "../shared/settings";
import type {
  AudioFileResult,
  IpcFileFilter,
  IpcOpenWindowOptions,
  MetronomeFile,
  RecentProject,
  SaveResult,
  SettingsData,
  TextFileResult,
  UpdateCheckResult,
  WelcomeAction,
} from "../shared/ipc";
const AUDIO_FILTERS = [
  {
    name: "Audio",
    extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"],
  },
];
const PROJECT_FILTERS = [{ name: "Beat Project", extensions: ["bdg", "json"] }];
const TEXT_FILTERS = [{ name: "Text", extensions: ["txt", "csv"] }];
const EDL_FILTERS = [{ name: "EDL", extensions: ["edl"] }];
const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};
/** Upper bound for a background image read over IPC (~16 MB). */
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

let mainWindow: BrowserWindow | null = null;
let welcomeWindow: BrowserWindow | null = null;
let mainReady = false;
const pendingWelcome: WelcomeAction[] = [];
let welcomeDialogOpen = false;
let welcomeCreated = false;
let welcomeFallbackTimer: ReturnType<typeof setTimeout> | null = null;
let allowQuit = false;
const recents: RecentProject[] = [];
const MAX_RECENTS = 9;

let settings: SettingsData = {
  ...defaultSettings(),
  settingsVersion: SETTINGS_VERSION,
};
const settingsPath = (): string =>
  join(app.getPath("userData"), "settings.json");
const lastDirsPath = (): string =>
  join(app.getPath("userData"), "last-dirs.json");
const recentsPath = (): string => join(app.getPath("userData"), "recents.json");

/** Effective application name: the user's custom name, else the built-in one. */
function appTitle(): string {
  const custom = settings.appName.trim();
  return custom || "Beat Data Generator";
}

// ---- metronome sounds folder ----
const METRONOME_EXTS = new Set([
  "mp3",
  "wav",
  "ogg",
  "flac",
  "m4a",
  "aac",
  "opus",
  "webm",
]);
const metronomeDir = (): string => join(app.getPath("userData"), "metronomes");

/** Audio files in the metronome folder, sorted and labelled without extension. */
function listMetronomeFiles(): MetronomeFile[] {
  try {
    const out: MetronomeFile[] = [];
    for (const e of readdirSync(metronomeDir(), { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const dot = e.name.lastIndexOf(".");
      if (dot <= 0) continue;
      if (!METRONOME_EXTS.has(e.name.slice(dot + 1).toLowerCase())) continue;
      out.push({ name: e.name.slice(0, dot), file: e.name });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  } catch {
    return [];
  }
}

/** Locate the metronome presets that ship with the app (dev or packaged). */
function bundledMetronomeDir(): string {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "metronomes")]
    : [
        join(app.getAppPath(), "resources", "metronomes"),
        join(process.cwd(), "resources", "metronomes"),
      ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0]!;
}

/** Copy bundled presets into the user's metronome folder (never overwriting). */
function seedMetronomePresets(): void {
  const dest = metronomeDir();
  try {
    mkdirSync(dest, { recursive: true });
    const src = bundledMetronomeDir();
    if (!existsSync(src)) return;
    for (const e of readdirSync(src, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const to = join(dest, e.name);
      if (existsSync(to)) continue;
      copyFileSync(join(src, e.name), to);
    }
  } catch (err) {
    log.error("[metronome] seed presets failed", err);
  }
}

function defaultRecentTitle(filePath: string): string {
  const b = basename(filePath);
  const dot = b.lastIndexOf(".");
  return dot > 0 ? b.slice(0, dot) : b;
}

function loadRecents(): void {
  try {
    const raw = JSON.parse(readFileSync(recentsPath(), "utf-8")) as unknown;
    if (!Array.isArray(raw)) return;
    recents.length = 0;
    for (const it of raw) {
      if (!it || typeof it !== "object") continue;
      const p = (it as RecentProject).path;
      const t = (it as RecentProject).title;
      if (typeof p === "string" && p) {
        recents.push({
          path: p,
          title: typeof t === "string" && t ? t : defaultRecentTitle(p),
        });
      }
    }
    recents.length = Math.min(recents.length, MAX_RECENTS);
  } catch {
    /* no saved recents yet */
  }
}

function persistRecents(): void {
  try {
    writeFileSync(recentsPath(), JSON.stringify(recents, null, 2), "utf-8");
  } catch (err) {
    log.error("persist recents failed", err);
  }
}

const lastDirs: { audio?: string; project?: string } = {};

function loadLastDirs(): void {
  try {
    const raw = JSON.parse(readFileSync(lastDirsPath(), "utf-8")) as {
      audio?: string;
      project?: string;
    };
    if (typeof raw.audio === "string") lastDirs.audio = raw.audio;
    if (typeof raw.project === "string") lastDirs.project = raw.project;
  } catch {
    /* no saved dirs yet */
  }
}

function rememberDir(kind: "audio" | "project", filePath: string): void {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (slash <= 0) return;
  lastDirs[kind] = filePath.slice(0, slash);
  try {
    writeFileSync(lastDirsPath(), JSON.stringify(lastDirs, null, 2), "utf-8");
  } catch {
    /* ignore */
  }
}

function lastDirDefault(kind: "audio" | "project"): string | undefined {
  return lastDirs[kind] ?? undefined;
}

function joinDefaultDir(
  kind: "audio" | "project",
  defaultPath: string,
  dirFromPath: string,
): string | undefined {
  const base = defaultPath.split(/[/]/).pop() || defaultPath;
  if (dirFromPath?.length) return join(dirFromPath, base);
  const dir = lastDirs[kind];
  return dir ? join(dir, base) : defaultPath;
}
const windowStatePath = (): string =>
  join(app.getPath("userData"), "window-state.json");

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

function loadWindowState(): WindowState | null {
  if (!settings.rememberWindow) return null;
  try {
    const raw = JSON.parse(
      readFileSync(windowStatePath(), "utf-8"),
    ) as Partial<WindowState>;
    const width = Number(raw.width);
    const height = Number(raw.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return {
      x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : undefined,
      y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : undefined,
      width,
      height,
      maximized: raw.maximized === true,
    };
  } catch {
    return null;
  }
}

function saveWindowState(): void {
  const w = mainWindow;
  if (!w || w.isDestroyed() || !settings.rememberWindow) return;
  const bounds = w.getNormalBounds();
  try {
    writeFileSync(
      windowStatePath(),
      JSON.stringify(
        {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          maximized: w.isMaximized(),
        },
        null,
        2,
      ),
      "utf-8",
    );
  } catch (err) {
    log.error("persist window state failed", err);
  }
}

function loadSettings(): void {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), "utf-8")) as Record<
      string,
      unknown
    >;
    let changed = false;
    const fromVersion = Number(raw.settingsVersion ?? 0);
    // Migration: v1 shipped with auto audio-analysis toggles defaulting on.
    // Reset the analysis toggles to their current defaults so residual
    // enabled values from those early builds stop auto-running on load.
    // Only v1 (< 2) needs this; later versions must not be reset again.
    if (fromVersion < 2) {
      raw.audioAutoBpm = true;
      raw.audioAutoBeats = false;
      raw.audioLoopDetect = false;
      raw.audioLiveBpm = false;
      raw.audioSpectrum = false;
      raw.audioPanel = true;
      changed = true;
    }
    if (fromVersion < SETTINGS_VERSION) {
      raw.settingsVersion = SETTINGS_VERSION;
      changed = true;
    }
    settings = sanitizeSettings(raw);
    if (changed) persistSettings();
  } catch {
    // no readable settings file yet: seed one with the defaults
    persistSettings();
  }
  setMainLocale(settings.locale);
}

function persistSettings(): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf-8");
  } catch (err) {
    log.error("persist settings failed", err);
  }
}

/**
 * The window dialogs should attach to: the main window when it is alive, else
 * the focused window, else any window. Preferring `mainWindow` avoids attaching
 * a dialog to the welcome / a plugin window when those happen to be enumerated
 * first.
 */
function win(): BrowserWindow | null {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return (
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  );
}

async function bytesToAudioResult(
  filePath: string,
  withMd5 = false,
): Promise<AudioFileResult> {
  const buf = await readFile(filePath);
  return {
    filePath,
    name: basename(filePath),
    size: buf.byteLength,
    data: new Uint8Array(buf),
    // Hash the bytes we already read so callers needing the MD5 (project audio
    // matching) never trigger a second full read of the file.
    md5: withMd5 ? createHash("md5").update(buf).digest("hex") : null,
  };
}

function closeDevToolsAll(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.closeDevTools();
}

function deliverWelcomeAction(action: WelcomeAction): void {
  if (mainReady && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("welcome:action", action);
  } else {
    pendingWelcome.push(action);
  }
}

/** Native "Save new project" dialog. Returns chosen path or null when cancelled. */
async function showNewProjectDialog(): Promise<string | null> {
  const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : win();
  if (!w || w.isDestroyed()) return null;
  const base = "untitled.bdg";
  const dir = lastDirs.project;
  const r = await dialog.showSaveDialog(w, {
    title: mt("saveNewProject"),
    defaultPath: dir ? join(dir, base) : base,
    filters: PROJECT_FILTERS,
  });
  if (r.canceled || !r.filePath) return null;
  rememberDir("project", r.filePath);
  return r.filePath;
}

/** Native "Open project" dialog. Returns chosen path or null when cancelled. */
async function showOpenProjectDialog(): Promise<string | null> {
  const w = mainWindow && !mainWindow.isDestroyed() ? mainWindow : win();
  if (!w || w.isDestroyed()) return null;
  const r = await dialog.showOpenDialog(w, {
    title: mt("openProject"),
    defaultPath: lastDirs.project,
    filters: PROJECT_FILTERS,
    properties: ["openFile"],
  });
  if (r.canceled || r.filePaths.length === 0) return null;
  rememberDir("project", r.filePaths[0]);
  return r.filePaths[0];
}

function requestQuit(w: BrowserWindow): void {
  const mode = settings.closeMode;
  if (mode === "close") {
    allowQuit = true;
    app.quit();
    return;
  }
  if (mode === "minimize") {
    if (!w.isMinimized()) w.minimize();
    return;
  }
  // ask
  void dialog
    .showMessageBox(w, {
      type: "question",
      title: appTitle(),
      message: mt("quitMessage", { name: appTitle() }),
      detail: "",
      buttons: [mt("quitButton"), mt("cancelButton")],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    .then(({ response }) => {
      if (response === 0) {
        allowQuit = true;
        app.quit();
      }
    });
}

function registerIpc(): void {
  ipcMain.handle("audio:open", async (): Promise<AudioFileResult | null> => {
    const w = win();
    if (!w) return null;
    const r = await dialog.showOpenDialog(w, {
      title: mt("openAudio"),
      defaultPath: lastDirDefault("audio"),
      filters: AUDIO_FILTERS,
      properties: ["openFile"],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    rememberDir("audio", r.filePaths[0]);
    return bytesToAudioResult(r.filePaths[0], true);
  });

  ipcMain.handle(
    "audio:read",
    async (_e, filePath: string): Promise<AudioFileResult | null> => {
      try {
        return await bytesToAudioResult(filePath, true);
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle("metronome:list", (): MetronomeFile[] => listMetronomeFiles());

  ipcMain.handle("metronome:open-folder", async (): Promise<void> => {
    const dir = metronomeDir();
    mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
  });

  ipcMain.handle(
    "metronome:read",
    async (_e, file: string): Promise<AudioFileResult | null> => {
      if (typeof file !== "string" || !file) return null;
      // New selections are file names inside the metronome folder; absolute
      // paths are still accepted so older settings keep working.
      const full = isAbsolute(file)
        ? file
        : join(metronomeDir(), basename(file));
      try {
        return await bytesToAudioResult(full);
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle("text:open", async (): Promise<TextFileResult> => {
    const w = win();
    if (!w) return { canceled: true };
    const r = await dialog.showOpenDialog(w, {
      title: mt("openProject"),
      defaultPath: lastDirDefault("project"),
      filters: PROJECT_FILTERS,
      properties: ["openFile"],
    });
    if (r.canceled || r.filePaths.length === 0) return { canceled: true };
    rememberDir("project", r.filePaths[0]);
    try {
      const content = await readFile(r.filePaths[0], "utf-8");
      return { canceled: false, filePath: r.filePaths[0], content };
    } catch (err) {
      log.error("open project failed", err);
      return { canceled: true };
    }
  });

  async function saveViaDialog(
    kind: "audio" | "project" | "export",
    title: string,
    defaultPath: string,
    filters: Electron.FileFilter[],
    content: string,
  ): Promise<SaveResult> {
    const w = win();
    if (!w) return { canceled: true };
    const memKind = kind === "export" ? "project" : kind;
    const slash = Math.max(
      defaultPath.lastIndexOf("/"),
      defaultPath.lastIndexOf("\\"),
    );
    const dirFromPath = slash > 0 ? defaultPath.slice(0, slash) : "";
    const proposed =
      memKind === "project"
        ? joinDefaultDir(memKind as "project", defaultPath, dirFromPath)
        : defaultPath;
    const r = await dialog.showSaveDialog(w, {
      title,
      defaultPath: proposed,
      filters,
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    if (kind !== "export") rememberDir(kind as "audio" | "project", r.filePath);
    await writeFile(r.filePath, content, "utf-8");
    return { canceled: false, filePath: r.filePath };
  }

  ipcMain.handle(
    "text:save",
    async (_e, defaultPath: string): Promise<SaveResult> => {
      // show the save dialog only; the caller writes afterwards so it can store
      // an audio name that is relative to the finally chosen folder.
      const slash = Math.max(
        defaultPath.lastIndexOf("/"),
        defaultPath.lastIndexOf("\\"),
      );
      const dirFromPath = slash > 0 ? defaultPath.slice(0, slash) : "";
      const proposed = joinDefaultDir("project", defaultPath, dirFromPath);
      const w = win();
      if (!w) return { canceled: true };
      const r = await dialog.showSaveDialog(w, {
        title: mt("saveProject"),
        defaultPath: proposed,
        filters: PROJECT_FILTERS,
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      rememberDir("project", r.filePath);
      return { canceled: false, filePath: r.filePath };
    },
  );

  ipcMain.handle(
    "text:saveAsTxt",
    (_e, defaultPath: string, content: string): Promise<SaveResult> =>
      saveViaDialog(
        "export",
        mt("exportTimestamps"),
        defaultPath,
        TEXT_FILTERS,
        content,
      ),
  );

  ipcMain.handle(
    "text:saveEdl",
    (_e, defaultPath: string, content: string): Promise<SaveResult> =>
      saveViaDialog(
        "export",
        mt("exportEdl"),
        defaultPath,
        EDL_FILTERS,
        content,
      ),
  );

  ipcMain.handle(
    "text:read",
    async (_e, filePath: string): Promise<TextFileResult> => {
      try {
        const content = await readFile(filePath, "utf-8");
        return { canceled: false, filePath, content };
      } catch {
        return { canceled: true };
      }
    },
  );

  ipcMain.handle(
    "text:write",
    async (_e, filePath: string, content: string): Promise<boolean> => {
      try {
        await writeFile(filePath, content, "utf-8");
        return true;
      } catch {
        return false;
      }
    },
  );

  ipcMain.handle(
    "recents:add",
    (_e, filePath: string, title?: string): void => {
      if (typeof filePath !== "string" || !filePath) return;
      const i = recents.findIndex((r) => r.path === filePath);
      if (i >= 0) recents.splice(i, 1);
      recents.unshift({
        path: filePath,
        title:
          typeof title === "string" && title.trim()
            ? title.trim()
            : defaultRecentTitle(filePath),
      });
      recents.length = Math.min(recents.length, MAX_RECENTS);
      persistRecents();
    },
  );

  ipcMain.handle("recents:get", (): RecentProject[] =>
    recents.map((r) => ({ ...r })),
  );

  ipcMain.on("welcome:action", (_e, payload: WelcomeAction) => {
    if (!(payload && typeof payload === "object" && "type" in payload)) {
      welcomeWindow?.close();
      welcomeWindow = null;
      mainWindow?.focus();
      return;
    }
    // close & focus first so any native dialog never stacks under the welcome
    welcomeWindow?.close();
    welcomeWindow = null;
    mainWindow?.focus();
    if (welcomeDialogOpen) return;
    if (payload.type === "new") {
      // keep the save dialog in main: guaranteed to appear, defaults to the
      // last used project folder and remembers the new one on success.
      welcomeDialogOpen = true;
      void showNewProjectDialog()
        .then((path) => {
          if (path) deliverWelcomeAction({ type: "new", path });
        })
        .finally(() => {
          welcomeDialogOpen = false;
        });
      return;
    }
    if (payload.type === "open") {
      // the open picker is also main-side so it always shows, even if the
      // renderer has not mounted / bound its welcome listener yet.
      welcomeDialogOpen = true;
      void showOpenProjectDialog()
        .then((path) => {
          if (path) deliverWelcomeAction({ type: "open", path });
        })
        .finally(() => {
          welcomeDialogOpen = false;
        });
      return;
    }
    // recent -> the renderer reads that file itself
    deliverWelcomeAction(payload);
  });

  ipcMain.handle("app:ready", (): void => {
    mainReady = true;
    if (pendingWelcome.length) {
      const pending = pendingWelcome.splice(0, pendingWelcome.length);
      for (const payload of pending) deliverWelcomeAction(payload);
    }
  });

  ipcMain.handle(
    "audio:md5",
    async (_e, filePath: string): Promise<string | null> => {
      try {
        const buf = await readFile(filePath);
        return createHash("md5").update(buf).digest("hex");
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    "file:path",
    async (_e, title: string): Promise<string | null> => {
      const w = win();
      if (!w) return null;
      const r = await dialog.showOpenDialog(w, {
        title,
        defaultPath: lastDirDefault("audio"),
        filters: AUDIO_FILTERS,
        properties: ["openFile"],
      });
      if (r.canceled || r.filePaths.length === 0) return null;
      rememberDir("audio", r.filePaths[0]);
      return r.filePaths[0];
    },
  );

  ipcMain.handle("settings:get", (): SettingsData => settings);

  ipcMain.handle(
    "settings:update",
    (_e, patch: Partial<SettingsData>): SettingsData => {
      const wasLogging = settings.logToFile === true;
      const wasName = settings.appName;
      const wasProxy = settings.proxyMode;
      const wasCheckUpdates = settings.checkUpdates;
      settings = sanitizeSettings({ ...settings, ...patch });
      persistSettings();
      setMainLocale(settings.locale);
      if (settings.proxyMode !== wasProxy)
        void applyProxyMode(settings.proxyMode);
      if (settings.appName !== wasName) {
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.setTitle(appTitle());
        if (welcomeWindow && !welcomeWindow.isDestroyed())
          welcomeWindow.setTitle(appTitle());
      }
      const isLogging = settings.logToFile === true;
      if (isLogging !== wasLogging) {
        setFileLogging(isLogging);
        if (isLogging) log.info("file logging enabled");
      }
      if (!settings.devEnabled) closeDevToolsAll();
      // Only kick a network check when the toggle is switched on, not on every
      // unrelated settings write (startup already checks once).
      if (settings.checkUpdates && !wasCheckUpdates) checkUpdatesSilent();
      return settings;
    },
  );

  ipcMain.handle("dev:tools", (): void => {
    if (!settings.devEnabled) return;
    const w = win();
    if (!w) return;
    const wc = w.webContents;
    wc.closeDevTools();
    wc.openDevTools({ mode: "detach" });
  });

  ipcMain.handle("ui:zoom", (_e, factor: number): void => {
    const w = win();
    if (!w) return;
    const f = Math.min(1.5, Math.max(0.75, Number(factor) || 1));
    w.webContents.setZoomFactor(f);
  });

  ipcMain.handle(
    "image:read-data-url",
    async (_e, filePath: unknown): Promise<string | null> => {
      if (typeof filePath !== "string" || !filePath) return null;
      const mime = IMAGE_MIME[extname(filePath).toLowerCase()];
      if (!mime) return null;
      try {
        const buf = await readFile(filePath);
        if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES)
          return null;
        return `data:${mime};base64,${buf.toString("base64")}`;
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    "updates:check",
    (): Promise<UpdateCheckResult> => checkUpdatesNow(),
  );

  ipcMain.handle("clipboard:write", (_e, text: string): void => {
    clipboard.writeText(typeof text === "string" ? text : "");
  });

  function sanitizeFilters(filters: unknown): Electron.FileFilter[] {
    if (!Array.isArray(filters)) return [];
    const out: Electron.FileFilter[] = [];
    for (const f of filters) {
      if (!f || typeof f !== "object") continue;
      const cand = f as Partial<IpcFileFilter>;
      if (typeof cand.name !== "string" || !cand.name) continue;
      const extensions = Array.isArray(cand.extensions)
        ? cand.extensions.filter(
            (x): x is string =>
              typeof x === "string" && /^[A-Za-z0-9]{1,8}$/.test(x),
          )
        : [];
      if (extensions.length) {
        out.push({
          name: cand.name,
          extensions: extensions.map((x) => x.toLowerCase()),
        });
      }
    }
    return out;
  }

  ipcMain.handle(
    "io:pick",
    async (_e, title: unknown, filters: unknown): Promise<string | null> => {
      const w = win();
      if (!w) return null;
      const r = await dialog.showOpenDialog(w, {
        title: typeof title === "string" && title ? title : "Open file",
        defaultPath: lastDirDefault("audio") ?? undefined,
        filters: sanitizeFilters(filters),
        properties: ["openFile"],
      });
      if (r.canceled || r.filePaths.length === 0) return null;
      return r.filePaths[0];
    },
  );

  ipcMain.handle(
    "io:save",
    async (
      _e,
      title: unknown,
      defaultPath: unknown,
      filters: unknown,
    ): Promise<SaveResult> => {
      const w = win();
      if (!w) return { canceled: true };
      const r = await dialog.showSaveDialog(w, {
        title: typeof title === "string" && title ? title : "Save file",
        defaultPath:
          typeof defaultPath === "string" && defaultPath
            ? defaultPath
            : "untitled",
        filters: sanitizeFilters(filters),
      });
      if (r.canceled || !r.filePath) return { canceled: true };
      return { canceled: false, filePath: r.filePath };
    },
  );

  ipcMain.handle(
    "win:open",
    (_e, opts: IpcOpenWindowOptions | undefined): void => {
      const width = Number(opts?.width);
      const height = Number(opts?.height);
      const w = new BrowserWindow({
        width: Number.isFinite(width) && width > 0 ? width : 900,
        height: Number.isFinite(height) && height > 0 ? height : 640,
        title: typeof opts?.title === "string" ? opts.title : "Plugin window",
        autoHideMenuBar: true,
        backgroundColor: "#101318",
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
        },
      });
      const url = typeof opts?.url === "string" ? opts.url : "";
      if (url) {
        void w.loadURL(url).catch(() => {
          w.close();
        });
      }
    },
  );
}

function scheduleWelcomeWindow(): void {
  if (welcomeCreated || !settings.showWelcome) return;
  const poll = setInterval(() => {
    if (mainReady) {
      clearInterval(poll);
      if (welcomeFallbackTimer) {
        clearTimeout(welcomeFallbackTimer);
        welcomeFallbackTimer = null;
      }
      createWelcomeWindow();
    }
  }, 200);
  welcomeFallbackTimer = setTimeout(() => {
    clearInterval(poll);
    welcomeFallbackTimer = null;
    createWelcomeWindow();
  }, 5000);
}

function createWelcomeWindow(): void {
  if (welcomeCreated || welcomeWindow) return;
  welcomeCreated = true;
  welcomeWindow = new BrowserWindow({
    width: 660,
    height: 520,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: "#101318",
    title: appTitle(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
    },
  });
  welcomeWindow.on("closed", () => {
    welcomeWindow = null;
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    welcomeWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/welcome.html`);
  } else {
    welcomeWindow.loadFile(join(__dirname, "../renderer/welcome.html"));
  }
}

function createWindow(): void {
  const state = loadWindowState();
  mainWindow = new BrowserWindow({
    x: state?.x,
    y: state?.y,
    width: state?.width ?? 1360,
    height: state?.height ?? 860,
    minWidth: 1024,
    minHeight: 660,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#15181c",
    title: appTitle(),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      // Restore the persisted interface zoom (setZoomFactor keeps it applied
      // for the lifetime of the window; the renderer updates it at runtime).
      zoomFactor: Math.min(1.5, Math.max(0.75, settings.uiZoom / 100)),
      // Keep rAF/timers alive while minimized so playback-driven work (metronome
      // clicks, follow scroll, beat flashes) keeps running instead of pausing
      // and then firing everything at once on restore.
      backgroundThrottling: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
    if (state?.maximized) mainWindow?.maximize();
    scheduleWelcomeWindow();
  });

  mainWindow.on("close", (e) => {
    if (mainWindow && allowQuit) saveWindowState();
    if (allowQuit || !mainWindow) return;
    e.preventDefault();
    requestQuit(mainWindow);
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  mainWindow.webContents.on(
    "render-process-gone",
    (_e, details: { reason: string; exitCode: number }) => {
      log.error(
        `renderer gone: reason=${details.reason} exitCode=${details.exitCode}`,
      );
    },
  );

  // Route renderer console output into the log file even in production, so a
  // build without DevTools still leaves a trail. Handles both the legacy
  // (event, level, message) and current (event, details) payloads.
  mainWindow.webContents.on("console-message", ((...args: unknown[]) => {
    const arg = args[1] as
      | { level?: string | number; message?: string }
      | number
      | undefined;
    let level: string | number | undefined;
    let message: string;
    if (arg && typeof arg === "object" && "message" in arg) {
      level = arg.level ?? undefined;
      message = arg.message ?? "";
    } else {
      level = arg as number | undefined;
      message = String(args[2] ?? "");
    }
    const text = `[renderer] ${String(message)}`;
    if (level === 3 || level === "error") log.error(text);
    else if (level === 2 || level === "warning") log.warn(text);
    else if (!app.isPackaged) log.info(text);
  }) as (event: unknown, level: number, message: string) => void);

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// ---- silent update check (opt-in via settings.checkUpdates) ----

let updaterReady = false;

function setupUpdater(): void {
  if (updaterReady) return;
  updaterReady = true;
  autoUpdater.logger = log;
  autoUpdater.autoDownload = false; // notify first, open the release page on click
  let notified = false;
  autoUpdater.on("update-available", (info) => {
    if (notified || !Notification.isSupported()) return;
    notified = true;
    const n = new Notification({
      title: mt("updateTitle", { name: appTitle() }),
      body: mt("updateBody", { version: info.version ?? "" }),
      silent: false,
    });
    n.on("click", () => {
      void shell.openExternal(
        "https://github.com/BUGJI/beat_data_generator/releases",
      );
    });
    n.show();
  });
  autoUpdater.on("error", (err) => {
    log.error("[updater]", err);
  });
}

function checkUpdatesSilent(): void {
  if (!settings.checkUpdates) return;
  setupUpdater();
  void autoUpdater.checkForUpdates().catch((err) => {
    log.error("[updater] check failed", err);
  });
}

/** User-triggered check (About page). Reports the outcome instead of only notifying. */
async function checkUpdatesNow(): Promise<UpdateCheckResult> {
  // electron-updater needs a packaged build with app-update.yml.
  if (!app.isPackaged) return { status: "unsupported" };
  setupUpdater();
  try {
    const res = await autoUpdater.checkForUpdates();
    const latest = res?.updateInfo?.version;
    if (latest && latest !== app.getVersion()) {
      return { status: "update", version: latest };
    }
    return { status: "current" };
  } catch (err) {
    log.error("[updater] manual check failed", err);
    return { status: "error" };
  }
}

app.whenReady().then(() => {
  loadSettings();
  seedMetronomePresets();
  setFileLogging(settings.logToFile === true);
  loadLastDirs();
  loadRecents();
  registerIpc();
  installPluginManager();
  installMarketManager({ getSettings: () => settings });
  void applyProxyMode(settings.proxyMode);
  checkUpdatesSilent();
  // remove the default app menu so pressing Alt no longer pops the File/Edit/View/Window bar
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("before-quit", (e) => {
    if (allowQuit || settings.closeMode === "close") return;
    e.preventDefault();
    if (mainWindow) requestQuit(mainWindow);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
