/**
 * Playback visual-effect ids shared by the settings schema and the renderer.
 *
 * Adding an effect: append its id here, then provide a per-effect target
 * selector in `services/flash.ts`, a render consumer and its i18n label. The
 * persisted `beatFx` map needs no migration because unknown ids are dropped
 * and absent ids simply mean "off".
 */
export const BEAT_FX_IDS = ["laneGlow", "markerFlash"] as const;

export type BeatFxId = (typeof BEAT_FX_IDS)[number];

/** Persisted selection flags; a missing id means not checked. */
export type BeatFxFlags = Partial<Record<BeatFxId, boolean>>;

/** How long each effect's pulse stays visible after a marker is crossed. */
export const BEAT_FX_DURATION_MS: Record<BeatFxId, number> = {
  laneGlow: 100,
  markerFlash: 200,
};

/** A pulse records both its order and the wall-clock instant it fired. */
export interface BeatFxPulse {
  seq: number;
  at: number;
}
