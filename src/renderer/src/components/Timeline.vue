<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  store,
  markersInTrack,
  addMarker,
  addBpmPoint,
  updateBpmPoint,
  moveMarker,
  changeMarkerTrack,
  removeMarker,
  removeBpmPoint,
  effectiveBpmFor,
  beatOfTime,
  timeOfBeat,
  contentEndMs,
  seekTo,
  formatTime,
  select,
} from "../store";
import { snapBeat, beatParts } from "../tempo";
import {
  view,
  setScroll,
  setViewport,
  contentWidthPx,
  lanesTotalH,
  maxX,
  maxY,
  timeToScreenX,
  screenToTime,
} from "../editorView";
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
import type { BpmMode, Marker, MarkerTrack, BpmPoint } from "../types";

const { t } = useI18n();

const rootEl = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);

const vbarEl = ref<HTMLElement | null>(null);
const vthumbEl = ref<HTMLElement | null>(null);
const hbarEl = ref<HTMLElement | null>(null);
const hthumbEl = ref<HTMLElement | null>(null);

let raf = 0;
let ro: ResizeObserver | null = null;

let mode:
  "idle" | "scrub" | "placeBpm" | "placeMarker" | "dragBpm" | "dragMarker" =
  "idle";
let activePointer = -1;
let downX = 0;
let downY = 0;
let moved = false;
let dragId: string | null = null;
let dragTrackId: string | null = null;

const hover = { x: -1, y: -1 };

const trackAt = (i: number): MarkerTrack | undefined => store.project.tracks[i];

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
  return store.ui.snapEnabled
    ? snapBeat(Math.max(0, raw), store.ui.snapDiv)
    : raw;
}

function markerOccupy(trackId: string, beat: number): boolean {
  return markersInTrack(trackId).some((m) => Math.abs(m.beat - beat) < 1 / 256);
}

function bpmOccupy(beat: number): boolean {
  return store.project.bpmPoints.some((p) => Math.abs(p.beat - beat) < 1e-6);
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
  drawGridLines(ctx, W, H, t0, t1, X, endMs);
  drawBpmLaneContent(ctx, W, H, t0, t1, X);
  drawMarkerLanesContent(ctx, W, H, t0, t1, X);
  drawGhost(ctx, W, H, X);
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
  const pps = store.ui.pxPerSec;
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
  const n = store.project.tracks.length;
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
  }
  // outer top separator under ruler
  ctx.fillStyle = COLORS.rowLine;
  ctx.fillRect(0, RULER_H - 1, W, 1);
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
  const pps = store.ui.pxPerSec;
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
  // subdivisions when zoomed & snap on
  if (store.ui.snapEnabled && store.ui.snapDiv > 1) {
    const div = store.ui.snapDiv;
    const b0s = Math.max(0, Math.floor(beatOfTime(t0) * div) - 1);
    const b1s = Math.ceil(beatOfTime(t1) * div) + 1;
    for (let s = b0s; s <= b1s; s++) {
      const beat = s / div;
      if (Math.abs(beat * div - Math.round(beat * div)) > 1e-9) continue;
      if (Math.abs(beat - Math.round(beat)) < 1e-6) continue;
      const tm = timeOfBeat(beat);
      const prev = timeOfBeat(beat - 1 / div);
      if ((tm - prev) * pps < 6) break;
      const x = X(tm);
      if (x < -2 || x > W + 2) continue;
      ctx.fillStyle = COLORS.gridSub;
      ctx.fillRect(x, RULER_H, 1, H - RULER_H);
    }
  }
  void endMs;
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
  const wave = store.ui.wave;
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
  const segs = store.project.bpmPoints.length ? effectiveSegments() : [];
  if (store.project.bpmPoints.length) {
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
      ctx.fillStyle = "#f59e0b";
      ctx.fillRect(mid, y1 - 6, Math.max(0, x1 - mid), 3);
      ctx.globalAlpha = 1;
    }
    void floorBeat;
  }

  // bpm points
  for (const p of store.project.bpmPoints) {
    const x = X(timeOfBeat(p.beat));
    if (x < -8 || x > W + 8) continue;
    const sel =
      store.ui.selected.kind === "bpm" && store.ui.selected.id === p.id;
    ctx.fillStyle = sel ? COLORS.bpmPointSelected : COLORS.bpmPoint;
    drawDiamond(ctx, x, y0 + 8, sel ? 5 : 3.6);
    ctx.fillStyle = "rgba(245,158,11,0.35)";
    ctx.fillRect(x - 0.5, y0 + 12, 1, y1 - y0 - 12);
  }
}

function effectiveSegments(): Array<{
  beatStart: number;
  beatEnd: number | null;
  bpm: number;
}> {
  const pts = [...store.project.bpmPoints].sort((a, b) => a.beat - b.beat);
  const segs: Array<{
    beatStart: number;
    beatEnd: number | null;
    bpm: number;
  }> = [];
  let curBpm = store.project.baseBpm;
  let startBeat = 0;
  for (const p of pts) {
    if (p.beat <= startBeat) continue;
    segs.push({ beatStart: startBeat, beatEnd: p.beat, bpm: curBpm });
    curBpm = p.mode === "abs" ? clampNum(p.value) : curBpm * p.value;
    startBeat = p.beat;
  }
  segs.push({ beatStart: startBeat, beatEnd: null, bpm: curBpm });
  return segs;
}

function clampNum(v: number): number {
  return Math.min(999, Math.max(20, v));
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
  for (const r of rows) {
    const track = trackAt(r.i);
    if (!track) continue;
    for (const m of markersInTrack(track.id)) {
      const x = X(timeOfBeat(m.beat));
      if (x < -16 || x > W + 16) continue;
      const sel =
        store.ui.selected.kind === "marker" && store.ui.selected.id === m.id;
      const cy = r.y + r.h / 2;
      // faint vertical stem
      ctx.fillStyle = sel ? COLORS.markerSelected : track.color;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x - 1, r.y + 4, 2, r.h - 8);
      ctx.globalAlpha = 1;
      // big diamond marker
      const rr = sel ? 9 : 7;
      drawDiamond(ctx, x, cy, rr);
      if (sel) {
        const label = formatTime(timeOfBeat(m.beat));
        ctx.font = "10px Consolas, monospace";
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(20,23,27,0.92)";
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
  ctx.fillStyle = "rgba(20,23,27,0.92)";
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
  return b.toFixed(store.ui.snapDiv <= 4 ? 2 : 3);
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
  const x = X(store.ui.positionMs);
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
    if (Math.abs(timeToScreenX(timeOfBeat(m.beat)) - x) <= HIT_PX) return m;
  }
  return null;
}

function hitBpmAt(x: number, y: number): BpmPoint | null {
  const lane = laneKindAt(y);
  if (lane.kind !== "bpm") return null;
  for (const p of store.project.bpmPoints) {
    if (Math.abs(timeToScreenX(timeOfBeat(p.beat)) - x) <= HIT_PX) return p;
  }
  return null;
}

const cardPos = ref({ x: 0, y: 0 });
const openCard = (x: number, y: number): void => {
  cardPos.value = { x, y };
};

// ---- events ----

function onContext(e: MouseEvent): void {
  const rect = rootEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (y < RULER_H) return;
  const mk = hitMarkerAt(x, y);
  if (mk) {
    removeMarker(mk.id);
    select(null, null);
    ghostState.value = null;
    return;
  }
  const bp = hitBpmAt(x, y);
  if (bp) {
    removeBpmPoint(bp.id);
    select(null, null);
    ghostState.value = null;
  }
}


function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  const rect = rootEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  downX = x;
  downY = y;
  moved = false;
  activePointer = e.pointerId;
  rootEl.value!.setPointerCapture(activePointer);

  if (y < RULER_H) {
    mode = "scrub";
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
    mode = "dragMarker";
    dragId = mkHit.id;
    dragTrackId = mkHit.trackId;
    select("marker", mkHit.id);
    return;
  }
  const lane = laneKindAt(y);
  mode = lane.kind === "bpm" ? "placeBpm" : "placeMarker";
  if (lane.kind === "marker") select(null, null);
}

function onPointerMove(e: PointerEvent): void {
  const rect = rootEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  hover.x = x;
  hover.y = y;
  if (Math.abs(x - downX) > 3 || Math.abs(y - downY) > 3) moved = true;

  const lane = laneKindAt(y);
  if (mode === "scrub") {
    store.ui.positionMs = Math.max(
      0,
      Math.min(screenToTime(x), contentEndMs()),
    );
    if (rootEl.value) store.ui.positionMs = store.ui.positionMs;
    seekPlayhead();
    return;
  }
  if (mode === "dragBpm" && dragId) {
    const raw = doSnap(Math.max(0, beatOfTime(screenToTime(x))));
    if (!e.altKey && !bpmOccupy(raw)) updateBpmPoint(dragId, { beat: raw });
  } else if (mode === "dragMarker" && dragId && dragTrackId) {
    const raw = doSnap(Math.max(0, beatOfTime(screenToTime(x))));
    const ok = !e.altKey ? !markerOccupy(dragTrackId, raw) : true;
    if (ok) moveMarker(dragId, raw, true);
  } else if ((mode === "placeBpm" || mode === "placeMarker") && lane) {
    updateGhost(lane);
  }
}

function seekPlayhead(msRaw?: number): void {
  const ms = Math.max(
    0,
    Math.min(msRaw ?? store.ui.positionMs, contentEndMs()),
  );
  store.ui.positionMs = ms;
  seekTo(ms);
}

function onPointerUp(e: PointerEvent): void {
  if (activePointer !== e.pointerId) return;
  const rect = rootEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (!moved) {
    if (mode === "scrub") {
      seekPlayhead();
    } else if (mode === "placeBpm") {
      const beat = doSnap(Math.max(0, beatOfTime(screenToTime(x))));
      const pt = addBpmPoint(beat);
      if (pt)
        openCard(
          Math.min(x, rootEl.value!.clientWidth - 240),
          Math.min(y, rootEl.value!.clientHeight - 180),
        );
    } else if (mode === "placeMarker") {
      const lane = laneKindAt(y);
      const track = lane.kind === "marker" ? trackAt(lane.index) : undefined;
      if (track) {
        const beat = doSnap(Math.max(0, beatOfTime(screenToTime(x))));
        const m = addMarker(track.id, beat);
        if (m)
          openCard(
            Math.min(x, rootEl.value!.clientWidth - 240),
            Math.min(y, rootEl.value!.clientHeight - 180),
          );
      }
    } else if (mode === "dragBpm") {
      openCard(
        Math.min(x, rootEl.value!.clientWidth - 240),
        Math.min(y, rootEl.value!.clientHeight - 180),
      );
    } else if (mode === "dragMarker") {
      openCard(
        Math.min(x, rootEl.value!.clientWidth - 240),
        Math.min(y, rootEl.value!.clientHeight - 180),
      );
    }
  }
  mode = "idle";
  dragId = null;
  dragTrackId = null;
  activePointer = -1;
  ghostState.value = null;
}

function onPointerCancel(): void {
  mode = "idle";
  dragId = null;
  dragTrackId = null;
  activePointer = -1;
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

function onWheel(e: WheelEvent): void {
  const root = rootEl.value!;
  e.preventDefault();
  const rect = root.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  if (e.ctrlKey || e.metaKey) {
    const t = screenToTime(mx);
    const f = e.deltaY < 0 ? 1.25 : 1 / 1.25;
    const next = Math.min(
      MAX_PX_PER_SEC,
      Math.max(MIN_PX_PER_SEC, store.ui.pxPerSec * f),
    );
    const tx = (t / 1000) * next;
    store.ui.pxPerSec = next;
    setScroll(Math.max(0, tx - mx), view.y);
    return;
  }
  const dx = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
  const dy = e.deltaX !== 0 || e.shiftKey ? 0 : e.deltaY;
  setScroll(view.x + (dx || 0), view.y + dy);
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
  draw();
  drawScrollbars();
  if (store.ui.playing && store.ui.settings.followScroll) {
    const tpx = (store.ui.positionMs / 1000) * store.ui.pxPerSec;
    const W = view.vw;
    const f = Math.min(1, Math.max(0, store.ui.settings.followPercent / 100));
    const line = view.x + W * f;
    if (tpx > line) {
      setScroll(Math.max(0, tpx - W * f), view.y);
    } else if (tpx < view.x - W * 0.5) {
      // jumped far behind: pull the playhead back into view
      setScroll(Math.max(0, tpx - W * f), view.y);
    }
  }
  raf = requestAnimationFrame(loop);
}

// ---- card object accessors ----

const selMarker = computed<Marker | null>(() =>
  store.ui.selected.kind === "marker"
    ? (store.project.markers.find((m) => m.id === store.ui.selected.id) ?? null)
    : null,
);
const selBpm = computed<BpmPoint | null>(() =>
  store.ui.selected.kind === "bpm"
    ? (store.project.bpmPoints.find((p) => p.id === store.ui.selected.id) ??
      null)
    : null,
);
const cardVisible = computed(() => store.ui.selected.kind !== null);

const markerBeat = computed({
  get: () => selMarker.value?.beat ?? 0,
  set: (v: number) => {
    if (selMarker.value) moveMarker(selMarker.value.id, Math.max(0, v), true);
  },
});
const bpmBeat = computed({
  get: () => selBpm.value?.beat ?? 0,
  set: (v: number) => {
    if (selBpm.value) updateBpmPoint(selBpm.value.id, { beat: Math.max(0, v) });
  },
});
const bpmValue = computed({
  get: () => selBpm.value?.value ?? 120,
  set: (v: number) => {
    if (selBpm.value) updateBpmPoint(selBpm.value.id, { value: v });
  },
});
const effBpm = computed(() =>
  selBpm.value ? effectiveBpmFor(selBpm.value) : 0,
);
const markerColor = computed(() => {
  const m = selMarker.value;
  if (!m) return "#888";
  return (
    store.project.tracks.find((tr) => tr.id === m.trackId)?.color ?? "#888"
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
const markerTime = computed(() =>
  selMarker.value ? timeOfBeat(selMarker.value.beat) : 0,
);
const bpmTime = computed(() =>
  selBpm.value ? timeOfBeat(selBpm.value.beat) : 0,
);

function onCardKey(e: KeyboardEvent): void {
  if ((e.target as HTMLElement)?.tagName === "INPUT") return;
  if (e.key === "Escape") {
    select(null, null);
    ghostState.value = null;
  }
}

function deleteSelected(): void {
  const sel = store.ui.selected;
  if (sel.kind === "marker" && sel.id) removeMarker(sel.id);
  else if (sel.kind === "bpm" && sel.id) removeBpmPoint(sel.id);
  select(null, null);
  ghostState.value = null;
}

onMounted(() => {
  setupCanvas();
  ro = new ResizeObserver(() => {
    setupCanvas();
    draw();
  });
  if (rootEl.value) ro.observe(rootEl.value);
  window.addEventListener("keydown", onCardKey);
  raf = requestAnimationFrame(loop);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  ro?.disconnect();
  window.removeEventListener("keydown", onCardKey);
});

const summary = computed(() => {
  const mm = store.project.markers.length;
  return `${t("sidebar.markerTrack")} × ${store.project.tracks.length} · ${t("sidebar.markers")} ${mm}`;
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

    <div
      v-if="!store.ui.hasAudio && store.project.markers.length === 0"
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
      <span v-if="store.ui.snapEnabled" class="sep">·</span>
      <span v-if="store.ui.snapEnabled" class="num"
        >snap 1/{{ store.ui.snapDiv }}</span
      >
    </div>

    <div
      v-if="cardVisible && (selMarker || selBpm)"
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
        <div class="pc-head">
          <span class="pc-dot" :style="{ background: markerColor }" />
          <b>{{ t("keys.marker") }}</b>
          <button class="pc-x" @click="select(null, null)">✕</button>
        </div>
        <label class="pc-field">
          <span>{{ t("prop.beatPos") }}</span>
          <el-input-number
            v-model="markerBeat"
            :min="0"
            :step="1 / store.ui.snapDiv"
            :precision="4"
            size="small"
            controls-position="right"
            class="num"
          />
        </label>
        <div class="pc-sub num">
          {{ t("prop.asBar") }}: {{ fmtBar(markerBeat) }} ·
          {{ t("prop.time") }}: {{ formatTime(markerTime) }}
        </div>
        <label class="pc-field">
          <span>{{ t("prop.track") }}</span>
          <el-select v-model="selectedTrackId" size="small">
            <el-option
              v-for="tr in store.project.tracks"
              :key="tr.id"
              :value="tr.id"
              :label="tr.name"
            />
          </el-select>
        </label>
      </template>

      <template v-else-if="selBpm">
        <div class="pc-head">
          <span class="pc-dot bpm" />
          <b>{{ t("keys.bpmPoint") }}</b>
          <button class="pc-x" @click="select(null, null)">✕</button>
        </div>
        <label class="pc-field">
          <span>{{ t("prop.beatPos") }}</span>
          <el-input-number
            v-model="bpmBeat"
            :min="0"
            :step="1 / store.ui.snapDiv"
            :precision="4"
            size="small"
            controls-position="right"
            class="num"
          />
        </label>
        <div class="pc-sub num">
          {{ t("prop.asBar") }}: {{ fmtBar(bpmBeat) }} · {{ t("prop.time") }}:
          {{ formatTime(bpmTime) }}
        </div>
        <div class="pc-mode">
          <el-radio-group v-model="bpmMode" size="small">
            <el-radio-button value="abs">{{
              t("prop.modeAbs")
            }}</el-radio-button>
            <el-radio-button value="mult">{{
              t("prop.modeMult")
            }}</el-radio-button>
          </el-radio-group>
        </div>
        <label class="pc-field">
          <span>{{
            bpmMode === "mult" ? t("prop.multValue") : t("prop.absValue")
          }}</span>
          <el-input-number
            v-model="bpmValue"
            :min="bpmMode === 'mult' ? 0.01 : 20"
            :max="bpmMode === 'mult' ? 100 : 999"
            :step="bpmMode === 'mult' ? 0.05 : 1"
            :precision="bpmMode === 'mult' ? 3 : 1"
            size="small"
            controls-position="right"
            class="num"
          />
        </label>
        <div class="pc-sub num">
          {{ t("prop.effective") }}: {{ effBpm.toFixed(1) }} BPM
        </div>
      </template>

      <div class="pc-actions">
        <el-button size="small" type="danger" plain @click="deleteSelected">{{
          t("prop.delete")
        }}</el-button>
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
  background: rgba(20, 23, 27, 0.88);
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
  background: rgba(148, 163, 184, 0.08);
  border-left: 1px solid var(--bdg-border);
  display: none;
}
.vthumb {
  width: 8px;
  margin: 1px auto;
  background: #3a4453;
  border-radius: 4px;
  cursor: pointer;
}
.hbar {
  position: absolute;
  left: 0;
  right: 10px;
  bottom: 0;
  height: 10px;
  background: rgba(148, 163, 184, 0.08);
  border-top: 1px solid var(--bdg-border);
  display: none;
}
.hthumb {
  height: 8px;
  margin: 1px 0;
  background: #3a4453;
  border-radius: 4px;
  cursor: pointer;
}
.prop-card {
  position: absolute;
  z-index: 20;
  width: 236px;
  background: #1c222b;
  border: 1px solid var(--bdg-border-strong);
  border-radius: 10px;
  padding: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pc-head {
  display: flex;
  align-items: center;
  gap: 7px;
}
.pc-dot {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  transform: rotate(45deg);
  flex: none;
}
.pc-dot.bpm {
  background: #f59e0b;
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
  gap: 3px;
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
</style>
