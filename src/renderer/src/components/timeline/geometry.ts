import { beatParts, snapBeat } from "../../tempo";
import { BPM_LANE_H, MARKER_LANE_H, RULER_H } from "../../metrics";
import type { BpmPoint, LaneKind, Marker, VisibleRow } from "./types";

/**
 * Pure geometry / formatting helpers for the timeline canvas.
 *
 * Nothing here touches Vue reactivity or the stores: callers pass the few
 * scalars (scroll offset, zoom, snap settings) they need. That keeps the math
 * unit-testable and usable from both the renderer and the gesture handlers.
 */

export const MIN_SUB_PX = 12;

export function screenToContentY(screenY: number, scrollY: number): number {
  return screenY - RULER_H + scrollY;
}

export function laneKindAt(screenY: number, scrollY: number): LaneKind {
  const cy = screenToContentY(screenY, scrollY);
  if (cy < BPM_LANE_H) return { kind: "bpm", index: -1 };
  const idx = Math.floor((cy - BPM_LANE_H) / MARKER_LANE_H);
  return { kind: "marker", index: idx };
}

/** Rows (BPM lane + marker lanes) intersecting the viewport, for drawing. */
export function visibleRows(
  H: number,
  scrollY: number,
  trackCount: number,
): VisibleRow[] {
  const rows: VisibleRow[] = [];
  const lanesViewTop = RULER_H;
  const bpmTop = lanesViewTop - scrollY + 0;
  if (bpmTop < H && bpmTop + BPM_LANE_H > lanesViewTop) {
    rows.push({ i: -1, y: bpmTop, h: BPM_LANE_H, bpm: true });
  }
  const yTop = bpmTop + BPM_LANE_H;
  for (let i = 0; i < trackCount; i++) {
    const y = yTop + i * MARKER_LANE_H;
    if (y + MARKER_LANE_H < lanesViewTop) continue;
    if (y > H) break;
    rows.push({ i, y, h: MARKER_LANE_H, bpm: false });
  }
  return rows;
}

/** Coarsest subdivision to draw for a zoom when auto-hide is on. */
export function cappedSnapDiv(pps: number, snapDiv: number): number {
  if (pps < 100) return Math.min(snapDiv, 4);
  if (pps < 250) return Math.min(snapDiv, 8);
  if (pps < 500) return Math.min(snapDiv, 16);
  return snapDiv;
}

/** Snap a raw beat if snapping is enabled. */
export function doSnap(
  raw: number,
  snapEnabled: boolean,
  snapDiv: number,
): number {
  return snapEnabled ? snapBeat(Math.max(0, raw), snapDiv) : raw;
}

/** True if a marker already occupies `beat` on the given marker list. */
export function markerOccupy(
  markers: Marker[],
  beat: number,
  except?: Set<string>,
): boolean {
  return markers.some(
    (m) =>
      (except ? !except.has(m.id) : true) && Math.abs(m.beat - beat) < 1 / 256,
  );
}

/** True if a BPM point already occupies `beat`. */
export function bpmOccupy(points: BpmPoint[], beat: number): boolean {
  return points.some((p) => Math.abs(p.beat - beat) < 1e-6);
}

/** Candidate time-ruler steps (seconds); the first that spaces ticks ≥70px wins. */
const TIME_RULER_STEPS = [
  0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600,
];

/** Time-ruler step for the current zoom (seconds between major ticks). */
export function timeRulerStepSec(pxPerSec: number): number {
  return TIME_RULER_STEPS.find((s) => s * pxPerSec >= 70) ?? 600;
}

/** Fractional digits a tick needs so adjacent labels never read the same. */
export function rulerLabelDigits(stepSec: number): 0 | 1 | 2 {
  return stepSec >= 1 ? 0 : stepSec >= 0.1 ? 1 : 2;
}

/** Width of the fade band at each ruler edge, in px. */
export const RULER_LABEL_FADE_PX = 20;

/** Per-label alpha that fades text in/out near the left and right viewport edges. */
export function rulerEdgeAlpha(
  x: number,
  viewportW: number,
  labelW: number,
  bandPx = RULER_LABEL_FADE_PX,
): number {
  if (bandPx <= 0) return 1;
  const left = x / bandPx;
  const right = (viewportW - (x + labelW)) / bandPx;
  return Math.max(0, Math.min(1, Math.min(left, right)));
}

/** Bar-number width range (px) over which the label fades in as you zoom in. */
export const BAR_LABEL_MIN_PX = 40;
export const BAR_LABEL_FULL_PX = 52;

/** Smooth 0→1 alpha for a bar number, based on its on-screen slot width. */
export function barLabelAlpha(widthPx: number): number {
  if (widthPx <= BAR_LABEL_MIN_PX) return 0;
  if (widthPx >= BAR_LABEL_FULL_PX) return 1;
  const k =
    (widthPx - BAR_LABEL_MIN_PX) / (BAR_LABEL_FULL_PX - BAR_LABEL_MIN_PX);
  return k * k * (3 - 2 * k);
}

/**
 * Format a ruler tick as `m:ss` or, when the tick step is sub-second, with just
 * enough fractional digits that adjacent ticks never collapse to the same text.
 * The step always divides the millisecond value exactly (0.5/0.2/0.1/0.05/0.02),
 * so the fractional part is taken by division rather than re-rounded.
 */
export function fmtTick(sec: number, stepSec = 1): string {
  const totalMs = Math.round(sec * 1000);
  const m = Math.floor(totalMs / 60000);
  const remMs = totalMs - m * 60000;
  const s = Math.floor(remMs / 1000);
  const digits = rulerLabelDigits(stepSec);
  if (digits === 0) return `${m}:${String(s).padStart(2, "0")}`;
  const msPart = remMs % 1000;
  const frac =
    digits === 1
      ? String(Math.floor(msPart / 100))
      : String(Math.floor(msPart / 10)).padStart(2, "0");
  return `${m}:${String(s).padStart(2, "0")}.${frac}`;
}

export function beatStr(b: number, snapDiv: number): string {
  return b.toFixed(snapDiv <= 4 ? 2 : 3);
}

export function fmtBar(b: number, beatsPerBar = 4): string {
  const p = beatParts(b, beatsPerBar);
  const whole = Math.floor(p.inBar) + 1;
  const frac = Math.round((p.inBar % 1) * 1000) / 1000;
  return `${p.bar}.${whole}${frac ? `+${frac.toFixed(3)}` : ""}`;
}
