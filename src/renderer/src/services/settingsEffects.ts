import { ref } from "vue";
import { engine } from "../engine";
import { applyLocalePreference, i18n } from "../i18n";
import { resetStretchFallback } from "../stretch";
import { applyTheme, resolveTheme, type ThemeOverrides } from "../theme";
import { useSettingsStore } from "../stores/settings";
import { useTransportStore } from "../stores/transport";
import { useUiStore } from "../stores/ui";
import { useViewStore } from "../stores/view";
import { setHistoryLimit } from "./history";
import { applyMotionPreferences, reduceMotionActive } from "./motion";
import type { StretchEngine } from "@shared/settings";

/**
 * Runtime side effects of the persisted settings: painting the theme and
 * appearance tokens onto the DOM, loading the background image, the app title,
 * the metronome/engine knobs, and the locale.
 *
 * Kept out of the store so the store stays plain state and this module can be
 * imported by persistence/theme actions without forming a cycle.
 */

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
  if (animate && themeAppliedOnce && s.themeCrossfade && !reduceMotionActive())
    triggerThemeTransition();
  applyTheme(resolveTheme(s.themePreset, s.themeOverrides as ThemeOverrides));
  themeAppliedOnce = true;
}

let lastAppliedZoom = -1;
let zoomRequestId = 0;
let zoomRetries = 0;
let zoomRetryTimer: number | undefined;

/**
 * Apply the page-zoom factor, retrying a few times when the window is not ready
 * yet. The applied value is recorded only after the IPC succeeds so a failed
 * first attempt is not treated as "already applied".
 */
function applyPageZoom(zoom: number): void {
  if (zoom === lastAppliedZoom) return;
  const requestId = ++zoomRequestId;
  void window.api?.setZoom(zoom).then(
    () => {
      if (requestId === zoomRequestId) {
        lastAppliedZoom = zoom;
        zoomRetries = 0;
      }
    },
    () => {
      if (requestId !== zoomRequestId) return;
      lastAppliedZoom = -1;
      if (zoomRetries >= 3) return;
      zoomRetries += 1;
      if (zoomRetryTimer === undefined) {
        zoomRetryTimer = window.setTimeout(() => {
          zoomRetryTimer = undefined;
          applyUiPreferences();
        }, 250 * zoomRetries);
      }
    },
  );
}

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
  applyPageZoom(s.uiZoom / 100);
  // Motion speed / reduce-motion / per-surface switches become CSS variables.
  applyMotionPreferences();
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
export function applyMetronomeSettings(): void {
  const s = useSettingsStore().settings;
  engine.setMetronomeFollowsMaster(s.metronomeFollowMaster);
  engine.setMetronomeVolume(s.metronomeVolume / 100);
}

/**
 * Apply every runtime effect of the current settings. `previousStretchEngine`
 * lets a replacement clear stretched buffers only when the engine actually
 * changed. Shared by first load and by import/reset so the two paths cannot
 * drift.
 */
export function applyAllSettingsEffects(
  animateTheme: boolean,
  previousStretchEngine?: StretchEngine,
): void {
  const s = useSettingsStore().settings;
  if (
    previousStretchEngine !== undefined &&
    s.stretchEngine !== previousStretchEngine
  ) {
    engine.clearStretched();
    resetStretchFallback();
  }
  engine.setStretchBudget(s.stretchCacheMb * 1024 * 1024);
  applyLocalePreference(s.locale);
  applyThemeFromSettings(animateTheme);
  applyUiPreferences();
  void applyBackgroundImage();
  applyMetronomeSettings();
  applyAppName();
  useTransportStore().followManual = s.followPreset;
}

/**
 * Seed the editor's session-only state from the "startup default" settings.
 * Called once after settings load: changing these preferences later affects the
 * next session, not the current one. Live parameters (magnet distance, undo
 * limit, …) are read directly where they are used instead.
 */
export function applyEditorSessionDefaults(): void {
  const s = useSettingsStore().settings;
  const view = useViewStore();
  const ui = useUiStore();
  const transport = useTransportStore();
  view.snapEnabled = s.snapByDefault;
  view.magnetEnabled = s.magnetByDefault;
  view.pxPerSec = s.defaultZoom;
  ui.quickPlace = s.quickPlaceByDefault;
  ui.timeAlign = s.timeAlignByDefault;
  transport.pitchFollow = s.pitchFollowByDefault;
  transport.rate = s.defaultRate;
  setHistoryLimit(s.undoLimit);
}
