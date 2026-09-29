import { app, BrowserWindow, Menu } from "electron";
import { installIpc } from "./ipc";
import { loadLastDirs } from "./lastDirs";
import { setFileLogging } from "./logger";
import { installMarketManager } from "./market";
import { seedMetronomePresets } from "./metronome";
import { applyProxyMode } from "./network";
import { installPluginManager } from "./plugins";
import { loadRecents } from "./recents";
import { getSettings, loadSettings } from "./settings";
import { checkUpdatesSilent } from "./updater";
import {
  createWindow,
  getMainWindow,
  isQuitAllowed,
  requestQuit,
} from "./windows";

/**
 * Main-process entry point: application lifecycle only. Everything else now
 * lives in focused modules (settings / recents / lastDirs / windowState /
 * metronome / files / windows / ipc / updater), wired together below.
 */

app.whenReady().then(() => {
  loadSettings();
  seedMetronomePresets();
  setFileLogging(getSettings().logToFile === true);
  loadLastDirs();
  loadRecents();
  installIpc();
  installPluginManager();
  installMarketManager({ getSettings });
  void applyProxyMode(getSettings().proxyMode);
  checkUpdatesSilent();
  // remove the default app menu so pressing Alt no longer pops the File/Edit/View/Window bar
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("before-quit", (e) => {
    if (isQuitAllowed() || getSettings().closeMode === "close") return;
    e.preventDefault();
    const w = getMainWindow();
    if (w) requestQuit(w);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
