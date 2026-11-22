/**
 * Loudness policy for the marker beat click shared by the settings schema and
 * the audio engine.
 *
 * Identical click samples that start on the same AudioContext instant sum
 * linearly, so playing one copy per coincident marker makes the output grow
 * with the marker count (and clips once several tracks overlap). The engine
 * therefore plays a single source per instant and applies one of these total
 * gains instead.
 */
export const BEAT_OVERLAP_MODES = ["merge", "limit", "stack"] as const;

export type BeatOverlapMode = (typeof BEAT_OVERLAP_MODES)[number];

/** Hard ceiling for the "limit" mode, in linear amplitude. */
export const BEAT_CLICK_LIMIT_CAP = 1.6;

/**
 * Total amplitude for `count` coincident markers.
 *
 * - `merge`: constant single click; loudness never depends on the count.
 * - `limit`: grows sub-linearly with the count, then caps (keeps a subtle cue
 *   without the burst), leaving headroom for the output limiter.
 * - `stack`: legacy N copies, i.e. N× amplitude; the limiter protects peaks.
 */
export function totalClickGain(count: number, mode: BeatOverlapMode): number {
  const n = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  if (mode === "merge") return 1;
  if (mode === "stack") return n;
  return Math.min(BEAT_CLICK_LIMIT_CAP, Math.sqrt(n));
}
