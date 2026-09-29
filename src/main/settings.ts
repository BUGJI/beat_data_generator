import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultSettings,
  migrateSettings,
  SETTINGS_VERSION,
  type SettingsData,
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

export function getSettings(): SettingsData {
  return current;
}

export function setSettings(next: SettingsData): void {
  current = next;
}

export function settingsPath(): string {
  return join(app.getPath("userData"), "settings.json");
}

/** Effective application name: the user's custom name, else the built-in one. */
export function appTitle(): string {
  const custom = current.appName.trim();
  return custom || "Beat Data Generator";
}

export function persistSettings(): void {
  try {
    writeFileSync(settingsPath(), JSON.stringify(current, null, 2), "utf-8");
  } catch (err) {
    log.error("persist settings failed", err);
  }
}

/** Read, migrate + sanitize persisted settings; persist back only when changed. */
export function loadSettings(): void {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), "utf-8")) as unknown;
    const { data, changed } = migrateSettings(raw);
    current = data;
    if (changed) persistSettings();
  } catch {
    // no readable settings file yet: seed one with the defaults
    persistSettings();
  }
  setMainLocale(current.locale);
}
