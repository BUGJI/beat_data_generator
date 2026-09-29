import { BrowserWindow, clipboard, dialog, ipcMain, shell } from "electron";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import type {
  AudioFileResult,
  IpcOpenWindowOptions,
  MetronomeFile,
  RecentProject,
  SaveResult,
  SettingsData,
  TextFileResult,
  UpdateCheckResult,
  WelcomeAction,
} from "../shared/ipc";
import { sanitizeSettings } from "../shared/settings";
import {
  AUDIO_FILTERS,
  bytesToAudioResult,
  EDL_FILTERS,
  IMAGE_MIME,
  MAX_IMAGE_BYTES,
  PROJECT_FILTERS,
  sanitizeFilters,
  TEXT_FILTERS,
} from "./files";
import { mt, setMainLocale } from "./i18n";
import { joinDefaultDir, lastDirDefault, rememberDir } from "./lastDirs";
import log, { setFileLogging } from "./logger";
import { listMetronomeFiles, metronomeDir } from "./metronome";
import { applyProxyMode } from "./network";
import { addRecent, getRecents } from "./recents";
import { getSettings, persistSettings, setSettings } from "./settings";
import { checkUpdatesNow, checkUpdatesSilent } from "./updater";
import {
  closeDevToolsAll,
  handleWelcomeAction,
  markMainReady,
  refreshWindowTitles,
  win,
} from "./windows";

/** Registers every ipcMain handler. Call once, after `app.whenReady`. */
export function installIpc(): void {
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
      addRecent(filePath, title);
    },
  );

  ipcMain.handle("recents:get", (): RecentProject[] => getRecents());

  ipcMain.on("welcome:action", (_e, payload: WelcomeAction) => {
    handleWelcomeAction(payload);
  });

  ipcMain.handle("app:ready", (): void => {
    markMainReady();
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

  ipcMain.handle("settings:get", (): SettingsData => getSettings());

  ipcMain.handle(
    "settings:update",
    (_e, patch: Partial<SettingsData>): SettingsData => {
      const before = getSettings();
      const wasLogging = before.logToFile === true;
      const wasName = before.appName;
      const wasProxy = before.proxyMode;
      const wasCheckUpdates = before.checkUpdates;
      setSettings(sanitizeSettings({ ...before, ...patch }));
      persistSettings();
      const next = getSettings();
      setMainLocale(next.locale);
      if (next.proxyMode !== wasProxy) void applyProxyMode(next.proxyMode);
      if (next.appName !== wasName) refreshWindowTitles();
      const isLogging = next.logToFile === true;
      if (isLogging !== wasLogging) {
        setFileLogging(isLogging);
        if (isLogging) log.info("file logging enabled");
      }
      if (!next.devEnabled) closeDevToolsAll();
      // Only kick a network check when the toggle is switched on, not on every
      // unrelated settings write (startup already checks once).
      if (next.checkUpdates && !wasCheckUpdates) checkUpdatesSilent();
      return next;
    },
  );

  ipcMain.handle("dev:tools", (): void => {
    if (!getSettings().devEnabled) return;
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
