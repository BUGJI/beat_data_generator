import { decodeTheme, encodeTheme, type ThemeOverrides } from "../theme";
import { useSettingsStore } from "../stores/settings";
import { patchSettings } from "./settingsPersistence";
import { applyThemeFromSettings } from "./settingsEffects";

/**
 * Theme preset/token actions. These are user-intent helpers over the settings
 * store; the actual repaint lives in `settingsEffects.ts`.
 */

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
  const next: Record<string, string> = {
    ...useSettingsStore().settings.themeOverrides,
  };
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
