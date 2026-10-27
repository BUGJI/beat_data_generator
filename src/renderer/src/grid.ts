import { DEFAULT_DIV } from "./metrics";
import type { BpmPoint } from "./types";

/**
 * Beat-grid regions derived from the global subdivision plus optional per-BPM
 * point overrides. A point with `gridDiv` starts a new region that lasts until
 * the next explicit override (points without `gridDiv` inherit and do not reset).
 */

export interface GridSegment {
  beatStart: number;
  beatEnd: number | null;
  div: number;
  /** True when this segment comes from an explicit BPM-point grid override. */
  override: boolean;
}

/** Coerce a subdivision to a positive number, or fall back. */
export function normalizeGridDiv(raw: unknown, fallback = DEFAULT_DIV): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Parse a user-entered subdivision (`4`, `1/4`) into a denominator. */
export function parseGridDenominator(raw: string | number): number | null {
  if (typeof raw === "number")
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  const m = /^(?:1\/)?(\d+(?:\.\d+)?)$/.exec(raw.trim());
  if (!m) return null;
  const d = Number(m[1]);
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** Build ordered grid regions from the global division and BPM-point overrides. */
export function buildGridSegments(
  baseDiv: number,
  bpmPoints: BpmPoint[],
): GridSegment[] {
  const base = normalizeGridDiv(baseDiv);
  const changes: Array<{ beat: number; div: number }> = [];
  for (const p of bpmPoints) {
    if (!Number.isFinite(p.beat) || p.beat <= 0 || p.gridDiv == null) continue;
    const div = normalizeGridDiv(p.gridDiv, Number.NaN);
    if (!Number.isFinite(div)) continue;
    changes.push({ beat: p.beat, div });
  }
  changes.sort((a, b) => a.beat - b.beat);

  const segs: GridSegment[] = [];
  let start = 0;
  let div = base;
  let override = false;
  for (const c of changes) {
    if (c.beat <= start) continue;
    // No visual change: keep the current region and let later points decide.
    if (c.div === div) continue;
    segs.push({ beatStart: start, beatEnd: c.beat, div, override });
    start = c.beat;
    div = c.div;
    override = true;
  }
  segs.push({ beatStart: start, beatEnd: null, div, override });
  return segs;
}

/** Effective subdivision at a beat. */
export function gridDivAt(segments: GridSegment[], beat: number): number {
  if (!segments.length) return DEFAULT_DIV;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid]!.beatStart <= beat) lo = mid;
    else hi = mid - 1;
  }
  return segments[lo]!.div;
}
