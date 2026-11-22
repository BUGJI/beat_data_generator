import { useProjectStore, markersInTrack } from "../../stores/project";
import { useSelectionStore, markerSelectionIds } from "../../stores/selection";
import { useSettingsStore } from "../../stores/settings";
import { useTransportStore } from "../../stores/transport";
import { useUiStore } from "../../stores/ui";
import { useViewStore, screenToTime, timeToScreenX } from "../../stores/view";
import {
  beatOfTime,
  contentEndMs,
  formatTime,
  markerTime as storeMarkerTime,
  timeOfBeat,
} from "../../services/timeline";
import { BEAT_RULER_H, COLORS, RULER_H, TIME_RULER_H } from "../../metrics";
import { gridDivAt, gridInfoAt } from "../../grid";
import { barStartsInRange, beatsPerBarAt } from "../../meter";
import { lowerBound } from "../../utils/search";
import { reduceMotionActive } from "../../services/motion";
import {
  bpmSegmentBar,
  bpmSegmentBoundary,
  bpmSegmentFill,
  bpmSegmentTheme,
} from "../../bpmSegments";
import {
  MIN_SUB_PX,
  beatStr,
  cappedSnapDiv,
  fmtTick,
  visibleRows,
} from "./geometry";
import { drawMarkerBloom } from "./bloom";
import { BEAT_FX_DURATION_MS, BEAT_FX_IDS } from "@shared/beatFx";
import type { BoxRect, GhostState, VisibleRow } from "./types";
import type { Marker } from "../../types";

/**
 * All canvas painting for the timeline.
 *
 * Painting is split across two stacked canvases:
 *  - the **base** canvas holds everything that only changes when the document,
 *    viewport, theme or selection changes (background, grid, waveform, markers);
 *  - the **overlay** canvas holds the per-frame bits (playhead, selection box,
 *    placement ghost and playback effects).
 *
 * During playback without follow-scroll the base is therefore painted once,
 * while only the cheap overlay is repainted each frame. Individual
 * `fillRect`/`fill` calls are used per grid line, waveform column and marker
 * instead of one giant `Path2D`: batching fewer JS calls looked good on paper
 * but the general path rasterizer is several times slower on the GPU, and
 * redrawing that base every frame while zooming or following was the real
 * bottleneck.
 */
export interface DrawScene {
  overlay: HTMLCanvasElement | null;
  boxRect: BoxRect | null;
  ghost: GhostState | null;
  hover: { x: number; y: number };
}

// ---- playback effects (same detection as the beat indicator) ----
// Pulses carry the instant they fired, so an entity that was scrolled out of
// view when playback crossed it does not replay the effect late on return.

const LANE_GLOW_MS = BEAT_FX_DURATION_MS.laneGlow;
const MARKER_FLASH_MS = BEAT_FX_DURATION_MS.markerFlash;
const MARKER_BLOOM_PX = 32;

/** True while any enabled effect is still animating (drives the frame loop). */
export function hasActiveFx(): boolean {
  const settings = useSettingsStore().settings;
  const flags = settings.beatFx;
  const ui = useUiStore();
  if (!settings.beatFxMaster) return false;
  const until = ui.fxUntil;
  const now = performance.now();
  for (const id of BEAT_FX_IDS) {
    if (flags[id] && (until[id] ?? 0) > now) return true;
  }
  return false;
}

// ---------------------------------------------------------------- base layer

export function drawBase(cv: HTMLCanvasElement | null): void {
  if (!cv) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.width / dpr;
  const H = cv.height / dpr;
  const endMs = contentEndMs();
  const project = useProjectStore();
  const view = useViewStore();

  const x0 = view.x;
  const pps = view.pxPerSec;
  const X = (tms: number): number => (tms / 1000) * pps - x0;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, W, H);

  const t0 = (x0 / pps) * 1000;
  const t1 = ((x0 + W) / pps) * 1000;
  // Rows are shared by every lane painter; computing them once avoids a
  // separate full track walk per layer.
  const rows = visibleRows(H, view.y, project.tracks.length);

  drawRulers(ctx, W, t0, t1, X);
  drawLaneBacks(ctx, W, rows, project);
  drawBpmSegmentFills(ctx, W, rows, X);
  drawLoopRegion(ctx, W, H, X);
  drawGridLines(ctx, W, H, t0, t1, X);
  drawBpmLaneContent(ctx, W, X, rows);
  drawMarkerLanesContent(ctx, W, t0, t1, X, rows);
  void endMs;
}

function drawRulers(
  ctx: CanvasRenderingContext2D,
  W: number,
  t0: number,
  t1: number,
  X: (t: number) => number,
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
  const k0 = Math.floor(t0 / stepMs);
  const k1 = Math.ceil(t1 / stepMs);
  // Per-tick fillRect. A single batched `Path2D` / beginPath+fill uses the slow
  // general path rasterizer and is ~5x slower on this GPU, which dominated
  // frame time while zooming or following. Individual rects use the fast path.
  ctx.fillStyle = COLORS.rulerTick;
  for (let k = k0; k <= k1; k++) {
    const x = X(k * stepMs);
    if (x < -2 || x > W + 2) continue;
    ctx.fillRect(x, TIME_RULER_H - 6, 1, 6);
  }
  ctx.fillStyle = COLORS.rulerText;
  for (let k = k0; k <= k1; k++) {
    const x = X(k * stepMs);
    if (x < -2 || x > W + 2) continue;
    ctx.fillText(fmtTick(k * stepSec), x + 2, TIME_RULER_H - 2);
  }

  // beat ruler (variable spacing via tempo map)
  const project = useProjectStore();
  const segments = project.meterSegments;
  const map = beatOfTime;
  const b0 = Math.floor(map(t0)) - 1;
  const b1 = Math.ceil(map(t1)) + 1;
  const beatY = TIME_RULER_H;
  ctx.fillStyle = COLORS.gridBeat;
  let lastBeatX = -Infinity;
  for (let b = b0; b <= b1; b++) {
    if (b < 0) continue;
    const x = X(timeOfBeat(b));
    if (x < -4 || x > W + 4) continue;
    // Collapse beats that land on the same pixel column when zoomed out.
    if (x - lastBeatX < 2) continue;
    lastBeatX = x;
    ctx.fillRect(x, beatY, 1, BEAT_RULER_H);
  }
  // bar lines and labels follow the active meter (BPM-point overrides allowed)
  for (const bar of barStartsInRange(segments, b0, b1)) {
    if (bar.beat < 0) continue;
    const tm = timeOfBeat(bar.beat);
    const x = X(tm);
    if (x < -4 || x > W + 4) continue;
    ctx.fillStyle = COLORS.gridBar;
    ctx.fillRect(x, beatY, 1.5, BEAT_RULER_H);
    const perBar = beatsPerBarAt(segments, bar.beat);
    if ((timeOfBeat(bar.beat + perBar) - tm) * pps > 44) {
      ctx.fillStyle = COLORS.barText;
      ctx.font = "10px Consolas, monospace";
      ctx.fillText(String(bar.bar), x + 3, beatY + BEAT_RULER_H - 5);
      ctx.font = "9px Consolas, monospace";
    }
  }
}

function drawLoopRegion(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  X: (t: number) => number,
): void {
  const t = useTransportStore();
  if (!t.loopEnabled || t.loopEndMs <= t.loopStartMs) return;
  const x0 = X(t.loopStartMs);
  const x1 = X(t.loopEndMs);
  if (x1 < 0 || x0 > W || x1 - x0 < 1) return;
  const left = Math.max(0, x0);
  const right = Math.min(W, x1);
  ctx.save();
  ctx.fillStyle = COLORS.loopFill;
  ctx.fillRect(left, TIME_RULER_H, right - left, H - TIME_RULER_H);
  ctx.fillStyle = COLORS.loopEdge;
  if (x0 >= -2 && x0 <= W + 2) ctx.fillRect(x0, TIME_RULER_H, 2, H - RULER_H);
  if (x1 >= -2 && x1 <= W + 2)
    ctx.fillRect(x1 - 2, TIME_RULER_H, 2, H - RULER_H);
  ctx.font = "9px Consolas, monospace";
  if (x0 >= 0 && x0 <= W) ctx.fillText("A", x0 + 4, RULER_H - 5);
  if (x1 >= 0 && x1 <= W) ctx.fillText("B", x1 - 10, RULER_H - 5);
  ctx.restore();
}

function drawLaneBacks(
  ctx: CanvasRenderingContext2D,
  W: number,
  rows: VisibleRow[],
  project: ReturnType<typeof useProjectStore>,
): void {
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

function drawBpmSegmentFills(
  ctx: CanvasRenderingContext2D,
  W: number,
  rows: VisibleRow[],
  X: (t: number) => number,
): void {
  const settings = useSettingsStore();
  if (!settings.settings.bpmSegmentColors) return;
  const project = useProjectStore();
  if (!project.bpmPoints.length) return;
  const segs = project.tempoMap.segments;
  if (segs.length <= 1) return;
  const row = rows.find((r) => r.bpm);
  if (!row) return;
  const intensity = settings.settings.bpmSegmentIntensity;
  const theme = bpmSegmentTheme(
    COLORS.bpmPoint,
    COLORS.marker,
    COLORS.background,
  );
  const boundary = bpmSegmentBoundary(theme);
  const y0 = row.y;
  const laneH = row.h;
  let lastBoundaryX = -Infinity;
  for (let si = 0; si < segs.length; si++) {
    const s = segs[si]!;
    const x0 = X(timeOfBeat(s.beatStart));
    const x1 = s.beatEnd === null ? W + 40 : X(timeOfBeat(s.beatEnd));
    if (x1 <= 0 || x0 >= W) continue;
    const info = gridInfoAt(project.gridSegments, s.beatStart);
    const input = {
      beatStart: s.beatStart,
      index: si,
      bpm: s.bpm,
      baseBpm: project.baseBpm,
      gridOverride: info.override,
    };
    const left = Math.max(0, x0);
    const right = Math.min(W, x1);
    const width = right - left;
    if (width >= 3) {
      ctx.fillStyle = bpmSegmentFill(input, theme, intensity);
      ctx.fillRect(left, y0, width, laneH);
    }
    if (width >= 2) {
      ctx.fillStyle = bpmSegmentBar(input, theme, intensity);
      ctx.fillRect(left, y0, width, 2);
    }
    if (s.beatStart > 0 && x0 >= 0 && x0 <= W && x0 - lastBoundaryX >= 3) {
      ctx.fillStyle = boundary;
      ctx.fillRect(x0, y0, 1, laneH);
      lastBoundaryX = x0;
    }
  }
}

function drawGridLines(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t0: number,
  t1: number,
  X: (t: number) => number,
): void {
  const view = useViewStore();
  const project = useProjectStore();
  const segments = project.meterSegments;
  const b0 = Math.max(0, Math.floor(beatOfTime(t0)) - 1);
  const b1 = Math.ceil(beatOfTime(t1)) + 1;
  // Individual fillRect per line. Batched paths are ~5x slower to rasterize on
  // the GPU; one line per pixel column is the fast path. The last-drawn-x guard
  // collapses lines that would overlap when zoomed out.
  ctx.fillStyle = COLORS.gridBeat;
  let lastBeatX = -Infinity;
  for (let b = b0; b <= b1; b++) {
    const x = X(timeOfBeat(b));
    if (x < -2 || x > W + 2) continue;
    if (x - lastBeatX < 2) continue;
    lastBeatX = x;
    ctx.fillRect(x, RULER_H, 1, H - RULER_H);
  }
  // subdivisions when zoomed & snap on. Each grid region can use a different
  // denominator (BPM-point overrides); auto-hide is applied per region.
  if (view.snapEnabled) {
    ctx.fillStyle = COLORS.gridSub;
    let lastSubX = -Infinity;
    for (const seg of project.gridSegments) {
      const lo = Math.max(seg.beatStart, b0);
      const hi = Math.min(seg.beatEnd ?? b1, b1);
      if (hi <= lo) continue;
      const div = gridSubDivFor(seg.div, lo, hi);
      if (div <= 1) continue;
      const s0 = Math.max(0, Math.floor(lo * div) - 1);
      const s1 = Math.ceil(hi * div) + 1;
      for (let s = s0; s <= s1; s++) {
        const beat = s / div;
        if (beat < lo || beat >= hi) continue;
        if (Math.abs(beat * div - Math.round(beat * div)) > 1e-9) continue;
        if (Math.abs(beat - Math.round(beat)) < 1e-6) continue;
        const x = X(timeOfBeat(beat));
        if (x < -2 || x > W + 2) continue;
        if (x - lastSubX < 2) continue;
        lastSubX = x;
        ctx.fillRect(x, RULER_H, 1, H - RULER_H);
      }
    }
  }
  // bar lines follow the active meter (BPM-point overrides allowed); drawn last
  // so they sit above the beat and subdivision lines.
  ctx.fillStyle = COLORS.gridBar;
  let lastBarX = -Infinity;
  for (const bar of barStartsInRange(segments, b0, b1)) {
    const x = X(timeOfBeat(bar.beat));
    if (x < -2 || x > W + 2) continue;
    if (x - lastBarX < 1) continue;
    lastBarX = x;
    ctx.fillRect(x, RULER_H, 1.25, H - RULER_H);
  }
}

/** Subdivision denominator to draw for a given zoom and grid region.
 *  - Power-of-two grids halve cleanly, so auto-hide caps them via the classic
 *    1/4 → 1/8 → 1/16 zoom tiers (see cappedSnapDiv).
 *  - Non power-of-two grids (e.g. 1/5) cannot be coarsened into a different
 *    denominator, so they keep the exact division and are shown only while a
 *    sub-beat is wide enough on screen; when too dense they are suppressed
 *    entirely (returning 0) instead of substituting 1/4-style lines.
 *  With auto-hide off, the full grid is always drawn. */
function gridSubDivFor(actual: number, loBeat: number, hiBeat: number): number {
  if (actual <= 1) return actual;
  const view = useViewStore();
  const settings = useSettingsStore();
  if (!settings.settings.gridAutoHide) return actual;
  if (Number.isInteger(actual) && (actual & (actual - 1)) === 0)
    return cappedSnapDiv(view.pxPerSec, actual);
  const pps = view.pxPerSec;
  const b0 = Math.max(0, Math.floor(loBeat));
  const b1 = Math.min(Math.max(0, Math.ceil(hiBeat)), b0 + 4096);
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
  X: (t: number) => number,
  rows: VisibleRow[],
): void {
  const view = useViewStore();
  const project = useProjectStore();
  const transport = useTransportStore();
  const selection = useSelectionStore();
  const settings = useSettingsStore();
  const row = rows.find((r) => r.bpm);
  if (!row) return;
  const y0 = row.y;
  const y1 = row.y + row.h;
  const cy = (y0 + y1) / 2 + 6;
  const amp = row.h * 0.28;

  // faint waveform. The time->block mapping is linear in screen x, so the
  // starting block and per-pixel step are hoisted out of the loop instead of
  // reading the view store and dividing per pixel. Columns are batched into a
  // single fill, and when zoomed out every block under a column is aggregated
  // instead of sampling just one (no missed transients, same pixel cost).
  const wave = transport.wave;
  if (wave?.minMax.length) {
    // Hoist the typed array out of the draw loop: `wave` is a reactive store
    // value, so every `wave.minMax[i]` would otherwise go through Vue's proxy
    // and dominate frame time when zoomed out (many blocks per pixel).
    const minMax = wave.minMax;
    const totalBlocks = minMax.length >> 1;
    const blocksPerMs = wave.sampleRate / wave.blockSamples / 1000;
    const msPerPx = 1000 / view.pxPerSec;
    const tAt0 = screenToTime(0);
    const bBase = tAt0 * blocksPerMs;
    const bStep = msPerPx * blocksPerMs;
    const px0 = bBase < 0 ? Math.max(0, Math.ceil(-bBase / bStep)) : 0;
    ctx.fillStyle = COLORS.waveform;
    ctx.globalAlpha = 0.5;
    // One fillRect per pixel column (fast raster path). A single Path2D with
    // thousands of sub-rects is several times slower on the GPU.
    for (let pxX = px0; pxX < W; pxX++) {
      const startB = bBase + pxX * bStep;
      let i0 = Math.floor(startB);
      let i1 = bStep <= 1 ? i0 : Math.ceil(startB + bStep) - 1;
      if (i1 < i0) i1 = i0;
      if (i0 < 0) i0 = 0;
      if (i1 >= totalBlocks) i1 = totalBlocks - 1;
      if (i1 < i0) continue;
      let lo = Infinity;
      let hi = -Infinity;
      for (let bi = i0; bi <= i1; bi++) {
        const a = minMax[bi * 2]!;
        const b = minMax[bi * 2 + 1]!;
        if (a < lo) lo = a;
        if (b > hi) hi = b;
      }
      if (!Number.isFinite(lo)) continue;
      ctx.fillRect(pxX, cy + lo * amp, 1, Math.max(1, (hi - lo) * amp));
    }
    ctx.globalAlpha = 1;
  }

  // beat-grid overrides are indicated by a boundary line and a 1/N label only.
  // No region fill: a full-lane tint reads as a yellow mask over the waveform
  // and made adjacent override regions look stacked.
  for (const s of project.gridSegments) {
    if (!s.override) continue;
    const x0 = X(timeOfBeat(s.beatStart));
    const x1 = s.beatEnd === null ? W + 40 : X(timeOfBeat(s.beatEnd));
    if (x1 < -2 || x0 > W + 2) continue;
    ctx.fillStyle = COLORS.bpmFaint;
    ctx.fillRect(x0, y0, 1, y1 - y0);
    if (x1 - x0 >= 34) {
      ctx.font = "9px Consolas, monospace";
      const label = `1/${s.div}`;
      const tw = ctx.measureText(label).width;
      if (tw + 8 <= x1 - x0) {
        ctx.fillStyle = COLORS.labelBg;
        ctx.fillRect(x0 + 4, y0 + 21, tw + 6, 13);
        ctx.fillStyle = COLORS.bpmSegmentText;
        ctx.fillText(label, x0 + 7, y0 + 31);
      }
    }
  }

  // tempo segment labels (effective map)
  const segs = project.bpmPoints.length ? project.tempoMap.segments : [];
  if (project.bpmPoints.length) {
    ctx.font = "11px Consolas, monospace";
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
    }
  }

  // bpm points
  ctx.fillStyle = COLORS.bpmPoint;
  for (const p of project.bpmPoints) {
    const x = X(timeOfBeat(p.beat));
    if (x < -8 || x > W + 8) continue;
    const sel =
      selection.selected.kind === "bpm" && selection.selected.id === p.id;
    ctx.fillStyle = sel ? COLORS.bpmPointSelected : COLORS.bpmPoint;
    drawDiamond(ctx, x, y0 + 8, sel ? 5 : 3.6);
    if (!settings.settings.bpmSegmentColors) {
      ctx.fillStyle = COLORS.bpmFaint;
      ctx.fillRect(x - 0.5, y0 + 12, 1, y1 - y0 - 12);
    }
  }
}

function drawMarkerLanesContent(
  ctx: CanvasRenderingContext2D,
  W: number,
  t0: number,
  t1: number,
  X: (t: number) => number,
  rows: VisibleRow[],
): void {
  const project = useProjectStore();
  const selection = useSelectionStore();
  const markerRows = rows.filter((r) => !r.bpm);
  if (!markerRows.length) return;
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
  const bLo = beatOfTime(t0);
  const bHi = beatOfTime(t1);
  const selectedId =
    selection.selected.kind === "marker" ? selection.selected.id : null;
  for (const r of markerRows) {
    const track = project.tracks[r.i];
    if (!track) continue;
    const list = markersInTrack(track.id);
    const baseColor = track.hidden ? COLORS.markerDim : track.color;
    const cy = r.y + r.h / 2;
    // Draw each marker with plain fillRect / fill instead of one big Path2D
    // per style. The batched paths were several times slower to rasterize on
    // the GPU, which is what made zooming/following stutter with many markers.
    let lastX = -Infinity;
    for (let i = lowerBoundByBeat(list, bLo); i < list.length; i++) {
      const m = list[i]!;
      if (m.beat > bHi) break;
      const x = X(storeMarkerTime(m));
      if (x < -16 || x > W + 16) continue;
      const sel = selectedId !== null && selectedId === m.id;
      const grouped = selGroup.has(m.id) && !sel;
      // Collapse markers that share a pixel column when zoomed out, but keep
      // the selected / selected-group ones so their highlight is never lost.
      if (!sel && !grouped && x - lastX < 1.5) continue;
      lastX = x;
      const color = sel ? COLORS.markerSelected : baseColor;
      // faint vertical stem
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x - 1, r.y + 4, 2, r.h - 8);
      ctx.globalAlpha = 1;
      // big diamond marker
      const rr = sel ? 9 : 7;
      ctx.fillStyle = color;
      drawDiamond(ctx, x, cy, rr);
      // multi-selection ring
      if (grouped) {
        ctx.strokeStyle = COLORS.markerSelected;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(x, cy, rr + 3.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // time label beside each selected marker
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
}

/** First index whose marker beat is >= `beat` (list is sorted by beat). */
function lowerBoundByBeat(list: Marker[], beat: number): number {
  return lowerBound(list, (m) => m.beat, beat);
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

// ------------------------------------------------------------- overlay layer

export function drawOverlay(scene: DrawScene): void {
  const cv = scene.overlay;
  if (!cv) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.width / dpr;
  const H = cv.height / dpr;

  const X = (tms: number): number => timeToScreenX(tms);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  drawLaneGlow(ctx, W, H);
  drawMarkerFlash(ctx, W, H, X);
  drawGhost(ctx, W, H, X, scene.ghost, scene.hover);
  drawSelectionBox(ctx, scene.boxRect);
  drawPlayhead(ctx, W, H, X);
}

function drawLaneGlow(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
): void {
  const view = useViewStore();
  const project = useProjectStore();
  const ui = useUiStore();
  const settings = useSettingsStore().settings;
  if (!settings.beatFxMaster || !settings.beatFx.laneGlow) return;
  const now = performance.now();
  const rows = visibleRows(H, view.y, project.tracks.length);
  const pulses = ui.fxPulses.laneGlow;
  for (const r of rows) {
    if (r.bpm) continue;
    const track = project.tracks[r.i];
    if (!track) continue;
    const pulse = pulses[track.id];
    if (!pulse) continue;
    const dur = pulse.dur ?? LANE_GLOW_MS;
    if (dur <= 0) continue;
    const left = pulse.at + dur - now;
    if (left <= 0) continue;
    const k = left / dur;
    ctx.fillStyle = track.color;
    ctx.globalAlpha = 0.1 + 0.34 * k;
    ctx.fillRect(0, r.y, W, r.h);
    ctx.globalAlpha = 1;
  }
}

function drawMarkerFlash(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  X: (t: number) => number,
): void {
  const ui = useUiStore();
  const settings = useSettingsStore().settings;
  if (!settings.beatFxMaster || !settings.beatFx.markerFlash) return;
  const reduced = reduceMotionActive();
  const pulses = ui.fxPulses.markerFlash;
  const now = performance.now();
  const project = useProjectStore();
  const view = useViewStore();
  const selection = useSelectionStore();
  const selectedId =
    selection.selected.kind === "marker" ? selection.selected.id : null;
  // Map visible track ids to their lane row once, then only walk the markers
  // that actually have a live pulse (usually one or two).
  const rowsByTrack = new Map<string, VisibleRow>();
  for (const r of visibleRows(H, view.y, project.tracks.length)) {
    if (r.bpm) continue;
    const track = project.tracks[r.i];
    if (track) rowsByTrack.set(track.id, r);
  }
  for (const id in pulses) {
    if (!Object.hasOwn(pulses, id)) continue;
    const pulse = pulses[id];
    if (!pulse) continue;
    const dur = pulse.dur ?? MARKER_FLASH_MS;
    if (dur <= 0) continue;
    const left = pulse.at + dur - now;
    if (left <= 0) continue;
    const m = project.markersById.get(id);
    if (!m) continue;
    const row = rowsByTrack.get(m.trackId);
    if (!row) continue;
    const track = project.tracks[row.i];
    if (!track) continue;
    const x = X(storeMarkerTime(m));
    if (x < -16 || x > W + 16) continue;
    const cy = row.y + row.h / 2;
    const color =
      selectedId !== null && selectedId === m.id
        ? COLORS.markerSelected
        : track.hidden
          ? COLORS.markerDim
          : track.color;
    const rr = selectedId !== null && selectedId === m.id ? 9 : 7;
    // Hit first, decay after: alpha peaks on the crossing frame and only
    // falls, and the bloom starts at its widest so nothing ramps up.
    const p = 1 - left / dur;
    const fade = (1 - p) ** 1.15;
    const coreR = reduced ? rr : rr * (1 + 0.25 * (1 - p));
    const bloomPx = reduced
      ? MARKER_BLOOM_PX
      : MARKER_BLOOM_PX * (1.25 - 0.2 * p);
    drawMarkerBloom(ctx, x, cy, bloomPx, color, fade);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = fade;
    ctx.fillStyle = "#ffffff";
    drawDiamond(ctx, x, cy, coreR);
    ctx.restore();
  }
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
  const project = useProjectStore();
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
  const label = `${beatStr(g.beat, gridDivAt(project.gridSegments, g.beat))}`;
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
