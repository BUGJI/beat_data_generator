import type { BpmPoint } from "./types";
import { lastAtOrBefore } from "./utils/search";

/**
 * Meter (beats per bar) regions derived from the global beats-per-bar plus
 * optional per-BPM point overrides. A point with `beatsPerBar` starts a new
 * region that lasts until the next explicit override (points without one
 * inherit and do not reset). Each region also carries the global bar index at
 * its start so bar numbers stay continuous across meter changes.
 */

export const DEFAULT_BEATS_PER_BAR = 4;

export interface MeterSegment {
  beatStart: number;
  beatEnd: number | null;
  beatsPerBar: number;
  /** True when this segment comes from an explicit BPM-point meter override. */
  override: boolean;
  /** Zero-based global bar index at `beatStart`. */
  barStart: number;
}

/** Coerce a beats-per-bar value to an integer in 1..16, or fall back. */
export function normalizeBeatsPerBar(
  raw: unknown,
  fallback = DEFAULT_BEATS_PER_BAR,
): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(16, Math.max(1, Math.round(n)));
}

/** Build ordered meter regions from the global beats-per-bar and overrides. */
export function buildMeterSegments(
  baseBeatsPerBar: number,
  bpmPoints: BpmPoint[],
): MeterSegment[] {
  const base = normalizeBeatsPerBar(baseBeatsPerBar);
  const changes: Array<{ beat: number; beatsPerBar: number }> = [];
  for (const p of bpmPoints) {
    if (!Number.isFinite(p.beat) || p.beat <= 0 || p.beatsPerBar == null)
      continue;
    const per = normalizeBeatsPerBar(p.beatsPerBar, Number.NaN);
    if (!Number.isFinite(per)) continue;
    changes.push({ beat: p.beat, beatsPerBar: per });
  }
  changes.sort((a, b) => a.beat - b.beat);

  const segs: MeterSegment[] = [];
  let start = 0;
  let per = base;
  let override = false;
  let barStart = 0;
  for (const c of changes) {
    if (c.beat <= start) continue;
    // No meter change: keep the current region and let later points decide.
    if (c.beatsPerBar === per) continue;
    segs.push({
      beatStart: start,
      beatEnd: c.beat,
      beatsPerBar: per,
      override,
      barStart,
    });
    barStart += Math.ceil((c.beat - start) / per);
    start = c.beat;
    per = c.beatsPerBar;
    override = true;
  }
  segs.push({
    beatStart: start,
    beatEnd: null,
    beatsPerBar: per,
    override,
    barStart,
  });
  return segs;
}

/** Effective meter and override state at a beat. */
export interface MeterInfoAt {
  beatsPerBar: number;
  override: boolean;
}

/** Bar and in-bar position at a beat, using the active meter region. */
export interface BarInfoAt extends MeterInfoAt {
  /** One-based global bar number. */
  bar: number;
  /** Zero-based beat offset inside the current bar. */
  inBar: number;
  segment: MeterSegment;
}

function segmentAt(segments: MeterSegment[], beat: number): MeterSegment {
  const i = Math.max(
    0,
    lastAtOrBefore(segments, (s) => s.beatStart, beat),
  );
  return segments[i]!;
}

/** Effective bar / in-bar position at a beat. */
export function barInfoAt(segments: MeterSegment[], beat: number): BarInfoAt {
  if (!segments.length) {
    const per = DEFAULT_BEATS_PER_BAR;
    const b = Math.max(0, beat);
    const idx = Math.floor(b / per);
    return {
      bar: idx + 1,
      inBar: b - idx * per,
      beatsPerBar: per,
      override: false,
      segment: {
        beatStart: 0,
        beatEnd: null,
        beatsPerBar: per,
        override: false,
        barStart: 0,
      },
    };
  }
  const seg = segmentAt(segments, beat);
  const off = Math.max(0, beat - seg.beatStart);
  const idx = Math.floor(off / seg.beatsPerBar + 1e-9);
  return {
    bar: seg.barStart + idx + 1,
    inBar: off - idx * seg.beatsPerBar,
    beatsPerBar: seg.beatsPerBar,
    override: seg.override,
    segment: seg,
  };
}

/** Effective meter at a beat. */
export function meterInfoAt(
  segments: MeterSegment[],
  beat: number,
): MeterInfoAt {
  if (!segments.length)
    return { beatsPerBar: DEFAULT_BEATS_PER_BAR, override: false };
  const seg = segmentAt(segments, beat);
  return { beatsPerBar: seg.beatsPerBar, override: seg.override };
}

/** Effective beats per bar at a beat. */
export function beatsPerBarAt(segments: MeterSegment[], beat: number): number {
  return meterInfoAt(segments, beat).beatsPerBar;
}

/** True when the beat lands exactly on a bar line. */
export function isBarStartAt(segments: MeterSegment[], beat: number): boolean {
  return Math.abs(barInfoAt(segments, beat).inBar) < 1e-6;
}

/** Beat of the given one-based bar number. */
export function beatAtBarStart(segments: MeterSegment[], bar: number): number {
  const target = Math.max(1, Math.floor(bar));
  if (!segments.length) return (target - 1) * DEFAULT_BEATS_PER_BAR;
  for (const seg of segments) {
    const segBars =
      seg.beatEnd === null
        ? Number.POSITIVE_INFINITY
        : Math.ceil((seg.beatEnd - seg.beatStart) / seg.beatsPerBar);
    if (target <= seg.barStart + segBars) {
      const idx = Math.max(0, target - seg.barStart - 1);
      return seg.beatStart + idx * seg.beatsPerBar;
    }
  }
  const last = segments[segments.length - 1]!;
  return last.beatStart + (target - last.barStart - 1) * last.beatsPerBar;
}

/** Bar lines intersecting an inclusive beat range, in beat order. */
export function barStartsInRange(
  segments: MeterSegment[],
  loBeat: number,
  hiBeat: number,
): Array<{ beat: number; bar: number }> {
  const out: Array<{ beat: number; bar: number }> = [];
  if (!segments.length) {
    const first = Math.floor(loBeat / DEFAULT_BEATS_PER_BAR);
    const last = Math.ceil(hiBeat / DEFAULT_BEATS_PER_BAR);
    for (let k = first; k <= last; k++) {
      const beat = k * DEFAULT_BEATS_PER_BAR;
      if (beat < loBeat || beat > hiBeat) continue;
      out.push({ beat, bar: k + 1 });
    }
    return out;
  }
  for (const seg of segments) {
    const segEnd = seg.beatEnd ?? Number.POSITIVE_INFINITY;
    if (segEnd < loBeat || seg.beatStart > hiBeat) continue;
    const per = seg.beatsPerBar;
    const firstK = Math.max(0, Math.floor((loBeat - seg.beatStart) / per));
    const lastK = Math.ceil((hiBeat - seg.beatStart) / per);
    for (let k = firstK; k <= lastK; k++) {
      const beat = seg.beatStart + k * per;
      if (beat < loBeat - 1e-9 || beat > hiBeat + 1e-9) continue;
      if (beat < 0) continue;
      if (seg.beatEnd !== null && beat >= seg.beatEnd - 1e-9) continue;
      out.push({ beat, bar: seg.barStart + k + 1 });
    }
  }
  out.sort((a, b) => a.beat - b.beat);
  return out;
}
