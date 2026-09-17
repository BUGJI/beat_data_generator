import { z } from "zod";

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
export const SETTINGS_VERSION = 2;

/** Boolean that repairs to `def` for any non-boolean input. */
const bool = (def: boolean) => z.boolean().catch(def).default(def);

/** Integer clamped into [min, max] with a safe fallback. */
const intInRange = (def: number, min: number, max: number) =>
  z.coerce
    .number()
    .catch(def)
    .default(def)
    .transform((v) => Math.min(max, Math.max(min, Math.round(v))));

export const CloseModeSchema = z.enum(["ask", "minimize", "close"]);

export const AlignRoundingSchema = z.enum(["round", "floor", "ceil"]);
export type AlignRounding = z.infer<typeof AlignRoundingSchema>;

export const SettingsSchema = z.object({
  closeMode: CloseModeSchema.catch("ask").default("ask"),
  devEnabled: bool(false),
  devFreeInput: bool(false),
  animEnabled: bool(true),
  /** auto-hide dense beat grid lines when zoomed out to avoid slow rendering. */
  gridAutoHide: bool(true),
  /** silently check for updates on startup and notify when one is available. */
  checkUpdates: bool(true),
  followScroll: bool(true),
  followPercent: intInRange(90, 0, 100),
  followPreset: bool(false),
  rememberWindow: bool(true),
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
        if (typeof v === "string") out[k] = v;
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
  return SettingsSchema.parse(input);
}
