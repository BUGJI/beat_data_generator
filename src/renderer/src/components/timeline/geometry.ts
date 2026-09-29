import { beatParts, clampBpm, snapBeat } from "../../tempo";
import { BPM_LANE_H, MARKER_LANE_H, RULER_H } from "../../metrics";
import type {
  BpmPoint,
  BpmSegment,
  LaneKind,
  Marker,
  VisibleRow,
} from "./types";

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

/** Tempo segments implied by the BPM points, starting from the base BPM. */
export function effectiveSegments(
  baseBpm: number,
  bpmPoints: BpmPoint[],
): BpmSegment[] {
  const pts = [...bpmPoints].sort((a, b) => a.beat - b.beat);
  const segs: BpmSegment[] = [];
  let curBpm = baseBpm;
  let startBeat = 0;
  for (const p of pts) {
    if (p.beat <= startBeat) continue;
    segs.push({ beatStart: startBeat, beatEnd: p.beat, bpm: curBpm });
    curBpm = p.mode === "abs" ? clampBpm(p.value) : curBpm * p.value;
    startBeat = p.beat;
  }
  segs.push({ beatStart: startBeat, beatEnd: null, bpm: curBpm });
  return segs;
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

export function fmtTick(sec: number): string {
  const ms = Math.round(sec * 1000);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function beatStr(b: number, snapDiv: number): string {
  return b.toFixed(snapDiv <= 4 ? 2 : 3);
}

export function fmtBar(b: number): string {
  const p = beatParts(b);
  const whole = Math.floor(p.inBar) + 1;
  const frac = Math.round((p.inBar % 1) * 1000) / 1000;
  return `${p.bar}.${whole}${frac ? `+${frac.toFixed(3)}` : ""}`;
}
