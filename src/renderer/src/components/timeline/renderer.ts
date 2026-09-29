import { useProjectStore } from "../../stores/project";
import { useSelectionStore } from "../../stores/selection";
import { useSettingsStore } from "../../stores/settings";
import { useTransportStore } from "../../stores/transport";
import { useUiStore } from "../../stores/ui";
import { useViewStore, screenToTime, timeToScreenX } from "../../stores/view";
import {
  beatOfTime,
  contentEndMs,
  formatTime,
  markerSelectionIds,
  markerTime as storeMarkerTime,
  markersInTrack,
  timeOfBeat,
} from "../../store";
import {
  BEATS_PER_BAR,
  BEAT_RULER_H,
  COLORS,
  RULER_H,
  TIME_RULER_H,
} from "../../metrics";
import {
  MIN_SUB_PX,
  beatStr,
  cappedSnapDiv,
  effectiveSegments,
  fmtTick,
  visibleRows,
} from "./geometry";
import type { BoxRect, GhostState } from "./types";

/**
 * All canvas painting for the timeline. The drawing reads the stores directly
 * (they are render-only inputs); the few non-reactive gesture values are passed
 * in through `DrawScene`, so no component-local state leaks in here.
 */
export interface DrawScene {
  canvas: HTMLCanvasElement | null;
  boxRect: BoxRect | null;
  ghost: GhostState | null;
  hover: { x: number; y: number };
}

// ---- per-track lane glow (same detection as the beat indicator) ----

const LANE_GLOW_MS = 100;
const glowSeqSeen: Record<string, number> = {};
const glowEndAt: Record<string, number> = {};

/** True while any lane glow is still animating (drives the frame loop). */
export function hasActiveGlow(): boolean {
  if (!useUiStore().glowEnabled) return false;
  const now = performance.now();
  for (const id in glowEndAt) {
    if ((glowEndAt[id] ?? 0) > now) return true;
  }
  return false;
}

export function draw(scene: DrawScene): void {
  const cv = scene.canvas;
  if (!cv) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.width / dpr;
  const H = cv.height / dpr;
  const endMs = contentEndMs();

  const X = (tms: number): number => timeToScreenX(tms);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, W, H);

  const t0 = screenToTime(0);
  const t1 = screenToTime(W);

  drawRulers(ctx, W, t0, t1, X, endMs);
  drawLaneBacks(ctx, W, H);
  drawLaneGlow(ctx, W, H);
  drawGridLines(ctx, W, H, t0, t1, X, endMs);
  drawBpmLaneContent(ctx, W, H, t0, X);
  drawMarkerLanesContent(ctx, W, H, t0, t1, X);
  drawGhost(ctx, W, H, X, scene.ghost, scene.hover);
  drawSelectionBox(ctx, scene.boxRect);
  drawPlayhead(ctx, W, H, X);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawRulers(
  ctx: CanvasRenderingContext2D,
  W: number,
  t0: number,
  t1: number,
  X: (t: number) => number,
  endMs: number,
): void {
  const view = useViewStore();
  ctx.fillStyle = COLORS.rulerTimeBg;
  ctx.fillRect(0, 0, W, TIME_RULER_H);
  ctx.fillStyle = COLORS.rulerBeatBg;
  ctx.fillRect(0, TIME_RULER_H, W, BEAT_RULER_H);

  // time ruler
  const steps = [
    0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600,
  ];
  const pps = view.pxPerSec;
  const stepSec = steps.find((s) => s * pps >= 70) ?? 600;
  const stepMs = stepSec * 1000;
  ctx.font = "9px Consolas, monospace";
  ctx.fillStyle = COLORS.rulerText;
  const k0 = Math.floor(t0 / stepMs);
  const k1 = Math.ceil(t1 / stepMs);
  for (let k = k0; k <= k1; k++) {
    const x = X(k * stepMs);
    if (x < -2 || x > W + 2) continue;
    ctx.fillStyle = COLORS.rulerTick;
    ctx.fillRect(x, TIME_RULER_H - 6, 1, 6);
    ctx.fillStyle = COLORS.rulerText;
    ctx.fillText(fmtTick(k * stepSec), x + 2, TIME_RULER_H - 2);
  }

  // beat ruler (variable spacing via tempo map)
  const map = beatOfTime;
  const b0 = Math.floor(map(t0)) - 1;
  const b1 = Math.ceil(map(t1)) + 1;
  const beatY = TIME_RULER_H;
  for (let b = b0; b <= b1; b++) {
    if (b < 0) continue;
    const tm = timeOfBeat(b);
    const x = X(tm);
    if (x < -4 || x > W + 4) continue;
    const isBar = b % BEATS_PER_BAR === 0;
    ctx.fillStyle = isBar ? COLORS.gridBar : COLORS.gridBeat;
    ctx.fillRect(x, beatY, isBar ? 1.5 : 1, BEAT_RULER_H);
    if (isBar && (timeOfBeat(b + 1) - tm) * pps > 44) {
      ctx.fillStyle = COLORS.barText;
      ctx.font = "10px Consolas, monospace";
      ctx.fillText(
        String(Math.floor(b / BEATS_PER_BAR) + 1),
        x + 3,
        beatY + BEAT_RULER_H - 5,
      );
      ctx.font = "9px Consolas, monospace";
    }
  }
  void endMs;
}

function drawLaneBacks(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
): void {
  const view = useViewStore();
  const project = useProjectStore();
  const rows = visibleRows(H, view.y, project.tracks.length);
  for (const r of rows) {
    ctx.fillStyle = r.bpm
      ? COLORS.laneBpmBg
      : r.i % 2 === 0
        ? COLORS.laneMarkerBg
        : COLORS.laneMarkerAlt;
    ctx.fillRect(0, r.y, W, r.h);
    if (!r.bpm && project.tracks[r.i]?.locked) {
      ctx.fillStyle = COLORS.laneLockedBg;
      ctx.fillRect(0, r.y, W, r.h);
    }
  }
  // outer top separator under ruler
  ctx.fillStyle = COLORS.rowLine;
  ctx.fillRect(0, RULER_H - 1, W, 1);
}

function drawLaneGlow(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
): void {
  const view = useViewStore();
  const project = useProjectStore();
  const ui = useUiStore();
  if (!ui.glowEnabled) return;
  const now = performance.now();
  const rows = visibleRows(H, view.y, project.tracks.length);
  for (const r of rows) {
    if (r.bpm) continue;
    const track = project.tracks[r.i];
    if (!track) continue;
    const seq = ui.glowSeqs[track.id];
    if (seq !== glowSeqSeen[track.id]) {
      glowSeqSeen[track.id] = seq;
      glowEndAt[track.id] = now + LANE_GLOW_MS;
    }
    const left = (glowEndAt[track.id] ?? 0) - now;
    if (left <= 0) continue;
    const k = left / LANE_GLOW_MS;
    ctx.fillStyle = track.color;
    ctx.globalAlpha = 0.1 + 0.34 * k;
    ctx.fillRect(0, r.y, W, r.h);
    ctx.globalAlpha = 1;
  }
}

function drawGridLines(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t0: number,
  t1: number,
  X: (t: number) => number,
  endMs: number,
): void {
  const view = useViewStore();
  const b0 = Math.max(0, Math.floor(beatOfTime(t0)) - 1);
  const b1 = Math.ceil(beatOfTime(t1)) + 1;
  for (let b = b0; b <= b1; b++) {
    const tm = timeOfBeat(b);
    const x = X(tm);
    if (x < -2 || x > W + 2) continue;
    const isBar = b % BEATS_PER_BAR === 0;
    ctx.fillStyle = isBar ? COLORS.gridBar : COLORS.gridBeat;
    ctx.fillRect(x, RULER_H, isBar ? 1.25 : 1, H - RULER_H);
  }
  // subdivisions when zoomed & snap on. With auto-hide the displayed detail is
  // capped by the current zoom so a dense/zoomed-out grid can't stall rendering.
  if (view.snapEnabled && view.snapDiv > 1) {
    const div = gridSubDiv(t0, t1);
    if (div > 0) {
      const b0s = Math.max(0, Math.floor(beatOfTime(t0) * div) - 1);
      const b1s = Math.ceil(beatOfTime(t1) * div) + 1;
      for (let s = b0s; s <= b1s; s++) {
        const beat = s / div;
        if (Math.abs(beat * div - Math.round(beat * div)) > 1e-9) continue;
        if (Math.abs(beat - Math.round(beat)) < 1e-6) continue;
        const x = X(timeOfBeat(beat));
        if (x < -2 || x > W + 2) continue;
        ctx.fillStyle = COLORS.gridSub;
        ctx.fillRect(x, RULER_H, 1, H - RULER_H);
      }
    }
  }
  void endMs;
}

/** Subdivision denominator to draw for a given zoom.
 *  - Power-of-two grids halve cleanly, so auto-hide caps them via the classic
 *    1/4 → 1/8 → 1/16 zoom tiers (see cappedSnapDiv).
 *  - Non power-of-two grids (e.g. 1/5) cannot be coarsened into a different
 *    denominator, so they keep the exact snapDiv and are shown only while a
 *    sub-beat is wide enough on screen; when too dense they are suppressed
 *    entirely (returning 0) instead of substituting 1/4-style lines.
 *  With auto-hide off, the full grid is always drawn. */
function gridSubDiv(t0: number, t1: number): number {
  const view = useViewStore();
  const settings = useSettingsStore();
  const actual = view.snapDiv;
  if (actual <= 1 || !settings.settings.gridAutoHide) return actual;
  if ((actual & (actual - 1)) === 0)
    return cappedSnapDiv(view.pxPerSec, view.snapDiv);
  const pps = view.pxPerSec;
  const b0 = Math.max(0, Math.floor(beatOfTime(t0)));
  const b1 = Math.min(Math.max(0, Math.ceil(beatOfTime(t1))), b0 + 4096);
  let minSecPerBeat = Infinity;
  for (let b = b0; b < b1; b++) {
    const d = timeOfBeat(b + 1) - timeOfBeat(b);
    if (d < minSecPerBeat) minSecPerBeat = d;
  }
  if (
    !Number.isFinite(minSecPerBeat) ||
    (pps * minSecPerBeat) / actual < MIN_SUB_PX
  ) {
    return 0;
  }
  return actual;
}

function drawBpmLaneContent(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t0: number,
  X: (t: number) => number,
): void {
  const view = useViewStore();
  const project = useProjectStore();
  const transport = useTransportStore();
  const selection = useSelectionStore();
  const rows = visibleRows(H, view.y, project.tracks.length);
  const row = rows.find((r) => r.bpm);
  if (!row) return;
  const y0 = row.y;
  const y1 = row.y + row.h;
  const cy = (y0 + y1) / 2 + 6;
  const amp = row.h * 0.28;

  // faint waveform. The time->block mapping is linear in screen x, so the
  // starting block and per-pixel step are hoisted out of the loop instead of
  // reading the view store and dividing per pixel. Global alpha is set once.
  const wave = transport.wave;
  if (wave?.minMax.length) {
    const len = wave.minMax.length;
    const blocksPerMs = wave.sampleRate / wave.blockSamples / 1000;
    const msPerPx = 1000 / view.pxPerSec;
    const tAt0 = screenToTime(0);
    const bBase = tAt0 * blocksPerMs;
    const bStep = msPerPx * blocksPerMs;
    const px0 = tAt0 < 0 ? Math.max(0, Math.ceil(-bBase / bStep)) : 0;
    ctx.fillStyle = COLORS.waveform;
    ctx.globalAlpha = 0.5;
    for (let pxX = px0; pxX < W; pxX++) {
      const bIdx = Math.floor(bBase + pxX * bStep);
      if (bIdx < 0 || bIdx * 2 + 1 >= len) continue;
      const lo =
        Math.min(wave.minMax[bIdx * 2], wave.minMax[bIdx * 2 + 1]) * amp;
      const hi =
        Math.max(wave.minMax[bIdx * 2], wave.minMax[bIdx * 2 + 1]) * amp;
      ctx.fillRect(pxX, cy + lo, 1, Math.max(1, hi - lo));
    }
    ctx.globalAlpha = 1;
  }

  // tempo segment labels (effective map)
  const map = beatOfTime;
  const segs = project.bpmPoints.length
    ? effectiveSegments(project.baseBpm, project.bpmPoints)
    : [];
  if (project.bpmPoints.length) {
    ctx.font = "11px Consolas, monospace";
    const floorBeat = Math.max(0, Math.floor(map(t0)));
    for (let si = 0; si < segs.length; si++) {
      const s = segs[si]!;
      const tA = timeOfBeat(s.beatStart);
      const tB = s.beatEnd === null ? contentEndMs() : timeOfBeat(s.beatEnd);
      const x0 = X(tA);
      const x1 = Math.min(W, X(tB) + (s.beatEnd === null ? 40 : 0));
      if (x1 < 0 || x0 > W) continue;
      if (x1 - x0 < 26) continue;
      const label = `${Math.round(s.bpm)}`;
      const mid = x0 + 8;
      ctx.fillStyle = COLORS.bpmSegmentText;
      ctx.fillText(label, mid, y0 + 13);
      // subtle tempo shading density strip
      const density = (s.bpm - 60) / 240;
      ctx.globalAlpha = 0.12 + density * 0.2;
      ctx.fillStyle = "var(--bdg-bpm)";
      ctx.fillRect(mid, y1 - 6, Math.max(0, x1 - mid), 3);
      ctx.globalAlpha = 1;
    }
    void floorBeat;
  }

  // bpm points
  for (const p of project.bpmPoints) {
    const x = X(timeOfBeat(p.beat));
    if (x < -8 || x > W + 8) continue;
    const sel =
      selection.selected.kind === "bpm" && selection.selected.id === p.id;
    ctx.fillStyle = sel ? COLORS.bpmPointSelected : COLORS.bpmPoint;
    drawDiamond(ctx, x, y0 + 8, sel ? 5 : 3.6);
    ctx.fillStyle = COLORS.bpmFaint;
    ctx.fillRect(x - 0.5, y0 + 12, 1, y1 - y0 - 12);
  }
}

function drawMarkerLanesContent(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t0: number,
  t1: number,
  X: (t: number) => number,
): void {
  const view = useViewStore();
  const project = useProjectStore();
  const selection = useSelectionStore();
  const rows = visibleRows(H, view.y, project.tracks.length).filter(
    (r) => !r.bpm,
  );
  // highlight set: every selected main marker lights up together with its
  // children. Built in a single pass over markers (O(markers)) rather than
  // scanning all markers once per selected id (O(selected x markers)).
  const selIds = markerSelectionIds();
  const selGroup = new Set<string>(selIds);
  if (selIds.length) {
    const wanted = new Set(selIds);
    for (const c of project.markers) {
      if (c.parentId && wanted.has(c.parentId)) selGroup.add(c.id);
    }
  }
  for (const r of rows) {
    const track = project.tracks[r.i];
    if (!track) continue;
    for (const m of markersInTrack(track.id)) {
      const x = X(storeMarkerTime(m));
      if (x < -16 || x > W + 16) continue;
      const sel =
        selection.selected.kind === "marker" && selection.selected.id === m.id;
      const inGroup = selGroup.has(m.id) && !sel;
      const color = sel
        ? COLORS.markerSelected
        : track.hidden
          ? COLORS.markerDim
          : track.color;
      const cy = r.y + r.h / 2;
      // faint vertical stem
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x - 1, r.y + 4, 2, r.h - 8);
      ctx.globalAlpha = 1;
      // big diamond marker
      const rr = sel ? 9 : 7;
      drawDiamond(ctx, x, cy, rr);
      if (inGroup) {
        ctx.strokeStyle = COLORS.markerSelected;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(x, cy, rr + 3.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (sel) {
        const label = formatTime(storeMarkerTime(m));
        ctx.font = "10px Consolas, monospace";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = COLORS.labelBg;
        ctx.fillRect(x + rr + 3, cy - 8, tw + 8, 15);
        ctx.fillStyle = COLORS.markerSelected;
        ctx.fillText(label, x + rr + 7, cy + 3);
      }
    }
  }
  void t0;
  void t1;
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fill();
}

function drawSelectionBox(
  ctx: CanvasRenderingContext2D,
  boxRect: BoxRect | null,
): void {
  const b = boxRect;
  if (!b) return;
  const x = b.x0;
  const y = b.y0;
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  ctx.save();
  ctx.strokeStyle = COLORS.markerSelected;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = COLORS.markerSelected;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

function drawGhost(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  X: (t: number) => number,
  ghost: GhostState | null,
  hover: { x: number; y: number },
): void {
  const view = useViewStore();
  const g = ghost;
  if (!g || hover.x < 0 || hover.x > W) return;
  const x = X(timeOfBeat(g.beat));
  if (x < -4 || x > W + 4) return;
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = g.ok ? COLORS.markerGhostOk : COLORS.markerGhostBad;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, g.y0);
  ctx.lineTo(x, g.y1);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "10px Consolas, monospace";
  const label = `${beatStr(g.beat, view.snapDiv)}`;
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = COLORS.labelBg;
  ctx.fillRect(x + 4, g.y1 - 22, tw + 8, 16);
  ctx.fillStyle = g.ok ? COLORS.markerGhostOk : COLORS.markerGhostBad;
  ctx.fillText(label, x + 8, g.y1 - 10);
  void H;
}

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  X: (t: number) => number,
): void {
  const transport = useTransportStore();
  const x = X(transport.positionMs);
  if (x < -2 || x > W + 2) return;
  ctx.fillStyle = COLORS.playhead;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x + 6, 0);
  ctx.lineTo(x, 7);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - 0.75, 0, 1.5, H);
}
