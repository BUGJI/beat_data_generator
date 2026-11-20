import { beatAtBarStartOf, timeOfBeat } from "../services/timeline";

/**
 * Parse a transport jump target:
 *   "1:23.456" / "83.456"  -> absolute time
 *   "b12.3" / "b12"        -> bar 12, beat 3 (1-based); bar only = bar 12 beat 1
 */
export function parseGoto(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  const barMatch = /^b\s*(\d+)(?:[.:](\d+(?:\.\d+)?))?$/.exec(text);
  if (barMatch) {
    const bar = Number(barMatch[1]);
    const beat = barMatch[2] === undefined ? 1 : Number(barMatch[2]);
    if (!Number.isFinite(bar) || !Number.isFinite(beat)) return null;
    return Math.max(
      0,
      timeOfBeat(beatAtBarStartOf(Math.max(1, bar)) + Math.max(1, beat) - 1),
    );
  }
  const parts = text.split(":");
  if (parts.length === 2) {
    const min = Number(parts[0]);
    const sec = Number(parts[1]);
    if (!Number.isFinite(min) || !Number.isFinite(sec)) return null;
    return Math.max(0, (min * 60 + sec) * 1000);
  }
  if (parts.length !== 1) return null;
  const sec = Number(text);
  return Number.isFinite(sec) ? Math.max(0, sec * 1000) : null;
}
