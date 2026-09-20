<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  watchEffect,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  markersInTrack,
  addMarker,
  addBpmPoint,
  updateBpmPoint,
  moveMarker,
  changeMarkerTrack,
  removeMarker,
  removeBpmPoint,
  effectiveBpmFor,
  disableFollowOnScrub,
  beatOfTime,
  timeOfBeat,
  markerTime as storeMarkerTime,
  contentEndMs,
  seekTo,
  formatTime,
  select,
  closeCard,
  selectSingleMarker,
  toggleMarkerSelect,
  markerSelectionIds,
  resolveMainMarker,
  boxSelectMarkers,
  updateMarkerLoop,
  updateMarkerAttrs,
  historyGestureBegin,
  historyGestureEnd,
  updateNote,
  removeNote,
  setNoteLocked,
  setNoteText,
  MAX_LOOP_CHILDREN,
} from "../store";
import { snapBeat, beatParts, clampBpm, BPM_MIN } from "../tempo";
import { useProjectStore } from "../stores/project";
import { useTransportStore } from "../stores/transport";
import { useSelectionStore } from "../stores/selection";
import { useSettingsStore } from "../stores/settings";
import { useViewStore } from "../stores/view";
import { useUiStore } from "../stores/ui";
import UiButton from "./ui/UiButton.vue";
import UiInput from "./ui/UiInput.vue";
import UiNumberInput from "./ui/UiNumberInput.vue";
import UiRadioGroup from "./ui/UiRadioGroup.vue";
import UiSelect from "./ui/UiSelect.vue";
import UiSwitch from "./ui/UiSwitch.vue";
import {
  setScroll,
  setViewport,
  contentWidthPx,
  lanesTotalH,
  maxX,
  maxY,
  timeToScreenX,
  screenToTime,
} from "../stores/view";
import {
  COLORS,
  TIME_RULER_H,
  BEAT_RULER_H,
  RULER_H,
  BPM_LANE_H,
  MARKER_LANE_H,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  BEATS_PER_BAR,
} from "../metrics";
import type {
  BpmMode,
  Marker,
  MarkerTrack,
  BpmPoint,
  ProjectNote,
} from "../types";
import { render as mdRender, escapeHtml } from "slimdown-js";
import {
  getTypedef,
  pluginIdOfType,
  localeText,
  defaultForField,
  type TrackTypeDef,
  type PluginFieldDef,
} from "../plugins/registry";

const { t } = useI18n();
const project = useProjectStore();
const transport = useTransportStore();
const selection = useSelectionStore();
const settings = useSettingsStore();
const view = useViewStore();
const ui = useUiStore();

const rootEl = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);

const vbarEl = ref<HTMLElement | null>(null);
const vthumbEl = ref<HTMLElement | null>(null);
const hbarEl = ref<HTMLElement | null>(null);
const hthumbEl = ref<HTMLElement | null>(null);

let raf = 0;
let ro: ResizeObserver | null = null;
let stopPaint: (() => void) | null = null;

/**
 * Painting is dependency-driven instead of a constant 60fps redraw: the
 * `paint` effect below re-runs only when reactive state the canvas reads
 * changes, and `loop` keeps a frame loop alive solely for the two time-based
 * cases (playback follow + the 100ms lane glow). `markDirty` is the escape
 * hatch for render inputs that aren't reactive (the box-selection rect).
 */
const renderNonce = ref(0);
function markDirty(): void {
  renderNonce.value++;
}

function paint(): void {
  draw();
  drawScrollbars();
}

function hasActiveGlow(): boolean {
  if (!ui.glowEnabled) return false;
  const now = performance.now();
  for (const id in glowEndAt) {
    if ((glowEndAt[id] ?? 0) > now) return true;
  }
  return false;
}

let mode:
  | "idle"
  | "scrub"
  | "placeBpm"
  | "placeMarker"
  | "dragBpm"
  | "dragMarker"
  | "brushAdd"
  | "brushErase"
  | "boxSelect"
  | "pan" = "idle";
let activePointer = -1;
let gestureOn = false;
let downX = 0;
let downY = 0;
let moved = false;
let dragId: string | null = null;
let dragTrackId: string | null = null;
let dragGroupIds = new Set<string>();
let grabStartBeat = 0;
let mainStartBeat = 0;
let boxRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
let panStartX = 0;
let panStartY = 0;
let panStartViewX = 0;
let panStartViewY = 0;

const hover = { x: -1, y: -1 };

const trackAt = (i: number): MarkerTrack | undefined => project.tracks[i];

// ---- sticky notes overlay ----

const editingNoteId = ref<string | null>(null);
const editingDraft = ref("");
let dragNoteId: string | null = null;
let dragGrab: { dx: number; dy: number } | null = null;
let dragTarget: { timeMs: number; y: number } | null = null;
let dragRaf = 0;

function isOverNote(e: Event): boolean {
  const t = e.target;
  return t instanceof Element && !!t.closest(".note");
}

const noteOf = (id: string): ProjectNote | undefined =>
  project.notes.find((n) => n.id === id);

const noteTextOf = (id: string): string => noteOf(id)?.text ?? "";

const noteLayouts = computed(() =>
  project.notes.map((n) => ({
    id: n.id,
    left: timeToScreenX(n.timeMs),
    top: RULER_H + n.y - view.y,
    locked: n.locked === true,
  })),
);

function noteHtml(text: string): string {
  return text ? mdRender(escapeHtml(text)) : "";
}

function onNoteDown(e: PointerEvent, note: ProjectNote | undefined): void {
  if (!note || note.locked) return;
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (target.closest("textarea") || target.closest(".note-edit")) return;
  if (target.closest(".note-tools")) return;
  dragNoteId = note.id;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dragGrab = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
  historyGestureBegin();
  window.addEventListener("pointermove", onNoteDragMove);
  window.addEventListener("pointerup", onNoteDragEnd);
  e.preventDefault();
}

function onNoteDragMove(e: PointerEvent): void {
  if (!dragNoteId || !dragGrab || !rootEl.value) return;
  const rect = rootEl.value.getBoundingClientRect();
  const cx = e.clientX - rect.left - dragGrab.dx;
  const cy = e.clientY - rect.top - dragGrab.dy;
  const timeMs = ((cx + view.x) / view.pxPerSec) * 1000;
  const y = cy - RULER_H + view.y;
  dragTarget = { timeMs, y };
  if (!dragRaf) {
    dragRaf = requestAnimationFrame(applyNoteDrag);
  }
  e.preventDefault();
}

function applyNoteDrag(): void {
  dragRaf = 0;
  if (!dragNoteId || !dragTarget) return;
  const t = dragTarget;
  dragTarget = null;
  updateNote(dragNoteId, t);
}

function onNoteDragEnd(): void {
  window.removeEventListener("pointermove", onNoteDragMove);
  window.removeEventListener("pointerup", onNoteDragEnd);
  // cancel any in-flight frame and flush the final position so the drag
  // always releases cleanly instead of staying stuck to the cursor.
  if (dragRaf) {
    cancelAnimationFrame(dragRaf);
    dragRaf = 0;
  }
  applyNoteDrag();
  historyGestureEnd();
  dragNoteId = null;
  dragGrab = null;
  dragTarget = null;
}

function startNoteEdit(note: ProjectNote | undefined): void {
  if (!note || note.locked) return;
  editingNoteId.value = note.id;
  editingDraft.value = note.text;
}

function commitNoteEdit(): void {
  if (!editingNoteId.value) return;
  setNoteText(editingNoteId.value, editingDraft.value);
  editingNoteId.value = null;
}

function cancelNoteEdit(): void {
  editingNoteId.value = null;
}

function loopGroupIds(mainId: string): Set<string> {
  const s = new Set<string>([mainId]);
  for (const c of project.markers) if (c.parentId === mainId) s.add(c.id);
  return s;
}

// ---- geometry ----

const screenToContentY = (screenY: number): number =>
  screenY - RULER_H + view.y;
const laneKindAt = (
  screenY: number,
): { kind: "bpm" | "marker"; index: number } => {
  const cy = screenToContentY(screenY);
  if (cy < BPM_LANE_H) return { kind: "bpm", index: -1 };
  const idx = Math.floor((cy - BPM_LANE_H) / MARKER_LANE_H);
  return { kind: "marker", index: idx };
};

// ---- snapping helpers ----

function doSnap(raw: number): number {
  return view.snapEnabled ? snapBeat(Math.max(0, raw), view.snapDiv) : raw;
}

function markerOccupy(
  trackId: string,
  beat: number,
  except?: Set<string>,
): boolean {
  return markersInTrack(trackId).some(
    (m) =>
      (except ? !except.has(m.id) : true) && Math.abs(m.beat - beat) < 1 / 256,
  );
}

function bpmOccupy(beat: number): boolean {
  return project.bpmPoints.some((p) => Math.abs(p.beat - beat) < 1e-6);
}

// ---- canvas setup & resize ----

function setupCanvas(): void {
  const root = rootEl.value;
  const cv = canvasEl.value;
  if (!root || !cv) return;
  const dpr = window.devicePixelRatio || 1;
  const w = root.clientWidth;
  const h = root.clientHeight;
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  setViewport(w, Math.max(1, h - RULER_H));
  drawScrollbars();
}

function drawScrollbars(): void {
  const vv = view.vh;
  const th = lanesTotalH();
  const cw = contentWidthPx();
  const vc = th > vv && vv > 0;
  const hc = cw > view.vw;
  if (vbarEl.value) {
    vbarEl.value.style.display = vc ? "block" : "none";
    if (vc) {
      const trackH = vv - 2;
      const ratio = vv / th;
      const thumbH = Math.max(24, trackH * ratio);
      vthumbEl.value!.style.height = `${thumbH}px`;
      const maxTravel = trackH - thumbH;
      vthumbEl.value!.style.transform = `translateY(${maxTravel * (view.y / (th - vv))}px)`;
    }
  }
  if (hbarEl.value) {
    hbarEl.value.style.display = hc ? "block" : "none";
    if (hc) {
      const trackW = view.vw - 2;
      const ratio = view.vw / cw;
      const thumbW = Math.max(24, trackW * ratio);
      hthumbEl.value!.style.width = `${thumbW}px`;
      const maxTravel = trackW - thumbW;
      hthumbEl.value!.style.transform = `translateX(${maxTravel * (view.x / (cw - view.vw))}px)`;
    }
  }
}

// ---- drawing ----

function draw(): void {
  const cv = canvasEl.value;
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
  drawBpmLaneContent(ctx, W, H, t0, t1, X);
  drawMarkerLanesContent(ctx, W, H, t0, t1, X);
  drawGhost(ctx, W, H, X);
  drawSelectionBox(ctx);
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

function fmtTick(sec: number): string {
  const ms = Math.round(sec * 1000);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function visibleRows(
  H: number,
): Array<{ i: number; y: number; h: number; bpm: boolean }> {
  const rows: Array<{ i: number; y: number; h: number; bpm: boolean }> = [];
  const lanesViewTop = RULER_H;
  // bpm lane row
  const bpmTop = lanesViewTop - view.y + 0;
  if (bpmTop < H && bpmTop + BPM_LANE_H > lanesViewTop) {
    rows.push({ i: -1, y: bpmTop, h: BPM_LANE_H, bpm: true });
  }
  const n = project.tracks.length;
  const yTop = bpmTop + BPM_LANE_H;
  for (let i = 0; i < n; i++) {
    const y = yTop + i * MARKER_LANE_H;
    if (y + MARKER_LANE_H < lanesViewTop) continue;
    if (y > H) break;
    rows.push({ i, y, h: MARKER_LANE_H, bpm: false });
  }
  return rows;
}

function drawLaneBacks(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
): void {
  const rows = visibleRows(H);
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

// ---- per-track lane glow (same detection as the beat indicator) ----

const LANE_GLOW_MS = 100;
let glowSeqSeen: Record<string, number> = {};
let glowEndAt: Record<string, number> = {};

function drawLaneGlow(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
): void {
  if (!ui.glowEnabled) return;
  const now = performance.now();
  const rows = visibleRows(H);
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

// Smallest on-screen spacing (px) a subdivision line may have before it is
// hidden. Chosen to match the finest spacing the power-of-two tiers already
// allow (~12 px at their zoom boundaries), so non power-of-two grids like 1/5
// actually hide at a similar density instead of staying drawn far too long.
const MIN_SUB_PX = 12;

/** Subdivision denominator to draw for a given zoom.
 *  - Power-of-two grids halve cleanly, so auto-hide caps them via the classic
 *    1/4 → 1/8 → 1/16 zoom tiers (see cappedSnapDiv).
 *  - Non power-of-two grids (e.g. 1/5) cannot be coarsened into a different
 *    denominator, so they keep the exact snapDiv and are shown only while a
 *    sub-beat is wide enough on screen; when too dense they are suppressed
 *    entirely (returning 0) instead of substituting 1/4-style lines.
 *  With auto-hide off, the full grid is always drawn. */
function gridSubDiv(t0: number, t1: number): number {
  const actual = view.snapDiv;
  if (actual <= 1 || !settings.settings.gridAutoHide) return actual;
  if ((actual & (actual - 1)) === 0) return cappedSnapDiv(view.pxPerSec);
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

/** Coarsest subdivision (as a snapDiv value) to draw for a given zoom when
 *  auto-hide is on: finer subdivisions are hidden below the matching zoom tier. */
function cappedSnapDiv(pps: number): number {
  const actual = view.snapDiv;
  if (pps < 100) return Math.min(actual, 4);
  if (pps < 250) return Math.min(actual, 8);
  if (pps < 500) return Math.min(actual, 16);
  return actual;
}

function drawBpmLaneContent(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t0: number,
  t1: number,
  X: (t: number) => number,
): void {
  const rows = visibleRows(H);
  const row = rows.find((r) => r.bpm);
  if (!row) return;
  const y0 = row.y;
  const y1 = row.y + row.h;
  const cy = (y0 + y1) / 2 + 6;
  const amp = row.h * 0.28;

  // faint waveform
  const wave = transport.wave;
  if (wave && wave.minMax.length) {
    const sr = wave.sampleRate;
    const block = wave.blockSamples;
    ctx.fillStyle = COLORS.waveform;
    const xStart = Math.max(0, Math.floor(t0));
    const xEnd = Math.ceil(t1);
    for (let pxX = 0; pxX < W; pxX++) {
      const tms = screenToTime(pxX);
      if (tms < 0) continue;
      const bIdx = Math.floor((tms / 1000) * (sr / block));
      if (bIdx < 0 || bIdx * 2 >= wave.minMax.length) continue;
      const lo =
        Math.min(wave.minMax[bIdx * 2], wave.minMax[bIdx * 2 + 1]) * amp;
      const hi =
        Math.max(wave.minMax[bIdx * 2], wave.minMax[bIdx * 2 + 1]) * amp;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(pxX, cy + lo, 1, Math.max(1, hi - lo));
      ctx.globalAlpha = 1;
    }
    void xStart;
    void xEnd;
  }

  // tempo segment labels (effective map)
  const map = beatOfTime;
  const segs = project.bpmPoints.length ? effectiveSegments() : [];
  if (project.bpmPoints.length) {
    ctx.font = "11px Consolas, monospace";
    const floorBeat = Math.max(0, Math.floor(map(t0)));
    for (let si = 0; si < segs.length; si++) {
      const s = segs[si];
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

function effectiveSegments(): Array<{
  beatStart: number;
  beatEnd: number | null;
  bpm: number;
}> {
  const pts = [...project.bpmPoints].sort((a, b) => a.beat - b.beat);
  const segs: Array<{
    beatStart: number;
    beatEnd: number | null;
    bpm: number;
  }> = [];
  let curBpm = project.baseBpm;
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

function drawMarkerLanesContent(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  t0: number,
  t1: number,
  X: (t: number) => number,
): void {
  const rows = visibleRows(H).filter((r) => !r.bpm);
  // highlight set: every selected main marker lights up together with its children
  const selGroup = new Set<string>();
  for (const mid of markerSelectionIds()) {
    selGroup.add(mid);
    for (const c of project.markers) if (c.parentId === mid) selGroup.add(c.id);
  }
  for (const r of rows) {
    const track = trackAt(r.i);
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

function drawSelectionBox(ctx: CanvasRenderingContext2D): void {
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
): void {
  const g = ghostState.value;
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
  const label = `${beatStr(g.beat)}`;
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = COLORS.labelBg;
  ctx.fillRect(x + 4, g.y1 - 22, tw + 8, 16);
  ctx.fillStyle = g.ok ? COLORS.markerGhostOk : COLORS.markerGhostBad;
  ctx.fillText(label, x + 8, g.y1 - 10);
  void H;
}

const ghostState = ref<{
  beat: number;
  ok: boolean;
  y0: number;
  y1: number;
} | null>(null);

function beatStr(b: number): string {
  return b.toFixed(view.snapDiv <= 4 ? 2 : 3);
}

function fmtBar(b: number): string {
  const p = beatParts(b);
  const whole = Math.floor(p.inBar) + 1;
  const frac = Math.round((p.inBar % 1) * 1000) / 1000;
  return `${p.bar}.${whole}${frac ? "+" + frac.toFixed(3) : ""}`;
}

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  X: (t: number) => number,
): void {
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

// ---- pointer helpers ----

const HIT_PX = 7;

function hitMarkerAt(x: number, y: number): Marker | null {
  const lane = laneKindAt(y);
  if (lane.kind !== "marker") return null;
  const track = trackAt(lane.index);
  if (!track) return null;
  for (const m of markersInTrack(track.id)) {
    if (Math.abs(timeToScreenX(storeMarkerTime(m)) - x) <= HIT_PX) return m;
  }
  return null;
}

function hitBpmAt(x: number, y: number): BpmPoint | null {
  const lane = laneKindAt(y);
  if (lane.kind !== "bpm") return null;
  for (const p of project.bpmPoints) {
    if (Math.abs(timeToScreenX(timeOfBeat(p.beat)) - x) <= HIT_PX) return p;
  }
  return null;
}

const CARD_Y_OFFSET = 10;
const CARD_MARGIN = 8;
const cardPos = ref({ x: 0, y: 0 });
const anchorPos = ref({ x: 0, y: 0 });
const cardEl = ref<HTMLElement | null>(null);

function positionCard(): void {
  const el = cardEl.value;
  const root = rootEl.value;
  if (!el || !root) return;
  const vw = root.clientWidth;
  const vh = root.clientHeight;
  if (vh <= 0) return;
  const avail = Math.max(0, vh - CARD_MARGIN * 2);
  el.style.maxHeight = `${avail}px`;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const a = anchorPos.value;
  const x = Math.max(CARD_MARGIN, Math.min(a.x, vw - w - CARD_MARGIN));
  let y = a.y + CARD_Y_OFFSET;
  if (y + h > vh - CARD_MARGIN) {
    const above = a.y - CARD_Y_OFFSET - h;
    y =
      above >= CARD_MARGIN
        ? above
        : Math.max(CARD_MARGIN, vh - h - CARD_MARGIN);
  }
  cardPos.value = { x, y };
}

const openCard = (x: number, y: number): void => {
  selection.cardOpen = true;
  anchorPos.value = { x, y };
  cardPos.value = {
    x: Math.max(CARD_MARGIN, x),
    y: Math.max(CARD_MARGIN, y + CARD_Y_OFFSET),
  };
  void nextTick(positionCard);
};

let cardRo: ResizeObserver | null = null;
watch(cardEl, (el) => {
  cardRo?.disconnect();
  cardRo = null;
  if (!el) return;
  cardRo = new ResizeObserver(() => positionCard());
  cardRo.observe(el);
  void nextTick(positionCard);
});

// ---- card dragging (grab the header to move the popup) ----

let cardDragging = false;
let cardDragOffset = { x: 0, y: 0 };

function startCardDrag(e: PointerEvent): void {
  if (e.button !== 0) return;
  const el = cardEl.value;
  const root = rootEl.value;
  if (!el || !root) return;
  if ((e.target as HTMLElement).closest(".pc-x")) return;
  const rect = root.getBoundingClientRect();
  cardDragging = true;
  cardDragOffset = {
    x: e.clientX - rect.left - cardPos.value.x,
    y: e.clientY - rect.top - cardPos.value.y,
  };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onCardDrag(e: PointerEvent): void {
  if (!cardDragging) return;
  const el = cardEl.value;
  const root = rootEl.value;
  if (!el || !root) return;
  const rect = root.getBoundingClientRect();
  const maxX = Math.max(
    CARD_MARGIN,
    root.clientWidth - el.offsetWidth - CARD_MARGIN,
  );
  const maxY = Math.max(
    CARD_MARGIN,
    root.clientHeight - el.offsetHeight - CARD_MARGIN,
  );
  const x = Math.min(
    Math.max(CARD_MARGIN, e.clientX - rect.left - cardDragOffset.x),
    maxX,
  );
  const y = Math.min(
    Math.max(CARD_MARGIN, e.clientY - rect.top - cardDragOffset.y),
    maxY,
  );
  cardPos.value = { x, y };
  // keep the anchor in sync so positionCard() (resize/reflow) won't snap back
  anchorPos.value = { x, y: y - CARD_Y_OFFSET };
}

function endCardDrag(e: PointerEvent): void {
  if (!cardDragging) return;
  cardDragging = false;
  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
}

// ---- quick place / erase brush ----

let brushLastKey = "";

function eraseMarkerAt(trackId: string, beat: number): void {
  let best: Marker | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const m of markersInTrack(trackId)) {
    const d = Math.abs(m.beat - beat);
    if (d < bestDiff) {
      best = m;
      bestDiff = d;
    }
  }
  if (best && bestDiff < 1 / 256) removeMarker(best.id);
}

function brushStep(x: number, y: number): void {
  const lane = laneKindAt(y);
  if (lane.kind !== "marker") return;
  const track = trackAt(lane.index);
  if (!track) return;
  const beat = doSnap(Math.max(0, beatOfTime(screenToTime(x))));
  const key = `${track.id}@${beat}`;
  if (key === brushLastKey) return;
  brushLastKey = key;
  if (mode === "brushAdd") {
    addMarker(track.id, beat);
  } else if (mode === "brushErase") {
    eraseMarkerAt(track.id, beat);
  }
}

function setBox(x: number, y: number): void {
  boxRect = {
    x0: Math.min(downX, x),
    y0: Math.min(downY, y),
    x1: Math.max(downX, x),
    y1: Math.max(downY, y),
  };
  markDirty();
}

function applyBoxSelection(): void {
  const b = boxRect;
  if (!b) return;
  const picked: string[] = [];
  project.tracks.forEach((tr, idx) => {
    // screen y of this lane's vertical centre
    const my =
      RULER_H - view.y + BPM_LANE_H + idx * MARKER_LANE_H + MARKER_LANE_H / 2;
    if (my < b.y0 || my > b.y1) return;
    for (const m of markersInTrack(tr.id)) {
      if (m.parentId) continue; // box selects the loop parents only
      const mx = timeToScreenX(storeMarkerTime(m));
      if (mx >= b.x0 && mx <= b.x1) picked.push(m.id);
    }
  });
  boxSelectMarkers(picked);
}

// ---- events ----

function onContext(e: MouseEvent): void {
  if (ui.quickPlace) return; // quick-erase brush handles right button
  const rect = rootEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (y < RULER_H) return;
  const mk = hitMarkerAt(x, y);
  if (mk) {
    removeMarker(mk.id);
    closeCard();
    ghostState.value = null;
    return;
  }
  const bp = hitBpmAt(x, y);
  if (bp) {
    removeBpmPoint(bp.id);
    closeCard();
    ghostState.value = null;
  }
}

function onPointerDown(e: PointerEvent): void {
  // middle-button drag pans the timeline (same as Shift+wheel horizontal scroll)
  if (e.button === 1) {
    selection.cardOpen = false;
    const rect = rootEl.value!.getBoundingClientRect();
    panStartX = e.clientX - rect.left;
    panStartY = e.clientY - rect.top;
    panStartViewX = view.x;
    panStartViewY = view.y;
    mode = "pan";
    activePointer = e.pointerId;
    rootEl.value!.setPointerCapture(activePointer);
    return;
  }
  if (e.button !== 0 && !(ui.quickPlace && e.button === 2)) return;
  // a fresh press dismisses the card; it reopens only on a clean click/release
  selection.cardOpen = false;
  const rect = rootEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  downX = x;
  downY = y;
  boxRect = null;
  markDirty();
  moved = false;
  activePointer = e.pointerId;
  rootEl.value!.setPointerCapture(activePointer);

  // right-button quick-erase brush (sweep deletes markers under the cursor)
  if (e.button === 2) {
    const rl = laneKindAt(y);
    if (rl.kind === "marker" && rl.index < project.tracks.length) {
      mode = "brushErase";
      brushLastKey = "";
      historyGestureBegin();
      gestureOn = true;
      brushStep(x, y);
    }
    return;
  }

  if (y < RULER_H) {
    mode = "scrub";
    if (transport.playing) disableFollowOnScrub();
    return;
  }
  const lane0 = laneKindAt(y);
  if (lane0.kind === "marker" && lane0.index >= project.tracks.length) {
    // blank area without a track -> drag the red playhead (scrub)
    mode = "scrub";
    if (transport.playing) disableFollowOnScrub();
    return;
  }
  const bpmHit = hitBpmAt(x, y);
  if (bpmHit) {
    mode = "dragBpm";
    dragId = bpmHit.id;
    select("bpm", bpmHit.id);
    return;
  }
  const mkHit = hitMarkerAt(x, y);
  if (mkHit) {
    const main = resolveMainMarker(mkHit);
    if (!main) return;
    if (e.ctrlKey || e.metaKey) {
      toggleMarkerSelect(main.id);
      mode = "idle";
      return;
    }
    mode = "dragMarker";
    dragId = main.id;
    dragTrackId = main.trackId;
    dragGroupIds = loopGroupIds(main.id);
    // remember the clicked point (may be a child) and the main beat so the
    // grabbed point stays under the mouse while the main translates by the same delta.
    grabStartBeat = doSnap(mkHit.beat);
    mainStartBeat = main.beat;
    selectSingleMarker(main.id);
    return;
  }
  if (ui.quickPlace) {
    const ql = laneKindAt(y);
    if (ql.kind === "marker" && ql.index < project.tracks.length) {
      // sweep-placement brush over empty lane cells
      mode = "brushAdd";
      brushLastKey = "";
      historyGestureBegin();
      gestureOn = true;
      brushStep(x, y);
      return;
    }
  }
  const lane = laneKindAt(y);
  mode = lane.kind === "bpm" ? "placeBpm" : "placeMarker";
  if (lane.kind === "marker") closeCard();
}

function onPointerMove(e: PointerEvent): void {
  if (isOverNote(e)) return; // note drag is handled by the note overlay, not the canvas
  const rect = rootEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  hover.x = x;
  hover.y = y;
  if (Math.abs(x - downX) > 3 || Math.abs(y - downY) > 3) moved = true;

  if (mode === "pan") {
    setScroll(panStartViewX - (x - panStartX), panStartViewY - (y - panStartY));
    return;
  }
  const lane = laneKindAt(y);
  if (mode === "scrub") {
    seekPlayhead(screenToTime(x));
    return;
  }
  if (!gestureOn && (mode === "dragBpm" || mode === "dragMarker")) {
    historyGestureBegin();
    gestureOn = true;
  }
  if (mode === "dragBpm" && dragId) {
    const raw = doSnap(Math.max(0, beatOfTime(screenToTime(x))));
    if (!e.altKey && !bpmOccupy(raw)) updateBpmPoint(dragId, { beat: raw });
  } else if (mode === "dragMarker" && dragId && dragTrackId) {
    // holding Alt temporarily disables snap (free, un-gridded drag)
    const rawBeat = Math.max(0, beatOfTime(screenToTime(x)));
    const raw = e.altKey ? rawBeat : doSnap(rawBeat);
    // children are regenerated with fresh ids on every parent move, so refresh
    // the exception set each frame or the parent gets blocked by its own children.
    dragGroupIds = loopGroupIds(dragId);
    // translate the whole group by the grabbed point's delta so the point under
    // the cursor stays grabbed; the main moves by the same offset.
    const mainBeat = mainStartBeat + (raw - grabStartBeat);
    const ok = !e.altKey
      ? !markerOccupy(dragTrackId, mainBeat, dragGroupIds)
      : true;
    if (ok) moveMarker(dragId, mainBeat, true);
  } else if (mode === "brushAdd" || mode === "brushErase") {
    brushStep(x, y);
  } else if (mode === "placeMarker" && moved) {
    // quick place is off: a drag on a marker lane turns into a box selection
    mode = "boxSelect";
    setBox(x, y);
  } else if (mode === "boxSelect") {
    setBox(x, y);
  } else if ((mode === "placeBpm" || mode === "placeMarker") && lane) {
    updateGhost(lane);
  }
}

function seekPlayhead(msRaw?: number): void {
  const ms = Math.max(
    0,
    Math.min(msRaw ?? transport.positionMs, contentEndMs()),
  );
  transport.positionMs = ms;
  seekTo(ms);
}

function onPointerUp(e: PointerEvent): void {
  if (isOverNote(e)) return; // note drag is handled by the note overlay, not the canvas
  if (activePointer !== e.pointerId) return;
  const rect = rootEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (mode === "boxSelect") applyBoxSelection();

  if (!moved) {
    if (mode === "scrub") {
      seekPlayhead();
    } else if (mode === "placeBpm") {
      const beat = doSnap(Math.max(0, beatOfTime(screenToTime(x))));
      const pt = addBpmPoint(beat);
      if (pt) openCard(x, y);
    } else if (mode === "placeMarker") {
      const lane = laneKindAt(y);
      const track = lane.kind === "marker" ? trackAt(lane.index) : undefined;
      if (track) {
        const beat = doSnap(Math.max(0, beatOfTime(screenToTime(x))));
        addMarker(track.id, beat);
        // no popup on placement; click the marker again to open its card
      }
    } else if (mode === "dragBpm") {
      openCard(x, y);
    } else if (mode === "dragMarker") {
      openCard(x, y);
    }
  }
  if (gestureOn) {
    historyGestureEnd();
    gestureOn = false;
  }
  mode = "idle";
  dragId = null;
  dragTrackId = null;
  dragGroupIds = new Set<string>();
  grabStartBeat = 0;
  mainStartBeat = 0;
  brushLastKey = "";
  activePointer = -1;
  boxRect = null;
  markDirty();
  ghostState.value = null;
}

function onPointerCancel(): void {
  if (gestureOn) {
    historyGestureEnd();
    gestureOn = false;
  }
  mode = "idle";
  dragId = null;
  dragTrackId = null;
  dragGroupIds = new Set<string>();
  grabStartBeat = 0;
  mainStartBeat = 0;
  brushLastKey = "";
  activePointer = -1;
  boxRect = null;
  markDirty();
  ghostState.value = null;
}

function updateGhost(lane: { kind: "bpm" | "marker"; index: number }): void {
  if (!lane) return;
  const laneRow = visibleRows(view.vh + RULER_H).find((r) =>
    lane.kind === "bpm" ? r.bpm : !r.bpm && r.i === lane.index,
  );
  if (!laneRow) return;
  const raw = Math.max(0, beatOfTime(screenToTime(hover.x)));
  const beat = doSnap(raw);
  const ok =
    lane.kind === "bpm"
      ? !bpmOccupy(beat)
      : !markerOccupy(trackAt(lane.index)!.id, beat);
  ghostState.value = { beat, ok, y0: laneRow.y + 4, y1: laneRow.y + laneRow.h };
}

const ANIM_MS = 100;
let wheelAnimRaf = 0;

function cancelWheelAnim(): void {
  cancelAnimationFrame(wheelAnimRaf);
  wheelAnimRaf = 0;
}

/** interruptible ease-out animator over `durMs`; apply receives 0→1 eased progress */
function animWheel(durMs: number, apply: (k: number) => void): void {
  cancelWheelAnim();
  const t0 = performance.now();
  const step = (): void => {
    const k = Math.min(1, (performance.now() - t0) / durMs);
    apply(1 - Math.pow(1 - k, 3));
    if (k < 1) wheelAnimRaf = requestAnimationFrame(step);
    else wheelAnimRaf = 0;
  };
  wheelAnimRaf = requestAnimationFrame(step);
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const anim = settings.settings.animEnabled;
  if (e.ctrlKey || e.metaKey) {
    // zoom anchored on the currently visible centre of the timeline
    const cx = view.vw / 2;
    const from = view.pxPerSec;
    const target = Math.min(
      MAX_PX_PER_SEC,
      Math.max(
        MIN_PX_PER_SEC,
        view.pxPerSec * (e.deltaY < 0 ? 1.25 : 1 / 1.25),
      ),
    );
    const tc = screenToTime(cx); // time currently at the viewport centre
    const applyZoom = (k: number): void => {
      const p = from + (target - from) * k;
      view.pxPerSec = p;
      setScroll(Math.max(0, (tc / 1000) * p - cx), view.y);
    };
    if (anim) animWheel(ANIM_MS, applyZoom);
    else {
      view.pxPerSec = target;
      setScroll(Math.max(0, (tc / 1000) * target - cx), view.y);
    }
    return;
  }
  const dx = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
  const dy = e.deltaX !== 0 || e.shiftKey ? 0 : e.deltaY;
  if (anim) {
    const x0 = view.x;
    const y0 = view.y;
    const x1 = x0 + (dx || 0);
    const y1 = y0 + dy;
    animWheel(ANIM_MS, (k) => {
      setScroll(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
    });
  } else {
    setScroll(view.x + (dx || 0), view.y + dy);
  }
}

// ---- scrollbars ----

function startVBarDrag(e: PointerEvent): void {
  e.preventDefault();
  const el = vthumbEl.value!;
  el.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent): void => {
    const rect = vbarEl.value!.getBoundingClientRect();
    const travel =
      ev.clientY - rect.top - (rect.height - vbarEl.value!.clientHeight) / 2;
    const ratio = travel / rect.height;
    setScroll(view.x, ratio * maxY());
  };
  const up = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function startHBarDrag(e: PointerEvent): void {
  e.preventDefault();
  const move = (ev: PointerEvent): void => {
    const rect = hbarEl.value!.getBoundingClientRect();
    const ratio = (ev.clientX - rect.left) / rect.width;
    setScroll(ratio * maxX(), view.y);
  };
  const up = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function loop(): void {
  if (transport.playing) {
    const tpx = (transport.positionMs / 1000) * view.pxPerSec;
    const W = view.vw;
    const f = Math.min(1, Math.max(0, settings.settings.followPercent / 100));
    if (transport.followActive) {
      // follow reference line
      const line = view.x + W * f;
      if (tpx > line) {
        setScroll(Math.max(0, tpx - W * f), view.y);
      } else if (tpx < view.x - W * 0.5) {
        setScroll(Math.max(0, tpx - W * f), view.y);
      }
    } else if (!transport.followLocked && settings.settings.followScroll) {
      // engage once the playhead crosses the reference line
      if (tpx > view.x + W * f) transport.followActive = true;
    }
  }
  // lane glow decays over time, which no reactive value tracks, so drive those
  // frames explicitly (the initial frame is painted by the paint effect).
  if (hasActiveGlow()) paint();
  raf = requestAnimationFrame(loop);
}

// ---- card object accessors ----

const selMarker = computed<Marker | null>(() =>
  selection.selected.kind === "marker"
    ? (project.markers.find((m) => m.id === selection.selected.id) ?? null)
    : null,
);
const selBpm = computed<BpmPoint | null>(() =>
  selection.selected.kind === "bpm"
    ? (project.bpmPoints.find((p) => p.id === selection.selected.id) ?? null)
    : null,
);
const cardVisible = computed(() => selection.cardOpen);
const freeInput = computed(() => settings.settings.devFreeInput);

const markerBeat = computed({
  get: () => selMarker.value?.beat ?? 0,
  set: (v: number) => {
    if (selMarker.value)
      moveMarker(
        selMarker.value.id,
        freeInput.value ? v : Math.max(0, v),
        true,
      );
  },
});
function applyLoopPatch(patch: { interval?: number; count?: number }): void {
  const m = selMarker.value;
  if (!m) return;
  const cur = m.loop;
  const interval = patch.interval ?? cur?.interval ?? 1;
  const count = patch.count ?? cur?.count ?? 4;
  const exclude = cur?.exclude;
  updateMarkerLoop(m.id, { interval, count, exclude });
}
const loopOn = computed({
  get: () => !!selMarker.value?.loop,
  set: (v: boolean) => {
    const m = selMarker.value;
    if (!m) return;
    updateMarkerLoop(
      m.id,
      v
        ? {
            interval: m.loop?.interval ?? 1,
            count: m.loop?.count ?? 4,
            exclude: m.loop?.exclude,
          }
        : null,
    );
  },
});
const loopInterval = computed({
  get: () => selMarker.value?.loop?.interval ?? 1,
  set: (v: number) => applyLoopPatch({ interval: v }),
});
const loopCount = computed({
  get: () => selMarker.value?.loop?.count ?? 4,
  set: (v: number) =>
    applyLoopPatch({
      count: freeInput.value
        ? v
        : Math.min(MAX_LOOP_CHILDREN, Math.max(1, Math.floor(v))),
    }),
});
const LOOP_INT_MIN = 0.0625;
const LOOP_INT_MAX = 256;

const loopDraft = ref("");
const loopFocus = ref(false);

function loopDraftBegin(): void {
  loopFocus.value = true;
  loopDraft.value = String(loopInterval.value);
}

function loopDraftCommit(): void {
  loopFocus.value = false;
  const raw = loopDraft.value.trim();
  const v = Number(raw);
  if (raw === "" || !Number.isFinite(v)) {
    loopDraft.value = String(loopInterval.value);
    return;
  }
  applyLoopPatch({ interval: clampLoopInterval(v) });
  loopDraft.value = String(loopInterval.value);
}

// keep the draft input in sync with the real interval (e.g. when another marker
// becomes selected) unless the user is actively typing.
watch(
  () => [selMarker.value?.id, loopInterval.value],
  () => {
    if (!loopFocus.value) loopDraft.value = String(loopInterval.value);
  },
);

function loopDraftCancel(): void {
  loopDraft.value = String(loopInterval.value);
}

const canHalve = computed(
  () => freeInput.value || loopInterval.value > LOOP_INT_MIN,
);
const canDouble = computed(
  () => freeInput.value || loopInterval.value < LOOP_INT_MAX,
);

function clampLoopInterval(v: number): number {
  if (freeInput.value) return v;
  const c = Math.min(LOOP_INT_MAX, Math.max(LOOP_INT_MIN, v));
  return Math.round(c * 1e4) / 1e4;
}

/** +/- buttons multiply / divide the interval by `factor` (e.g. ×2 or ÷2). */
function scaleLoopInterval(factor: number): void {
  applyLoopPatch({ interval: clampLoopInterval(loopInterval.value * factor) });
  loopDraft.value = String(loopInterval.value);
}

function onLoopCountWheel(e: WheelEvent): void {
  e.preventDefault();
  e.stopPropagation();
  const next = loopCount.value + (e.deltaY < 0 ? 1 : -1);
  if (freeInput.value) {
    loopCount.value = next;
    return;
  }
  const hi = MAX_LOOP_CHILDREN;
  if (next >= 1 && next <= hi) loopCount.value = next;
}
const bpmBeat = computed({
  get: () => selBpm.value?.beat ?? 0,
  set: (v: number) => {
    if (selBpm.value)
      updateBpmPoint(selBpm.value.id, {
        beat: freeInput.value ? v : Math.max(0, v),
      });
  },
});
const bpmValue = computed({
  get: () => selBpm.value?.value ?? 120,
  set: (v: number) => {
    if (selBpm.value) updateBpmPoint(selBpm.value.id, { value: v });
  },
});
const bpmMin = computed(() =>
  freeInput.value
    ? Number.NEGATIVE_INFINITY
    : bpmMode.value === "mult"
      ? 0.01
      : BPM_MIN,
);
const bpmMax = computed(() =>
  bpmMode.value === "mult" && !freeInput.value ? 100 : Number.POSITIVE_INFINITY,
);
const bpmDecimals = computed(() => (bpmMode.value === "mult" ? 3 : 1));

function roundValue(v: number, decimals: number): number {
  const p = 10 ** decimals;
  return Math.round(v * p) / p;
}

/** Format a BPM value for the draft input (no rounding under free input). */
function formatBpmDraft(v: number): string {
  return String(freeInput.value ? v : roundValue(v, bpmDecimals.value));
}

const bpmDraft = ref("");

function bpmDraftBegin(): void {
  bpmDraft.value = formatBpmDraft(bpmValue.value);
}

function bpmDraftCommit(): void {
  const raw = bpmDraft.value.trim();
  const v = Number(raw);
  if (raw === "" || !Number.isFinite(v)) {
    bpmDraft.value = formatBpmDraft(bpmValue.value);
    return;
  }
  bpmValue.value = clampValue(v);
  bpmDraft.value = formatBpmDraft(bpmValue.value);
}

function bpmDraftCancel(): void {
  bpmDraft.value = formatBpmDraft(bpmValue.value);
}

const canHalveBpm = computed(() => bpmValue.value > bpmMin.value + 1e-9);
const canDoubleBpm = computed(() => bpmValue.value < bpmMax.value - 1e-9);

function clampValue(v: number): number {
  if (freeInput.value) return v;
  const c = Math.min(bpmMax.value, Math.max(bpmMin.value, v));
  return roundValue(c, bpmDecimals.value);
}

/** +/- buttons multiply / divide the BPM value (or multiplier) by `factor`. */
function scaleBpmValue(factor: number): void {
  bpmValue.value = clampValue(bpmValue.value * factor);
  bpmDraft.value = formatBpmDraft(bpmValue.value);
}
const effBpm = computed(() =>
  selBpm.value ? effectiveBpmFor(selBpm.value) : 0,
);
const markerColor = computed(() => {
  const m = selMarker.value;
  if (!m) return "var(--bdg-text-dim)";
  return (
    project.tracks.find((tr) => tr.id === m.trackId)?.color ??
    "var(--bdg-text-dim)"
  );
});
const bpmMode = computed<BpmMode>({
  get: () => selBpm.value?.mode ?? "abs",
  set: (m: BpmMode) => {
    if (selBpm.value) updateBpmPoint(selBpm.value.id, { mode: m });
  },
});
const selectedTrackId = computed<string>({
  get: () => selMarker.value?.trackId ?? "",
  set: (id: string) => {
    if (selMarker.value) changeMarkerTrack(selMarker.value.id, id);
  },
});
const trackOptions = computed(() =>
  project.tracks.map((tr) => ({ value: tr.id, label: tr.name })),
);
const bpmModeOptions = computed<Array<{ value: string; label: string }>>(() => [
  { value: "abs", label: t("prop.modeAbs") },
  { value: "mult", label: t("prop.modeMult") },
]);
const markerTime = computed(() =>
  selMarker.value ? storeMarkerTime(selMarker.value) : 0,
);
const bpmTime = computed(() =>
  selBpm.value ? timeOfBeat(selBpm.value.beat) : 0,
);

// ---- plugin-typed marker attributes ----

const typedMarkerInfo = computed<{
  def: TrackTypeDef | null;
  missing: boolean;
  plugin: string;
  pointLabel: string;
} | null>(() => {
  const m = selMarker.value;
  if (!m) return null;
  const tr = project.tracks.find((x) => x.id === m.trackId);
  const typeKey = tr?.type;
  if (!typeKey || typeKey === "beat") return null;
  const def = getTypedef(typeKey);
  return {
    def,
    missing: !def,
    plugin: pluginIdOfType(typeKey),
    pointLabel: def ? localeText(def.pointName) : typeKey,
  };
});

const typedFields = computed<PluginFieldDef[]>(
  () => typedMarkerInfo.value?.def?.fields ?? [],
);

const markerAttrsJson = computed(() => {
  const m = selMarker.value;
  if (!m?.attrs) return "";
  return JSON.stringify(m.attrs, null, 2);
});

function markerFieldValue(f: PluginFieldDef): unknown {
  const m = selMarker.value;
  const v = m?.attrs?.[f.key];
  return v === undefined ? defaultForField(f) : v;
}

function setMarkerField(f: PluginFieldDef, v: unknown): void {
  const m = selMarker.value;
  if (!m) return;
  updateMarkerAttrs(m.id, { [f.key]: v });
}

function fieldLabel(f: PluginFieldDef): string {
  return localeText(f.label) || f.key;
}

function enumOptionLabel(o: {
  value: string | number | boolean;
  label: string | Record<string, string>;
}): string {
  return localeText(o.label);
}

/** Plugin enum options adapted to UiSelect's string-valued model. */
function enumSelectOptions(f: PluginFieldDef): Array<{
  value: string;
  label: string;
}> {
  return (f.options ?? []).map((o) => ({
    value: String(o.value),
    label: enumOptionLabel(o),
  }));
}

function onEnumSelect(f: PluginFieldDef, v: string): void {
  const opt = (f.options ?? []).find((o) => String(o.value) === v);
  if (opt) onEnumField(f, opt.value);
}

function onNumberField(f: PluginFieldDef, v: number | undefined): void {
  setMarkerField(f, v ?? 0);
}
function onTextField(f: PluginFieldDef, v: string): void {
  setMarkerField(f, v);
}
function onBoolField(f: PluginFieldDef, v: boolean): void {
  setMarkerField(f, v === true);
}
function onEnumField(f: PluginFieldDef, v: unknown): void {
  setMarkerField(f, v);
}

function onCardKey(e: KeyboardEvent): void {
  if ((e.target as HTMLElement)?.tagName === "INPUT") return;
  if (e.key === "Escape") {
    closeCard();
    ghostState.value = null;
  }
}

function deleteSelected(): void {
  const sel = selection.selected;
  if (sel.kind === "marker" && sel.id) removeMarker(sel.id);
  else if (sel.kind === "bpm" && sel.id) removeBpmPoint(sel.id);
  closeCard();
  ghostState.value = null;
}

onMounted(() => {
  setupCanvas();
  // Repaint whenever reactive state read by draw()/drawScrollbars() changes.
  // Registered after setupCanvas so the first run has a live canvas to track
  // against and paint into.
  stopPaint = watchEffect(() => {
    void renderNonce.value;
    paint();
  });
  ro = new ResizeObserver(() => {
    setupCanvas();
    draw();
    positionCard();
  });
  if (rootEl.value) ro.observe(rootEl.value);
  window.addEventListener("keydown", onCardKey);
  raf = requestAnimationFrame(loop);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  stopPaint?.();
  stopPaint = null;
  ro?.disconnect();
  cardRo?.disconnect();
  window.removeEventListener("keydown", onCardKey);
});

const summary = computed(() => {
  const mm = project.markers.length;
  return `${t("sidebar.markerTrack")} × ${project.tracks.length} · ${t("sidebar.markers")} ${mm}`;
});

/** When multiple markers are selected, show start/end ms of the selection range. */
const selectionMs = computed<string | null>(() => {
  const ids = markerSelectionIds();
  if (ids.length < 2) return null;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const id of ids) {
    const m = project.markers.find((x) => x.id === id);
    if (!m) continue;
    const ms = storeMarkerTime(m);
    if (ms < lo) lo = ms;
    if (ms > hi) hi = ms;
  }
  if (!Number.isFinite(lo)) return null;
  return `⌖ ${Math.round(lo)}ms – ${Math.round(hi)}ms`;
});
</script>

<template>
  <div
    ref="rootEl"
    class="editor"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @wheel="onWheel"
    @contextmenu.prevent="onContext"
  >
    <canvas ref="canvasEl" class="editor-canvas" />

    <div class="notes-layer">
      <div
        v-for="nl in noteLayouts"
        :key="nl.id"
        class="note"
        :class="{ locked: nl.locked }"
        :style="{ left: nl.left + 'px', top: nl.top + 'px' }"
        @pointerdown.stop="onNoteDown($event, noteOf(nl.id))"
        @wheel.stop
        @contextmenu.stop
      >
        <div class="note-head">
          <span class="note-grip">⠿</span>
          <span class="note-title">{{ t("note.title") }}</span>
          <span class="note-tools">
            <button
              class="note-tool"
              :title="t('note.lock')"
              @click.stop="setNoteLocked(nl.id, !nl.locked)"
            >
              {{ nl.locked ? "🔒" : "🔓" }}
            </button>
            <button
              class="note-tool"
              :title="t('note.delete')"
              @click.stop="removeNote(nl.id)"
            >
              ✕
            </button>
          </span>
        </div>
        <div v-if="editingNoteId === nl.id" class="note-edit">
          <textarea
            v-model="editingDraft"
            spellcheck="false"
            @blur="commitNoteEdit"
            @keydown.esc.stop.prevent="cancelNoteEdit"
            @keydown.ctrl.enter.stop.prevent="commitNoteEdit"
            @pointerdown.stop
          />
        </div>
        <div
          v-else
          class="note-body md"
          :title="t('note.editHint')"
          @dblclick.stop="startNoteEdit(noteOf(nl.id))"
          v-html="noteHtml(noteTextOf(nl.id))"
        />
      </div>
    </div>

    <div
      v-if="!transport.hasAudio && project.markers.length === 0"
      class="editor-hint"
    >
      <div>{{ t("timeline.none") }}</div>
      <div class="editor-hint-sub">
        {{ t("timeline.hintNew") }}
        <br />{{ t("timeline.hintBeatAxis") }}
      </div>
    </div>

    <div ref="vbarEl" class="vbar">
      <div ref="vthumbEl" class="vthumb" @pointerdown="startVBarDrag" />
    </div>
    <div ref="hbarEl" class="hbar">
      <div ref="hthumbEl" class="hthumb" @pointerdown="startHBarDrag" />
    </div>

    <div class="editor-statusbar">
      <span>{{ summary }}</span>
      <span class="sep">·</span>
      <span>{{ t("timeline.tempoHint") }}</span>
      <span v-if="view.snapEnabled" class="sep">·</span>
      <span v-if="view.snapEnabled" class="num">snap 1/{{ view.snapDiv }}</span>
      <span v-if="selectionMs" class="sep">·</span>
      <span v-if="selectionMs" class="num">{{ selectionMs }}</span>
    </div>

    <div
      v-if="cardVisible && (selMarker || selBpm)"
      ref="cardEl"
      class="prop-card"
      :style="{ left: cardPos.x + 'px', top: cardPos.y + 'px' }"
      @pointerdown.stop
      @pointerup.stop
      @pointermove.stop
      @pointercancel.stop
      @wheel.stop
      @contextmenu.stop
    >
      <template v-if="selMarker">
        <div
          class="pc-head"
          @pointerdown.stop="startCardDrag"
          @pointermove.stop="onCardDrag"
          @pointerup.stop="endCardDrag"
          @pointercancel.stop="endCardDrag"
        >
          <span class="pc-dot" :style="{ background: markerColor }" />
          <b>{{ t("keys.marker") }}</b>
          <button class="pc-x" @click="closeCard()">✕</button>
        </div>
        <label class="pc-field">
          <span>{{ t("prop.beatPos") }}</span>
          <UiNumberInput
            v-model="markerBeat"
            :min="freeInput ? undefined : 0"
            :step="1 / view.snapDiv"
            :precision="4"
            class="w-full"
          />
        </label>
        <div class="pc-sub num">
          {{ t("prop.asBar") }}: {{ fmtBar(markerBeat) }} ·
          {{ t("prop.time") }}: {{ formatTime(markerTime) }}
        </div>
        <label class="pc-field">
          <span>{{ t("prop.track") }}</span>
          <UiSelect
            v-model="selectedTrackId"
            size="sm"
            :options="trackOptions"
            class="w-full"
          />
        </label>
        <div class="pc-loop-row">
          <span class="pc-field-label">{{ t("prop.loop") }}</span>
          <UiSwitch v-model="loopOn" />
        </div>
        <template v-if="loopOn">
          <div class="pc-loop-fields">
            <div class="pc-field">
              <span>{{ t("prop.loopInterval") }}</span>
              <div class="pc-stepper num">
                <button
                  type="button"
                  class="pc-step"
                  :disabled="!canHalve"
                  @click="scaleLoopInterval(1 / 2)"
                >
                  −
                </button>
                <UiInput
                  v-model="loopDraft"
                  class="pc-step-input"
                  @focus="loopDraftBegin"
                  @blur="loopDraftCommit"
                  @keyup.enter="loopDraftCommit"
                  @keyup.esc="loopDraftCancel"
                />
                <button
                  type="button"
                  class="pc-step"
                  :disabled="!canDouble"
                  @click="scaleLoopInterval(2)"
                >
                  ＋
                </button>
              </div>
            </div>
            <label class="pc-field">
              <span>{{ t("prop.loopCount") }}</span>
              <UiNumberInput
                v-model="loopCount"
                :min="freeInput ? undefined : 1"
                :max="freeInput ? undefined : MAX_LOOP_CHILDREN"
                :step="1"
                class="w-full"
                @wheel="onLoopCountWheel"
              />
            </label>
          </div>
          <div class="pc-sub num">{{ t("prop.loopHint") }}</div>
        </template>

        <div v-if="typedMarkerInfo" class="pc-attrs">
          <div class="pc-attrs-title">
            {{ typedMarkerInfo.pointLabel }}
            <span v-if="typedMarkerInfo.missing" class="pc-missing-tag">
              {{ t("prop.attrsMissingTag") }}
            </span>
          </div>

          <div v-if="typedMarkerInfo.missing" class="pc-missing">
            <span>
              {{ t("prop.attrsMissing", { plugin: typedMarkerInfo.plugin }) }}
            </span>
            <pre class="pc-raw num">{{ markerAttrsJson }}</pre>
          </div>

          <template v-else>
            <label v-for="f in typedFields" :key="f.key" class="pc-field">
              <span>{{ fieldLabel(f) }}</span>

              <UiNumberInput
                v-if="f.type === 'number'"
                :model-value="Number(markerFieldValue(f) ?? 0)"
                :min="freeInput ? undefined : f.min"
                :max="freeInput ? undefined : f.max"
                :step="f.step ?? 1"
                class="w-full"
                @update:model-value="(v: number) => onNumberField(f, v)"
              />
              <UiInput
                v-else-if="f.type === 'string'"
                :model-value="String(markerFieldValue(f) ?? '')"
                @blur="
                  (e: FocusEvent) =>
                    onTextField(f, (e.target as HTMLInputElement).value)
                "
                @keyup.enter="
                  onTextField(f, ($event.target as HTMLInputElement).value)
                "
              />
              <UiSwitch
                v-else-if="f.type === 'bool'"
                :model-value="markerFieldValue(f) === true"
                @update:model-value="(v: boolean) => onBoolField(f, v)"
              />
              <UiSelect
                v-else-if="f.type === 'enum'"
                :model-value="String(markerFieldValue(f))"
                size="sm"
                class="pc-enum"
                :options="enumSelectOptions(f)"
                @update:model-value="(v: string) => onEnumSelect(f, v)"
              />
            </label>
          </template>
        </div>
      </template>

      <template v-else-if="selBpm">
        <div
          class="pc-head"
          @pointerdown.stop="startCardDrag"
          @pointermove.stop="onCardDrag"
          @pointerup.stop="endCardDrag"
          @pointercancel.stop="endCardDrag"
        >
          <span class="pc-dot bpm" />
          <b>{{ t("keys.bpmPoint") }}</b>
          <button class="pc-x" @click="closeCard()">✕</button>
        </div>
        <label class="pc-field">
          <span>{{ t("prop.beatPos") }}</span>
          <UiNumberInput
            v-model="bpmBeat"
            :min="freeInput ? undefined : 0"
            :step="1 / view.snapDiv"
            :precision="4"
            class="w-full"
          />
        </label>
        <div class="pc-sub num">
          {{ t("prop.asBar") }}: {{ fmtBar(bpmBeat) }} · {{ t("prop.time") }}:
          {{ formatTime(bpmTime) }}
        </div>
        <div class="pc-mode">
          <UiRadioGroup
            :model-value="bpmMode"
            :options="bpmModeOptions"
            @update:model-value="(v: string) => (bpmMode = v as BpmMode)"
          />
        </div>
        <div class="pc-field">
          <span>{{
            bpmMode === "mult" ? t("prop.multValue") : t("prop.absValue")
          }}</span>
          <div class="pc-stepper num">
            <button
              type="button"
              class="pc-step"
              :disabled="!canHalveBpm"
              @click="scaleBpmValue(1 / 2)"
            >
              −
            </button>
            <UiInput
              v-model="bpmDraft"
              class="pc-step-input"
              @focus="bpmDraftBegin"
              @blur="bpmDraftCommit"
              @keyup.enter="bpmDraftCommit"
              @keyup.esc="bpmDraftCancel"
            />
            <button
              type="button"
              class="pc-step"
              :disabled="!canDoubleBpm"
              @click="scaleBpmValue(2)"
            >
              ＋
            </button>
          </div>
        </div>
        <div class="pc-sub num">
          {{ t("prop.effective") }}: {{ effBpm.toFixed(1) }} BPM
        </div>
      </template>

      <div class="pc-actions">
        <UiButton size="sm" variant="danger" @click="deleteSelected">{{
          t("prop.delete")
        }}</UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  background: var(--bdg-bg);
}
.editor-canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: block;
}
.notes-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
}
.note {
  position: absolute;
  pointer-events: auto;
  width: 180px;
  min-height: 70px;
  background: var(--bdg-bg-raised);
  border: 1px solid rgb(var(--bdg-neutral) / 0.35);
  border-left: 3px solid var(--bdg-accent);
  border-radius: 8px;
  box-shadow: 0 4px 16px var(--bdg-shadow);
  overflow: hidden;
  user-select: none;
}
.note.locked {
  border-left-color: var(--bdg-amber);
}
.note.locked .note-body {
  opacity: 0.6;
}
.note-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: rgb(var(--bdg-neutral) / 0.12);
  cursor: grab;
}
.note.locked .note-head {
  cursor: default;
}
.note-grip {
  color: var(--bdg-text-dim);
  font-size: 12px;
  line-height: 1;
}
.note-title {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--bdg-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.note-tools {
  display: inline-flex;
  gap: 2px;
}
.note-tool {
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  color: var(--bdg-text-dim);
  cursor: pointer;
  border-radius: 5px;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.note-tool:hover {
  background: rgb(var(--bdg-neutral) / 0.18);
  color: var(--bdg-text);
}
.note-body {
  padding: 6px 8px 7px;
  font-size: 12px;
  cursor: default;
  position: relative;
}
.note-body::after {
  content: "dbl-click:edit";
  position: absolute;
  right: 6px;
  bottom: -2px;
  font-size: 9px;
  color: rgb(var(--bdg-neutral) / 0.35);
  line-height: 1;
}
.note-body.md h1 {
  font-size: 14px;
  margin: 0 0 4px;
}
.note-body.md h2,
.note-body.md h3 {
  font-size: 12.5px;
  margin: 0 0 3px;
}
.note-body.md p {
  margin: 0 0 4px;
  white-space: pre-wrap;
}
.note-body.md ul,
.note-body.md ol {
  padding-left: 16px;
  margin: 0 0 4px;
}
.note-body.md li {
  margin-bottom: 1px;
}
.note-body.md code {
  background: rgb(var(--bdg-neutral) / 0.15);
  padding: 0 3px;
  border-radius: 3px;
  font-size: 11px;
}
.note-body.md a {
  color: var(--bdg-accent);
}
.note-edit {
  padding: 6px;
}
.note-edit textarea {
  width: 100%;
  min-height: 76px;
  background: var(--bdg-bg-sunken);
  border: 1px solid var(--bdg-border-strong);
  border-radius: 6px;
  color: var(--bdg-text);
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
  resize: vertical;
  padding: 4px 6px;
  outline: none;
  user-select: text;
}
.editor-hint {
  position: absolute;
  inset: 0 0 40px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  pointer-events: none;
  color: var(--bdg-text-dim);
  text-align: center;
  font-size: 14px;
}
.editor-hint-sub {
  font-size: 12px;
  opacity: 0.8;
}
.editor-statusbar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 22px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  font-size: 11px;
  color: var(--bdg-text-dim);
  background: rgb(var(--bdg-bg-rgb) / 0.88);
  border-top: 1px solid var(--bdg-border);
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
}
.editor-statusbar .sep {
  opacity: 0.4;
}
.vbar {
  position: absolute;
  top: 48px;
  right: 0;
  bottom: 22px;
  width: 10px;
  background: rgb(var(--bdg-neutral) / 0.08);
  border-left: 1px solid var(--bdg-border);
  display: none;
}
.vthumb {
  width: 8px;
  margin: 1px auto;
  background: rgb(var(--bdg-neutral) / 0.3);
  border-radius: 4px;
  cursor: pointer;
}
.hbar {
  position: absolute;
  left: 0;
  right: 10px;
  bottom: 0;
  height: 10px;
  background: rgb(var(--bdg-neutral) / 0.08);
  border-top: 1px solid var(--bdg-border);
  display: none;
}
.hthumb {
  height: 8px;
  margin: 1px 0;
  background: rgb(var(--bdg-neutral) / 0.3);
  border-radius: 4px;
  cursor: pointer;
}
.prop-card {
  position: absolute;
  z-index: 20;
  width: 236px;
  background: var(--bdg-menu);
  border: 1px solid var(--bdg-border-strong);
  border-radius: 10px;
  padding: 10px;
  box-shadow: 0 8px 24px var(--bdg-shadow);
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
}
.pc-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 7px;
  background: var(--bdg-menu);
  cursor: move;
  user-select: none;
  touch-action: none;
}
.pc-dot {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  transform: rotate(45deg);
  flex: none;
}
.pc-dot.bpm {
  background: var(--bdg-bpm);
}
.pc-x {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--bdg-text-dim);
  cursor: pointer;
  font-size: 11px;
}
.pc-x:hover {
  color: var(--bdg-text);
}
.pc-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
  color: var(--bdg-text-dim);
}
.pc-mode {
  display: flex;
}
.pc-sub {
  font-size: 11px;
  color: var(--bdg-text-dim);
}
.pc-actions {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--bdg-border);
  padding-top: 8px;
}

.pc-loop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pc-loop-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.pc-attrs {
  border-top: 1px solid var(--bdg-border);
  padding-top: 8px;
  margin-top: 4px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.pc-attrs-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--bdg-text);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  display: flex;
  align-items: center;
  gap: 6px;
}
.pc-missing-tag {
  font-size: 9px;
  color: var(--bdg-amber);
  background: rgb(var(--bdg-amber-rgb) / 0.14);
  padding: 1px 6px;
  border-radius: 4px;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 600;
}
.pc-missing {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--bdg-text-dim);
  font-size: 11px;
}
.pc-raw {
  margin: 0;
  padding: 6px;
  background: rgb(var(--bdg-neutral) / 0.06);
  border: 1px solid var(--bdg-border);
  border-radius: 6px;
  max-height: 120px;
  overflow: auto;
  font-size: 10px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--bdg-text);
}
.pc-enum {
  width: 100%;
}
.pc-stepper {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.pc-step-input {
  width: 100%;
}
.pc-step {
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  min-width: 22px;
  max-width: 22px;
  box-sizing: border-box;
  border-radius: 5px;
  border: 1px solid var(--bdg-border-strong);
  background: rgb(var(--bdg-neutral) / 0.08);
  color: var(--bdg-text);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}
.pc-step:hover:not(:disabled) {
  background: rgb(var(--bdg-neutral) / 0.2);
  color: var(--bdg-accent);
}
.pc-step:disabled {
  opacity: 0.3;
  cursor: default;
}
</style>
