import { app } from "electron";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  defaultSettings,
  migrateSettings,
  SETTINGS_VERSION,
  type SettingsData,
  type SettingsRecoveryNotice,
} from "../shared/settings";
import { setMainLocale } from "./i18n";
import log from "./logger";

/**
 * The single owner of persisted settings in the main process. Feature code reads
 * through {@link getSettings} and writes through {@link setSettings} +
 * {@link persistSettings} so every module observes the same current value.
 */

let current: SettingsData = {
  ...defaultSettings(),
  settingsVersion: SETTINGS_VERSION,
};

/** One-shot message for the renderer when the settings file had to be recovered. */
let recoveryNotice: SettingsRecoveryNotice | null = null;

export function getSettings(): SettingsData {
  return current;
}

export function setSettings(next: SettingsData): void {
  current = next;
}

/** Consume the recovery notice (the renderer asks once after startup). */
export function takeSettingsRecoveryNotice(): SettingsRecoveryNotice | null {
  const notice = recoveryNotice;
  recoveryNotice = null;
  return notice;
}

export function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

/** Effective application name: the user's custom name, else the built-in one. */
export function appTitle(): string {
  const custom = current.appName.trim();
  return custom || "Beat Data Generator";
}

interface JsonRead {
  exists: boolean;
  corrupt: boolean;
  value?: unknown;
}

function readJson(path: string): JsonRead {
  try {
    return {
      exists: true,
      corrupt: false,
      value: JSON.parse(readFileSync(path, "utf-8")) as unknown,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT")
      return { exists: false, corrupt: false };
    return { exists: true, corrupt: true };
  }
}

/** Keep an unreadable settings file for diagnosis instead of overwriting it. */
function preserveCorrupt(path: string): string | undefined {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${path}.corrupt-${stamp}.json`;
  try {
    renameSync(path, dest);
    return dest;
  } catch (err) {
    log.error("preserve unreadable settings failed", err);
    return undefined;
  }
}

/**
 * Write settings atomically (temp file + rename) and keep the previous good
 * file as `.bak`. `skipBackup` is used while recovering so a corrupt primary
 * cannot overwrite a valid backup.
 */
export function persistSettings(skipBackup = false): void {
  const path = settingsPath();
  const tmp = `${path}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(current, null, 2), "utf-8");
    if (!skipBackup && existsSync(path)) {
      try {
        copyFileSync(path, `${path}.bak`);
      } catch (err) {
        log.warn("settings backup failed", err);
      }
    }
    renameSync(tmp, path);
  } catch (err) {
    log.error("persist settings failed", err);
  }
}

/**
 * Read, migrate + sanitize persisted settings; persist back when changed.
 * A corrupt primary is preserved and either restored from `.bak` or reset to
 * defaults, with a one-shot notice for the renderer.
 */
export function loadSettings(): void {
  const path = settingsPath();
  const primary = readJson(path);

  if (primary.exists && primary.corrupt) {
    const backup = readJson(`${path}.bak`);
    const preserved = preserveCorrupt(path);
    if (backup.exists && !backup.corrupt) {
      const { data } = migrateSettings(backup.value);
      current = { ...data, settingsVersion: SETTINGS_VERSION };
      recoveryNotice = { kind: "backup-restored", backupPath: preserved };
      persistSettings(true);
      log.warn("settings unreadable; restored from backup", path, preserved);
    } else {
      current = { ...defaultSettings(), settingsVersion: SETTINGS_VERSION };
      recoveryNotice = { kind: "defaults-restored", backupPath: preserved };
      persistSettings(true);
      log.error(
        "settings unreadable and no valid backup; reset to defaults",
        path,
        preserved,
      );
    }
  } else if (!primary.exists) {
    // First launch (or settings.json was removed): seed defaults.
    current = { ...defaultSettings(), settingsVersion: SETTINGS_VERSION };
    persistSettings();
  } else {
    const { data, changed } = migrateSettings(primary.value);
    current = data;
    if (changed) persistSettings();
  }

  setMainLocale(current.locale);
}
