import { defineStore } from "pinia";
import { ref } from "vue";
import { applyTheme, resolveTheme, type ThemeOverrides } from "../theme";
import { loadMetronome } from "../services/audioIO";
import { useTransportStore } from "./transport";
import {
  defaultSettings,
  sanitizeSettings,
  type SettingsData,
} from "../../../shared/settings";

/**
 * Persisted user settings plus the settings-dialog open flag.
 * Theme application is derived from `settings.themePreset` / `themeOverrides`.
 */
export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<SettingsData>(defaultSettings());
  const settingsOpen = ref(false);

  return { settings, settingsOpen };
});

/** Paint the active theme (preset + user overrides) onto the DOM and canvas. */
export function applyThemeFromSettings(): void {
  const s = useSettingsStore().settings;
  applyTheme(resolveTheme(s.themePreset, s.themeOverrides as ThemeOverrides));
}

export async function loadSettings(): Promise<void> {
  const store = useSettingsStore();
  try {
    const got = await window.api.getSettings();
    store.settings = sanitizeSettings({ ...store.settings, ...got });
    useTransportStore().followManual = got.followPreset;
    if (got.metronomePath) void loadMetronome(got.metronomePath);
  } catch {
    /* fallback defaults */
  }
  applyThemeFromSettings();
}

let settingsTimer: number | undefined;

export function patchSettings(patch: Partial<SettingsData>): void {
  const store = useSettingsStore();
  store.settings = sanitizeSettings({ ...store.settings, ...patch });
  if ("themePreset" in patch || "themeOverrides" in patch)
    applyThemeFromSettings();
  if (settingsTimer !== undefined) clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => {
    // IPC uses structured clone, which cannot serialize the reactive Proxies
    // held by nested settings values (e.g. themeOverrides). Settings are plain
    // JSON, so snapshot through JSON to send a clone-safe payload.
    const snapshot = JSON.parse(JSON.stringify(store.settings)) as SettingsData;
    void window.api.updateSettings(snapshot).catch((err) => {
      console.error("persist settings failed", err);
    });
  }, 180);
}

/** Switch to a preset; keeps existing per-token overrides on top of it. */
export function setThemePreset(id: string): void {
  patchSettings({ themePreset: id });
}

/** Set/clear one token override ("" removes it and falls back to the preset). */
export function setThemeToken(token: string, value: string): void {
  const store = useSettingsStore();
  const next: Record<string, string> = { ...store.settings.themeOverrides };
  if (value) next[token] = value;
  else delete next[token];
  patchSettings({ themeOverrides: next });
}

/** Drop all custom overrides, returning to the pure preset. */
export function resetThemeTokens(): void {
  patchSettings({ themeOverrides: {} });
}

export function setSettingsOpen(open: boolean): void {
  useSettingsStore().settingsOpen = open;
}

export async function openDevTools(): Promise<void> {
  await window.api.toggleDevTools();
}
