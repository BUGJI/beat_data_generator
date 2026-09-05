import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { readFile, writeFile } from "fs/promises";
import { readFileSync, writeFileSync } from "fs";
import { basename, join } from "path";
import type {
  AudioFileResult,
  SaveResult,
  SettingsData,
  TextFileResult,
} from "../shared/ipc";

const AUDIO_FILTERS = [
  {
    name: "Audio",
    extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"],
  },
];
const PROJECT_FILTERS = [{ name: "Beat Project", extensions: ["json"] }];
const TEXT_FILTERS = [{ name: "Text", extensions: ["txt", "csv"] }];

let mainWindow: BrowserWindow | null = null;
let allowQuit = false;
let settings: SettingsData = {
  closeMode: "ask",
  devEnabled: false,
  followScroll: true,
  followPercent: 90,
  followPreset: false,
  rememberWindow: true,
};
const settingsPath = (): string =>
  join(app.getPath("userData"), "settings.json");
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
      filters: AUDIO_FILTERS,
      properties: ["openFile"],
    });
    if (r.canceled || r.filePaths.length === 0) return null;
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
      filters: PROJECT_FILTERS,
      properties: ["openFile"],
    });
    if (r.canceled || r.filePaths.length === 0) return { canceled: true };
    try {
      const content = await readFile(r.filePaths[0], "utf-8");
      return { canceled: false, filePath: r.filePaths[0], content };
    } catch (err) {
      console.error("open project failed", err);
      return { canceled: true };
    }
  });

  async function saveViaDialog(
    title: string,
    defaultPath: string,
    filters: Electron.FileFilter[],
    content: string,
  ): Promise<SaveResult> {
    const r = await dialog.showSaveDialog(win()!, {
      title,
      defaultPath,
      filters,
    });
    if (r.canceled || !r.filePath) return { canceled: true };
    await writeFile(r.filePath, content, "utf-8");
    return { canceled: false, filePath: r.filePath };
  }

  ipcMain.handle(
    "text:save",
    (_e, defaultPath: string, content: string): Promise<SaveResult> =>
      saveViaDialog("Save project", defaultPath, PROJECT_FILTERS, content),
  );

  ipcMain.handle(
    "text:saveAsTxt",
    (_e, defaultPath: string, content: string): Promise<SaveResult> =>
      saveViaDialog("Export timestamps", defaultPath, TEXT_FILTERS, content),
  );

  ipcMain.handle(
    "file:path",
    async (_e, title: string): Promise<string | null> => {
      const r = await dialog.showOpenDialog(win()!, {
        title,
        filters: AUDIO_FILTERS,
        properties: ["openFile"],
      });
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
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
