import { engine } from "../engine";
import { i18n } from "../i18n";
import { resetStretchFallback } from "../stretch";
import { loadMetronome } from "./audioIO";
import {
  applyAllSettingsEffects,
  applyAppName,
  applyBackgroundImage,
  applyEditorSessionDefaults,
  applyMetronomeSettings,
  applyThemeFromSettings,
  applyUiPreferences,
} from "./settingsEffects";
import { useSettingsStore } from "../stores/settings";
import { toast } from "../ui/toast";
import {
  defaultSettings,
  prepareImportedSettings,
  sanitizeSettings,
  SETTINGS_VERSION,
  type SettingsData,
} from "@shared/settings";

/**
 * Load/patch/commit/import of the persisted settings document. All runtime
 * side effects live in `settingsEffects.ts`; this module only owns the
 * debounce, sanitization and IPC write.
 */

/**
 * Side effects keyed by the setting that triggers them. Keeping the mapping
 * declarative means adding a new setting with a runtime side effect is one
 * table entry instead of another clause in a long `if (key in patch)` chain.
 */
const SETTINGS_EFFECTS: Partial<
  Record<keyof SettingsData, (s: SettingsData) => void>
> = {
  themePreset: () => applyThemeFromSettings(true),
  themeOverrides: () => applyThemeFromSettings(true),
  uiZoom: () => applyUiPreferences(),
  uiFontScale: () => applyUiPreferences(),
  uiMotion: () => applyUiPreferences(),
  menuMotion: () => applyUiPreferences(),
  themeCrossfade: () => applyUiPreferences(),
  motionSpeed: () => applyUiPreferences(),
  reduceMotion: () => applyUiPreferences(),
  uiBlur: () => applyUiPreferences(),
  uiBlurAmount: () => applyUiPreferences(),
  uiRadius: () => applyUiPreferences(),
  uiShadow: () => applyUiPreferences(),
  surfaceOpacity: () => applyUiPreferences(),
  backgroundFit: () => applyUiPreferences(),
  backgroundDim: () => applyUiPreferences(),
  backgroundBlur: () => applyUiPreferences(),
  backgroundImage: () => void applyBackgroundImage(),
  appName: () => applyAppName(),
  stretchEngine: () => {
    engine.clearStretched();
    resetStretchFallback();
  },
  stretchCacheMb: (s) =>
    engine.setStretchBudget(s.stretchCacheMb * 1024 * 1024),
  metronomeVolume: () => applyMetronomeSettings(),
  metronomeFollowMaster: () => applyMetronomeSettings(),
};

/** Merge a patch and run its side effects without scheduling a persist. */
export function previewSettings(patch: Partial<SettingsData>): void {
  const store = useSettingsStore();
  store.settings = { ...store.settings, ...patch };
  for (const key of Object.keys(SETTINGS_EFFECTS) as Array<
    keyof SettingsData
  >) {
    if (key in patch) SETTINGS_EFFECTS[key]?.(store.settings);
  }
}

let settingsTimer: number | undefined;

/**
 * Apply a patch right away so the UI stays snappy, but defer the (comparatively
 * expensive) full zod sanitize and the IPC write to a short debounce. Slider
 * drags fire many patches in a row; only the final value needs validating and
 * persisting.
 */
export function patchSettings(patch: Partial<SettingsData>): void {
  previewSettings(patch);
  if (settingsTimer !== undefined) clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(commitSettings, 180);
}

/** Sanitize the in-memory settings and flush them to the main process now. */
function commitSettings(): void {
  settingsTimer = undefined;
  const store = useSettingsStore();
  store.settings = sanitizeSettings(store.settings);
  // IPC uses structured clone, which cannot serialize the reactive Proxies
  // held by nested settings values (e.g. themeOverrides). Settings are plain
  // JSON, so snapshot through JSON to send a clone-safe payload.
  const snapshot = JSON.parse(JSON.stringify(store.settings)) as SettingsData;
  void window.api.updateSettings(snapshot).catch((err) => {
    console.error("persist settings failed", err);
  });
}

/** Flush a pending debounced write so a change isn't lost when the app closes. */
export function flushSettings(): void {
  if (settingsTimer === undefined) return;
  clearTimeout(settingsTimer);
  commitSettings();
}

if (typeof window !== "undefined")
  window.addEventListener("beforeunload", flushSettings);

export async function loadSettings(): Promise<void> {
  const store = useSettingsStore();
  try {
    const got = await window.api.getSettings();
    store.settings = sanitizeSettings({ ...store.settings, ...got });
    if (got.metronomePath) void loadMetronome(got.metronomePath);
  } catch {
    /* fallback defaults */
  }
  applyAllSettingsEffects(false);
  applyEditorSessionDefaults();

  // One-shot notice when the main process had to recover a corrupt file.
  try {
    const notice = await window.api.getSettingsNotice();
    if (notice?.kind === "backup-restored") {
      toast.warning(i18n.global.t("settings.recovery.backupRestored"), 6000);
    } else if (notice?.kind === "defaults-restored") {
      const key = notice.backupPath
        ? "settings.recovery.defaultsRestored"
        : "settings.recovery.defaultsRestoredNoPath";
      toast.warning(
        i18n.global.t(key, { path: notice.backupPath ?? "" }),
        6000,
      );
    }
  } catch {
    /* the recovery notice is best-effort */
  }
}

/** Replace the whole settings object, apply every runtime side effect and persist. */
function applyReplacedSettings(next: SettingsData): void {
  const store = useSettingsStore();
  const previousEngine = store.settings.stretchEngine;
  if (settingsTimer !== undefined) {
    clearTimeout(settingsTimer);
    settingsTimer = undefined;
  }
  store.settings = sanitizeSettings(next);
  applyAllSettingsEffects(true, previousEngine);
  void loadMetronome(store.settings.metronomePath);
  commitSettings();
}

/** Restore defaults while keeping the language and panel layout the user chose. */
export function resetSettings(): void {
  const current = useSettingsStore().settings;
  applyReplacedSettings({
    ...defaultSettings(),
    settingsVersion: SETTINGS_VERSION,
    locale: current.locale,
    simpleMode: current.simpleMode,
    settingsLayout: current.settingsLayout,
    settingsDrawerWidth: current.settingsDrawerWidth,
  });
}

/**
 * Import a settings JSON object. Dev flags are dropped and numbers are parsed
 * with free input disabled so an import cannot bypass the normal ranges.
 * Returns false when the object doesn't look like a settings file.
 */
export function importSettings(raw: unknown): boolean {
  const imported = prepareImportedSettings(raw);
  if (!imported) return false;
  const current = useSettingsStore().settings;
  applyReplacedSettings({
    ...imported,
    // Keep the panel where it is while the rest of the preferences change.
    settingsLayout: current.settingsLayout,
    settingsDrawerWidth: current.settingsDrawerWidth,
  });
  return true;
}
