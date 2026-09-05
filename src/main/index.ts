import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { createHash } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import type {
  AudioFileResult,
  SaveResult,
  SettingsData,
  TextFileResult,
  WelcomeAction,
} from "../shared/ipc";

const AUDIO_FILTERS = [
  {
    name: "Audio",
    extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"],
  },
];
const PROJECT_FILTERS = [
  { name: "Beat Project", extensions: ["bdg", "json"] },
];
const TEXT_FILTERS = [{ name: "Text", extensions: ["txt", "csv"] }];

let mainWindow: BrowserWindow | null = null;
let welcomeWindow: BrowserWindow | null = null;
let mainReady = false;
const pendingWelcome: WelcomeAction[] = [];
let allowQuit = false;
const recents: string[] = [];
const MAX_RECENTS = 8;
let settings: SettingsData = {
  closeMode: "ask",
  devEnabled: false,
  followScroll: true,
  followPercent: 90,
  followPreset: false,
  rememberWindow: true,
  autoSave: true,
  autoSaveMinutes: 5,
};
const settingsPath = (): string =>
  join(app.getPath("userData"), "settings.json");
const lastDirsPath = (): string =>
  join(app.getPath("userData"), "last-dirs.json");

const lastDirs: { audio?: string; project?: string } = {};

function loadLastDirs(): void {
  try {
    const raw = JSON.parse(
      readFileSync(lastDirsPath(), "utf-8"),
    ) as { audio?: string; project?: string };
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
  const base = defaultPath.split(/[\/]/).pop() || defaultPath;
  if (dirFromPath && dirFromPath.length) return join(dirFromPath, base);
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
    console.error("persist window state failed", err);
  }
}

function sanitize(raw: Partial<SettingsData>): SettingsData {
  return {
    closeMode:
      raw.closeMode === "minimize" || raw.closeMode === "close"
        ? raw.closeMode
        : "ask",
    devEnabled: raw.devEnabled === true,
    followScroll: raw.followScroll !== false,
    followPercent: Math.min(
      100,
      Math.max(0, Math.round(raw.followPercent ?? 90)),
    ),
    followPreset: raw.followPreset === true,
    rememberWindow: raw.rememberWindow !== false,
    autoSave: raw.autoSave !== false,
    autoSaveMinutes: Math.min(
      60,
      Math.max(1, Math.round(raw.autoSaveMinutes ?? 5)),
    ),
  };
}

function loadSettings(): void {
  try {
    const raw = JSON.parse(
      readFileSync(settingsPath(), "utf-8"),
    ) as Partial<SettingsData>;
    settings = sanitize(raw);
  } catch {
    persistSettings();
  }
}

function persistSettings(): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf-8");
  } catch (err) {
    console.error("persist settings failed", err);
  }
}

function win(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null;
}

async function bytesToAudioResult(filePath: string): Promise<AudioFileResult> {
  const buf = await readFile(filePath);
  return {
    filePath,
    name: basename(filePath),
    size: buf.byteLength,
    data: new Uint8Array(buf),
  };
}

function closeDevToolsAll(): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.closeDevTools();
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
      title: "Beat Data Generator",
      message: "Exit Beat Data Generator?",
      detail: "",
      buttons: ["Quit", "Cancel"],
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
    const r = await dialog.showOpenDialog(win()!, {
      title: "Open audio file",
      defaultPath: lastDirDefault("audio"),
      filters: AUDIO_FILTERS,
      properties: ["openFile"],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
    rememberDir("audio", r.filePaths[0]);
    return bytesToAudioResult(r.filePaths[0]);
  });

  ipcMain.handle(
    "audio:read",
    async (_e, filePath: string): Promise<AudioFileResult | null> => {
      try {
        return await bytesToAudioResult(filePath);
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle("text:open", async (): Promise<TextFileResult> => {
    const r = await dialog.showOpenDialog(win()!, {
      title: "Open project",
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
      console.error("open project failed", err);
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
    const r = await dialog.showSaveDialog(win()!, {
      title,
      defaultPath: proposed,
      filters,
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    if (kind !== "export")
      rememberDir(kind as "audio" | "project", r.filePath);
    await writeFile(r.filePath, content, "utf-8");
    return { canceled: false, filePath: r.filePath };
  }

  ipcMain.handle(
    "text:save",
    (_e, defaultPath: string, content: string): Promise<SaveResult> =>
      saveViaDialog(
        "project",
        "Save project",
        defaultPath,
        PROJECT_FILTERS,
        content,
      ),
  );

  ipcMain.handle(
    "text:saveAsTxt",
    (_e, defaultPath: string, content: string): Promise<SaveResult> =>
      saveViaDialog(
        "export",
        "Export timestamps",
        defaultPath,
        TEXT_FILTERS,
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

  ipcMain.handle("recents:add", (_e, filePath: string): void => {
    if (typeof filePath !== "string" || !filePath) return;
    const i = recents.indexOf(filePath);
    if (i >= 0) recents.splice(i, 1);
    recents.unshift(filePath);
    recents.length = Math.min(recents.length, MAX_RECENTS);
  });

  ipcMain.handle("recents:get", (): string[] => [...recents]);

  ipcMain.on("welcome:action", (_e, payload: WelcomeAction) => {
    if (!(payload && typeof payload === "object" && "type" in payload)) {
      welcomeWindow?.close();
      welcomeWindow = null;
      mainWindow?.focus();
      return;
    }
    if (!mainReady || !mainWindow) {
      pendingWelcome.push(payload);
    } else {
      mainWindow.webContents.send("welcome:action", payload);
    }
    welcomeWindow?.close();
    welcomeWindow = null;
    mainWindow?.focus();
  });

  ipcMain.handle("app:ready", (): void => {
    mainReady = true;
    if (mainWindow && pendingWelcome.length) {
      const pending = pendingWelcome.splice(0, pendingWelcome.length);
      for (const payload of pending)
        mainWindow.webContents.send("welcome:action", payload);
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
      const r = await dialog.showOpenDialog(win()!, {
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
      settings = sanitize({ ...settings, ...patch });
      persistSettings();
      if (!settings.devEnabled) closeDevToolsAll();
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
}

function createWelcomeWindow(): void {
  if (welcomeWindow) return;
  welcomeWindow = new BrowserWindow({
    width: 660,
    height: 520,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    backgroundColor: "#101318",
    title: "Beat Data Generator",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
    },
  });
  welcomeWindow.on("closed", () => {
    welcomeWindow = null;
  });
  if (process.env["ELECTRON_RENDERER_URL"]) {
    welcomeWindow.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/welcome.html`,
    );
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
    title: "Beat Data Generator",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
    if (state?.maximized) mainWindow?.maximize();
    const t = setInterval(() => {
      if (mainReady) {
        clearInterval(t);
        createWelcomeWindow();
      }
    }, 200);
    setTimeout(() => {
      clearInterval(t);
      createWelcomeWindow();
    }, 5000);
  });

  mainWindow.on("close", (e) => {
    if (mainWindow && allowQuit) saveWindowState();
    if (allowQuit || !mainWindow) return;
    e.preventDefault();
    requestQuit(mainWindow);
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  if (process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.webContents.on("console-message", ((...args: unknown[]) => {
      const arg = args[1] as
        { level?: string | number; message?: string } | number | undefined;
      let level: string | number | undefined;
      let message: string;
      if (arg && typeof arg === "object" && "message" in arg) {
        level = arg.level ?? undefined;
        message = arg.message ?? "";
      } else {
        level = arg as number | undefined;
        message = String(args[2] ?? "");
      }
      if (
        level === 3 ||
        level === 2 ||
        level === "error" ||
        level === "warning"
      ) {
        console.log(`[renderer:${String(level)}] ${String(message)}`);
      }
    }) as (event: unknown, level: number, message: string) => void);
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  loadSettings();
  loadLastDirs();
  registerIpc();
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
