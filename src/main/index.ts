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
};
const settingsPath = (): string =>
  join(app.getPath("userData"), "settings.json");

function loadSettings(): void {
  try {
    const raw = JSON.parse(
      readFileSync(settingsPath(), "utf-8"),
    ) as Partial<SettingsData>;
    settings.closeMode =
      raw.closeMode === "minimize" || raw.closeMode === "close"
        ? raw.closeMode
        : "ask";
    settings.devEnabled = raw.devEnabled === true;
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
      if (patch.closeMode !== undefined) {
        settings.closeMode =
          patch.closeMode === "minimize" || patch.closeMode === "close"
            ? patch.closeMode
            : "ask";
      }
      if (patch.devEnabled !== undefined)
        settings.devEnabled = patch.devEnabled;
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
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
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

  mainWindow.on("ready-to-show", () => mainWindow?.show());

  mainWindow.on("close", (e) => {
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
