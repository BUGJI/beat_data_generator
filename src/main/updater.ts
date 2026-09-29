import { app, Notification, shell } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateCheckResult } from "../shared/ipc";
import { mt } from "./i18n";
import log from "./logger";
import { appTitle, getSettings } from "./settings";

/** Auto-update wiring: an opt-in silent check plus a user-triggered one. */

const RELEASES_URL = "https://github.com/BUGJI/beat_data_generator/releases";

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
      void shell.openExternal(RELEASES_URL);
    });
    n.show();
  });
  autoUpdater.on("error", (err) => {
    log.error("[updater]", err);
  });
}

export function checkUpdatesSilent(): void {
  if (!getSettings().checkUpdates) return;
  setupUpdater();
  void autoUpdater.checkForUpdates().catch((err) => {
    log.error("[updater] check failed", err);
  });
}

/** User-triggered check (About page). Reports the outcome instead of notifying. */
export async function checkUpdatesNow(): Promise<UpdateCheckResult> {
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
