import { BrowserWindow, clipboard, ipcMain } from "electron";
import type {
  IpcOpenWindowOptions,
  RecentProject,
  SettingsData,
  UpdateCheckResult,
  WelcomeAction,
} from "../../shared/ipc";
import { IPC } from "../../shared/ipc";
import { sanitizeSettings } from "../../shared/settings";
import { handle } from "../ipcHandle";
import { setMainLocale } from "../i18n";
import log, { setFileLogging } from "../logger";
import { applyProxyMode } from "../network";
import { addRecent, getRecents } from "../recents";
import { getSettings, persistSettings, setSettings } from "../settings";
import { checkUpdatesNow, checkUpdatesSilent } from "../updater";
import {
  closeDevToolsAll,
  confirmQuitNow,
  handleWelcomeAction,
  markMainReady,
  refreshWindowTitles,
  setRendererDirty,
  win,
} from "../windows";

/** Settings, recents, app lifecycle, updates and miscellaneous window services. */
export function installAppIpc(): void {
  handle("recordRecent", (_e, filePath: string, title?: string): void => {
    addRecent(filePath, title);
  });

  handle("getRecents", (): RecentProject[] => getRecents());

  ipcMain.on(IPC.welcomeAction, (_e, payload: WelcomeAction) => {
    handleWelcomeAction(payload);
  });

  ipcMain.on(IPC.setDirty, (_e, dirty: boolean) => {
    setRendererDirty(dirty === true);
  });

  handle("confirmQuit", (): void => {
    confirmQuitNow();
  });

  handle("notifyAppReady", (): void => {
    markMainReady();
  });

  handle("getSettings", (): SettingsData => getSettings());

  handle("updateSettings", (_e, patch: Partial<SettingsData>): SettingsData => {
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
  });

  handle("toggleDevTools", (): void => {
    if (!getSettings().devEnabled) return;
    const w = win();
    if (!w) return;
    const wc = w.webContents;
    wc.closeDevTools();
    wc.openDevTools({ mode: "detach" });
  });

  handle("setZoom", (_e, factor: number): void => {
    const w = win();
    if (!w) return;
    const f = Math.min(1.5, Math.max(0.75, Number(factor) || 1));
    w.webContents.setZoomFactor(f);
  });

  handle(
    "checkForUpdates",
    (): Promise<UpdateCheckResult> => checkUpdatesNow(),
  );

  handle("writeClipboard", (_e, text: string): void => {
    clipboard.writeText(typeof text === "string" ? text : "");
  });

  handle("openWindow", (_e, opts: IpcOpenWindowOptions | undefined): void => {
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
  });
}
