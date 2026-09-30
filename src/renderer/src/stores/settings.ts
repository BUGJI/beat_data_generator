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
import { applyLocalePreference, i18n } from "../i18n";
import { loadMetronome } from "../services/audioIO";
import { useTransportStore } from "./transport";
import {
  defaultSettings,
  sanitizeSettings,
  type SettingsData,
} from "@shared/settings";
import { setFreeInput } from "@shared/limits";

/**
 * Persisted user settings plus the settings-dialog open flag.
 * Theme application is derived from `settings.themePreset` / `themeOverrides`.
 */
export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<SettingsData>(defaultSettings());
  const settingsOpen = ref(false);

  return { settings, settingsOpen };
});

let themeAppliedOnce = false;
let themeAnimTimer: number | undefined;

/** Briefly enable color transitions on the whole UI so a theme switch crossfades. */
function triggerThemeTransition(): void {
  const root = document.documentElement;
  root.classList.add("theme-anim");
  if (themeAnimTimer !== undefined) clearTimeout(themeAnimTimer);
  themeAnimTimer = window.setTimeout(() => {
    root.classList.remove("theme-anim");
    themeAnimTimer = undefined;
  }, 320);
}

/**
 * Paint the active theme (preset + user overrides) onto the DOM and canvas.
 * `animate` crossfades the repaint; it is on for discrete switches (preset
 * change, commit, import) and off for the very first paint and for live drags,
 * where a 0.28s transition would lag behind the pointer.
 */
export function applyThemeFromSettings(animate = false): void {
  const s = useSettingsStore().settings;
  if (animate && themeAppliedOnce && s.uiMotion !== false)
    triggerThemeTransition();
  applyTheme(resolveTheme(s.themePreset, s.themeOverrides as ThemeOverrides));
  themeAppliedOnce = true;
}

let lastAppliedZoom = -1;

/**
 * Push appearance preferences (zoom / text scale / blur / radius / shadow) onto
 * the document root and the Electron page zoom.
 */
export function applyUiPreferences(): void {
  const s = useSettingsStore().settings;
  const root = document.documentElement;
  root.style.setProperty("--bdg-font-scale", `${s.uiFontScale / 100}`);
  root.style.setProperty(
    "--bdg-blur",
    s.uiBlur === true ? `blur(${s.uiBlurAmount}px)` : "none",
  );
  root.style.setProperty("--bdg-radius", `${s.uiRadius}px`);
  root.style.setProperty("--bdg-shadow", `rgba(0, 0, 0, ${s.uiShadow / 100})`);
  // Surface translucency (so a background image shows through panels).
  root.style.setProperty("--bdg-panel-alpha", `${s.surfaceOpacity / 100}`);
  // Background image layout / treatment (the image URL itself is async IPC).
  root.style.setProperty(
    "--bdg-bg-size",
    s.backgroundFit === "tile" ? "auto" : s.backgroundFit,
  );
  root.style.setProperty(
    "--bdg-bg-repeat",
    s.backgroundFit === "tile" ? "repeat" : "no-repeat",
  );
  root.style.setProperty("--bdg-bg-blur", `${s.backgroundBlur}px`);
  root.style.setProperty("--bdg-bg-dim", `${s.backgroundDim / 100}`);
  // Page zoom is applied in the main process; skip the IPC when it is unchanged
  // so text-scale drags don't trigger a full reflow on every tick.
  const zoom = s.uiZoom / 100;
  if (zoom !== lastAppliedZoom) {
    lastAppliedZoom = zoom;
    void window.api?.setZoom(zoom).catch(() => {
      /* window may not be ready yet; the next patch will retry */
    });
  }
}

let bgLoadToken = 0;

/** Resolved data URL of the active background image (null when unset/invalid). */
export const backgroundImageUrl = ref<string | null>(null);

/**
 * Load the user's background image (a local file path) as a data URL and expose
 * it to CSS through `--bdg-bg-image`. Missing or oversized files clear it.
 * A token guards against out-of-order async reads when the path changes fast.
 */
export async function applyBackgroundImage(): Promise<void> {
  const root = document.documentElement;
  const path = useSettingsStore().settings.backgroundImage;
  const token = ++bgLoadToken;
  if (!path) {
    root.style.removeProperty("--bdg-bg-image");
    backgroundImageUrl.value = null;
    return;
  }
  const url = await window.api.readImageAsDataUrl(path).catch(() => null);
  if (token !== bgLoadToken) return;
  if (url) {
    root.style.setProperty("--bdg-bg-image", `url("${url}")`);
    backgroundImageUrl.value = url;
  } else {
    root.style.removeProperty("--bdg-bg-image");
    backgroundImageUrl.value = null;
  }
}

/** Effective application name: the user's override, else the localized default. */
export function appDisplayName(): string {
  const custom = useSettingsStore().settings.appName.trim();
  return custom || i18n.global.t("app.name");
}

/** Mirror the effective name onto the document (drives the Electron window title). */
export function applyAppName(): void {
  document.title = appDisplayName();
}

/** Push metronome volume / follow-master settings into the audio engine. */
function applyMetronomeSettings(): void {
  const s = useSettingsStore().settings;
  engine.setMetronomeFollowsMaster(s.metronomeFollowMaster);
  engine.setMetronomeVolume(s.metronomeVolume / 100);
}

export async function loadSettings(): Promise<void> {
  const store = useSettingsStore();
  try {
    const got = await window.api.getSettings();
    store.settings = sanitizeSettings({ ...store.settings, ...got });
    setFreeInput(store.settings.devFreeInput);
    // Settings own the language preference; apply it before any themed UI text
    // or the app name is resolved.
    applyLocalePreference(store.settings.locale);
    useTransportStore().followManual = got.followPreset;
    if (got.metronomePath) void loadMetronome(got.metronomePath);
  } catch {
    /* fallback defaults */
  }
  applyThemeFromSettings();
  applyUiPreferences();
  void applyBackgroundImage();
  applyMetronomeSettings();
  applyAppName();
}

let settingsTimer: number | undefined;

/**
 * Apply a patch right away so the UI stays snappy, but defer the (comparatively
 * expensive) full zod sanitize and the IPC write to a short debounce. Slider
 * drags fire many patches in a row; only the final value needs validating and
 * persisting.
 */
export function patchSettings(patch: Partial<SettingsData>): void {
  const store = useSettingsStore();
  store.settings = { ...store.settings, ...patch };
  setFreeInput(store.settings.devFreeInput);
  if ("locale" in patch) applyLocalePreference(store.settings.locale);
  if ("themePreset" in patch || "themeOverrides" in patch)
    applyThemeFromSettings(true);
  if (
    "uiZoom" in patch ||
    "uiFontScale" in patch ||
    "uiBlur" in patch ||
    "uiBlurAmount" in patch ||
    "uiRadius" in patch ||
    "uiShadow" in patch ||
    "surfaceOpacity" in patch ||
    "backgroundFit" in patch ||
    "backgroundDim" in patch ||
    "backgroundBlur" in patch
  )
    applyUiPreferences();
  if ("backgroundImage" in patch) void applyBackgroundImage();
  if ("appName" in patch) applyAppName();
  if ("stretchEngine" in patch) engine.clearStretched();
  if ("metronomeVolume" in patch || "metronomeFollowMaster" in patch)
    applyMetronomeSettings();
  if (settingsTimer !== undefined) clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(commitSettings, 180);
}

/** Sanitize the in-memory settings and flush them to the main process now. */
function commitSettings(): void {
  settingsTimer = undefined;
  const store = useSettingsStore();
  store.settings = sanitizeSettings(store.settings);
  setFreeInput(store.settings.devFreeInput);
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
