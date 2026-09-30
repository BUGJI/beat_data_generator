import { z } from "zod";
import { isFreeInput, setFreeInput } from "./limits";

/**
 * Persisted settings contract.
 *
 * The zod schema is the single source of truth for defaults, coercion and
 * clamping; `SettingsData` is inferred from it so main and renderer cannot
 * drift. Parsing strips unknown keys and repairs out-of-range/invalid values
 * instead of throwing, which is what the old hand-written `sanitize` did.
 *
 * Key name is kept identical to the previous interface so IPC payloads are
 * byte-compatible.
 */

/** Bump to force migration of persisted settings defaults. */
export const SETTINGS_VERSION = 3;

/** Boolean that repairs to `def` for any non-boolean input. */
const bool = (def: boolean) => z.boolean().catch(def).default(def);

/** Integer clamped into [min, max] with a safe fallback (bypassed by free input). */
const intInRange = (def: number, min: number, max: number) =>
  z.coerce
    .number()
    .catch(def)
    .default(def)
    .transform((v) =>
      isFreeInput() ? v : Math.min(max, Math.max(min, Math.round(v))),
    );

export const CloseModeSchema = z.enum(["ask", "minimize", "close"]);

/** UI language preference; "auto" follows the OS/browser language. */
export const LocalePrefSchema = z
  .enum(["auto", "zh", "en", "ko"])
  .catch("auto")
  .default("auto");
export type LocalePref = z.infer<typeof LocalePrefSchema>;

/** How long the cached plugin-market index stays fresh. */
export const MarketCacheTtlSchema = z
  .enum(["1d", "3d", "7d", "30d"])
  .catch("3d")
  .default("3d");
export type MarketCacheTtl = z.infer<typeof MarketCacheTtlSchema>;

/** Duration in ms for each MarketCacheTtl value. */
export const MARKET_TTL_MS: Record<MarketCacheTtl, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** Proxy source for marketplace / update network requests. */
export const ProxyModeSchema = z
  .enum(["system", "env", "off"])
  .catch("system")
  .default("system");
export type ProxyMode = z.infer<typeof ProxyModeSchema>;

export const AlignRoundingSchema = z.enum(["round", "floor", "ceil"]);
export type AlignRounding = z.infer<typeof AlignRoundingSchema>;

/** How the background image fills the window. */
export const BackgroundFitSchema = z
  .enum(["cover", "contain", "tile"])
  .catch("cover")
  .default("cover");
export type BackgroundFit = z.infer<typeof BackgroundFitSchema>;

/** Pitch-preserving time-stretch backend. */
export const StretchEngineSchema = z
  .enum(["soundtouch", "signalsmith"])
  .catch("signalsmith")
  .default("signalsmith");
export type StretchEngine = z.infer<typeof StretchEngineSchema>;

export const SettingsSchema = z.object({
  closeMode: CloseModeSchema.catch("ask").default("ask"),
  /** UI language: a concrete locale, or "auto" to follow the OS/browser. */
  locale: LocalePrefSchema,
  /** Hide advanced categories/rows for a simpler first-run experience. */
  simpleMode: bool(true),
  /** custom application name; empty string uses the built-in default. */
  appName: z
    .string()
    .catch("")
    .default("")
    .transform((s) => s.slice(0, 48)),
  devEnabled: bool(false),
  devFreeInput: bool(false),
  /** write runtime logs to <userData>/logs/main.log (off by default). */
  logToFile: bool(false),
  /** time-stretch backend used when playing off-speed with pitch preserved. */
  stretchEngine: StretchEngineSchema,
  animEnabled: bool(true),
  /** animate UI surfaces (settings drawer/overlay, toasts, etc.). */
  uiMotion: bool(true),
  /** overall UI zoom in percent (75–150); applied via Electron page zoom. */
  uiZoom: intInRange(100, 75, 150),
  /** text scale in percent (85–150); multiplies every UI font size. */
  uiFontScale: intInRange(100, 85, 150),
  /** global backdrop blur; off removes every blur effect in the UI. */
  uiBlur: bool(true),
  /** backdrop blur radius in px (0–24) when uiBlur is on. */
  uiBlurAmount: intInRange(3, 0, 24),
  /** global corner radius in px (0–20) applied to controls and surfaces. */
  uiRadius: intInRange(6, 0, 20),
  /** shadow strength in percent (0–100); 0 = flat, 100 = heavy. */
  uiShadow: intInRange(50, 0, 100),
  /** Absolute path to a user-picked background image ("" = none). */
  backgroundImage: z
    .string()
    .catch("")
    .default("")
    .transform((s) => s.trim().slice(0, 1024)),
  /** How the background image fills the window. */
  backgroundFit: BackgroundFitSchema,
  /** Darkening overlay between the background image and the UI, in percent. */
  backgroundDim: intInRange(0, 0, 100),
  /** Gaussian blur applied to the background image, in px (0–40). */
  backgroundBlur: intInRange(0, 0, 40),
  /** Opacity of the main panel surfaces in percent (20–100); 100 = solid. */
  surfaceOpacity: intInRange(90, 20, 100),
  /** auto-hide dense beat grid lines when zoomed out to avoid slow rendering. */
  gridAutoHide: bool(true),
  /** silently check for updates on startup and notify when one is available. */
  checkUpdates: bool(true),
  /** how long the cached plugin-market index stays fresh before a refetch. */
  marketCacheTtl: MarketCacheTtlSchema,
  /** proxy source for marketplace / update network requests. */
  proxyMode: ProxyModeSchema,
  /** rewrite GitHub download URLs through a gh-proxy mirror to speed up downloads. */
  githubProxy: bool(false),
  /** gh-proxy host or base URL, e.g. "ghfast.top" or "https://ghfast.top". */
  githubProxyHost: z
    .string()
    .catch("ghfast.top")
    .default("ghfast.top")
    .transform((s) => s.trim().replace(/\/+$/, "").slice(0, 120)),
  followScroll: bool(true),
  followPercent: intInRange(90, 0, 100),
  followPreset: bool(false),
  /** Settings panel layout: docked right drawer or full-screen overlay. */
  settingsLayout: z.enum(["drawer", "full"]).catch("drawer").default("drawer"),
  /** Drawer width in px; 0 = auto (40% of the window). Clamped to 90vw at runtime. */
  settingsDrawerWidth: intInRange(0, 0, 4000),
  rememberWindow: bool(true),
  /** show the standalone welcome window at startup. */
  showWelcome: bool(true),
  autoSave: bool(true),
  autoSaveMinutes: intInRange(5, 1, 60),
  /** hold Ctrl when pressing Space to play at the current rate; plain Space plays at 1x. */
  ctrlSpeedPlay: bool(false),
  /** decimal places kept by the "align markers" action (0–6). */
  alignDecimals: intInRange(2, 0, 6),
  /** how "align markers" rounds each beat: nearest / toward zero / away. */
  alignRounding: AlignRoundingSchema.catch("round").default("round"),
  /** optional audio file played once each time a beat marker is passed (empty = disabled). */
  metronomePath: z.string().catch("").default(""),
  /** when true the metronome tracks the master volume; when false it uses metronomeVolume. */
  metronomeFollowMaster: bool(true),
  /** independent metronome volume in percent (0–100). */
  metronomeVolume: intInRange(85, 0, 100),
  settingsVersion: z.coerce.number().catch(0).default(0),
  /** On audio load, auto-detect BPM and apply to baseBpm (only when not locked). */
  audioAutoBpm: bool(true),
  /** On audio load, place markers at detected beats on a dedicated "auto beat" track. */
  audioAutoBeats: bool(true),
  /** On audio load, run loop detection and keep the best loop segment as a hint. */
  audioLoopDetect: bool(true),
  /** While playing, periodically refresh a live BPM readout (never modifies the project). */
  audioLiveBpm: bool(true),
  /** Compute and show a spectrum / mel spectrogram in the audio analysis panel. */
  audioSpectrum: bool(true),
  /** Show the audio analysis panel button in the top bar. */
  audioPanel: bool(true),
  /** Active theme preset id (see renderer src/theme.ts). */
  themePreset: z
    .string()
    .catch("default")
    .default("default")
    .transform((s) => s || "default"),
  /** Per-token color overrides on top of the preset (token name -> hex). */
  themeOverrides: z
    .record(z.string(), z.unknown())
    .catch({})
    .default({})
    .transform((o) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(o)) {
        // Keep only plausible color literals. Tokens are resolved by name, so
        // unknown keys are inert but would otherwise pile up in settings.json.
        if (typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v)) out[k] = v;
      }
      return out;
    }),
});

export type SettingsData = z.infer<typeof SettingsSchema>;

/** Fresh defaults (settingsVersion 0; callers may stamp SETTINGS_VERSION). */
export function defaultSettings(): SettingsData {
  return SettingsSchema.parse({});
}

/** Repair arbitrary persisted data into a complete, valid settings object. */
export function sanitizeSettings(raw: unknown): SettingsData {
  const input =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  // free-input intentionally disables the other numeric clamps, so it must be
  // in effect while the rest of the object is parsed.
  const prev = isFreeInput();
  setFreeInput((input as Record<string, unknown>).devFreeInput === true);
  try {
    return SettingsSchema.parse(input);
  } finally {
    setFreeInput(prev);
  }
}

/**
 * Apply version migrations to persisted data and return a fully parsed, repaired
 * settings object. Shared by the main and renderer processes so the migration
 * rules live in exactly one place; `changed` is true when the input was migrated
 * or its version stamped, so callers can persist the result.
 */
export function migrateSettings(raw: unknown): {
  data: SettingsData;
  changed: boolean;
} {
  const input: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  let changed = false;
  const fromVersion = Number(input.settingsVersion ?? 0);

  // v1 shipped with the auto audio-analysis toggles defaulting on. Reset them so
  // residual enabled values from those early builds stop auto-running on load.
  // Only v1 (< 2) needs this; later versions must not be reset again.
  if (fromVersion < 2) {
    input.audioAutoBpm = true;
    input.audioAutoBeats = false;
    input.audioLoopDetect = false;
    input.audioLiveBpm = false;
    input.audioSpectrum = false;
    input.audioPanel = true;
    changed = true;
  }
  if (fromVersion < SETTINGS_VERSION) {
    input.settingsVersion = SETTINGS_VERSION;
    changed = true;
  }
  return { data: sanitizeSettings(input), changed };
}
