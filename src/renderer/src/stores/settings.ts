import { defineStore } from "pinia";
import { ref } from "vue";
import {
  applyTheme,
  decodeTheme,
  encodeTheme,
  resolveTheme,
  type ThemeOverrides,
} from "../theme";
import { engine } from "../engine";
import { loadMetronome } from "../services/audioIO";
import { useTransportStore } from "./transport";
import {
  defaultSettings,
  sanitizeSettings,
  type SettingsData,
} from "../../../shared/settings";
import { setFreeInput } from "../../../shared/limits";

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

/** Toggle global UI preferences that live as a root class (blur kill-switch). */
export function applyUiPreferences(): void {
  const s = useSettingsStore().settings;
  document.documentElement.classList.toggle("no-blur", s.uiBlur !== true);
}

export async function loadSettings(): Promise<void> {
  const store = useSettingsStore();
  try {
    const got = await window.api.getSettings();
    store.settings = sanitizeSettings({ ...store.settings, ...got });
    setFreeInput(store.settings.devFreeInput);
    useTransportStore().followManual = got.followPreset;
    if (got.metronomePath) void loadMetronome(got.metronomePath);
  } catch {
    /* fallback defaults */
  }
  applyThemeFromSettings();
  applyUiPreferences();
}

let settingsTimer: number | undefined;

export function patchSettings(patch: Partial<SettingsData>): void {
  const store = useSettingsStore();
  store.settings = sanitizeSettings({ ...store.settings, ...patch });
  setFreeInput(store.settings.devFreeInput);
  if ("themePreset" in patch || "themeOverrides" in patch)
    applyThemeFromSettings();
  if ("uiBlur" in patch) applyUiPreferences();
  if ("stretchEngine" in patch) engine.clearStretched();
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

/**
 * Live preview while a color control is being dragged: applies the override and
 * repaints immediately, but skips the full zod re-sanitize and the debounced
 * IPC write that `patchSettings` performs. Commit once on release with
 * `setThemeToken`.
 */
export function previewThemeToken(token: string, value: string): void {
  const store = useSettingsStore();
  const next: Record<string, string> = { ...store.settings.themeOverrides };
  if (value) next[token] = value;
  else delete next[token];
  store.settings.themeOverrides = next;
  applyThemeFromSettings();
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

/** Current theme (preset + overrides) as a compact shareable code. */
export function exportThemeCode(): string {
  const s = useSettingsStore().settings;
  return encodeTheme(s.themePreset, s.themeOverrides as ThemeOverrides);
}

/** Apply a theme code; returns false when the code can't be parsed. */
export function importThemeCode(code: string): boolean {
  const parsed = decodeTheme(code);
  if (!parsed) return false;
  patchSettings({
    themePreset: parsed.presetId,
    themeOverrides: parsed.overrides,
  });
  return true;
}

export function setSettingsOpen(open: boolean): void {
  useSettingsStore().settingsOpen = open;
}

export async function openDevTools(): Promise<void> {
  await window.api.toggleDevTools();
}
