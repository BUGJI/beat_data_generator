<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  store,
  sortedMarkers,
  snapTime,
  seekTo,
  addMarkerAt,
  removeMarkerAt,
  moveMarker,
  selectMarker,
  hitTest,
  beatMs,
  formatTime,
} from "../store";
import { engine } from "../engine";
import { COLORS, RULER_H, MAX_PX_PER_SEC, MIN_PX_PER_SEC } from "../metrics";

const { t } = useI18n();

const viewEl = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);
const spacerEl = ref<HTMLElement | null>(null);

let raf = 0;
let ro: ResizeObserver | null = null;

let mode: "idle" | "scrub" | "place" | "drag" = "idle";
let activePointer = -1;
let downX = 0;
let downY = 0;
let moved = false;
let dragId: string | null = null;
const hover = { x: -1, y: -1 };

const scrollLeft = (): number => viewEl.value?.scrollLeft ?? 0;
const clientW = (): number => viewEl.value?.clientWidth ?? 0;
const clientH = (): number => viewEl.value?.clientHeight ?? 0;
const beatGrid = computed(() => beatMs(store.project.bpm));

function totalTimeMs(): number {
  const durs: number[] = [];
  if (store.ui.hasAudio) durs.push(engine.durationMs());
  const last = store.project.markers.reduce((m, x) => Math.max(m, x.timeMs), 0);
  if (last > 0) durs.push(last);
  if (durs.length === 0) return beatGrid.value * 4;
  return Math.max(...durs);
}

function contentWidthPx(): number {
  return Math.max((totalTimeMs() / 1000) * store.ui.pxPerSec + 240, clientW());
}

function setupCanvas(): void {
  const cv = canvasEl.value;
  const v = viewEl.value;
  if (!cv || !v) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(v.clientWidth * dpr));
  cv.height = Math.max(1, Math.round(v.clientHeight * dpr));
  cv.style.width = `${v.clientWidth}px`;
  cv.style.height = `${v.clientHeight}px`;
  if (spacerEl.value) {
    spacerEl.value.style.height = `${v.clientHeight}px`;
    spacerEl.value.style.width = `${contentWidthPx()}px`;
  }
}

const timeToX = (ms: number): number => (ms / 1000) * store.ui.pxPerSec;
const timeAtX = (x: number): number =>
  ((scrollLeft() + x) / store.ui.pxPerSec) * 1000;

function draw(): void {
  const cv = canvasEl.value;
  const v = viewEl.value;
  if (!cv || !v) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = cv.width / dpr;
  const ch = cv.height / dpr;
  const totalPx = contentWidthPx();
  const maxScroll = Math.max(0, totalPx - cw);
  if (v.scrollLeft > maxScroll + 0.5) v.scrollLeft = maxScroll;
  const L = v.scrollLeft;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.translate(-L, 0);

  const t0 = (L / store.ui.pxPerSec) * 1000;
  const t1 = ((L + cw) / store.ui.pxPerSec) * 1000;
  const endMs = totalTimeMs();
  const viewL = L;
  const viewR = L + cw;

  const audioH = (ch - RULER_H) / 2;
  const audioY0 = RULER_H;
  const audioY1 = RULER_H + audioH;

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(viewL, 0, cw, ch);

  ctx.fillStyle = COLORS.laneAudioBg;
  ctx.fillRect(viewL, audioY0, cw, audioH);
  ctx.fillStyle = COLORS.laneMarkerBg;
  ctx.fillRect(viewL, audioY1, cw, ch - audioY1);

  drawGrid(ctx, t0, t1, viewL, viewR, ch, endMs);
  drawRuler(ctx, t0, t1, viewL, viewR);
  drawWaveform(ctx, audioY0, audioY1, t0, t1, viewL, viewR);

  ctx.fillStyle = "rgba(148,163,184,0.35)";
  ctx.fillRect(viewL, audioY0 - 1, viewR - viewL, 1);
  ctx.fillRect(viewL, audioY1 - 1, viewR - viewL, 1);

  if (endMs >= t0 - 500 && endMs <= t1 + 500) {
    const xEnd = timeToX(endMs);
    ctx.fillStyle = "rgba(148,163,184,0.4)";
    ctx.fillRect(xEnd, audioY0, 1, ch - audioY0);
  }

  drawMarkers(ctx, audioY1, viewL, viewR, ch);
  drawGhost(ctx, audioY1, ch, viewL, viewR);
  drawPlayhead(ctx, viewL, viewR, ch);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  t0: number,
  t1: number,
  L: number,
  R: number,
  ch: number,
  endMs: number,
): void {
  const offsetMs = store.project.offsetMs;
  const bd = beatGrid.value;
  const pps = store.ui.pxPerSec;
  const pxPerBeat = (bd / 1000) * pps;
  const div = store.ui.snapDiv;
  const drawSub = store.ui.snapEnabled && pxPerBeat / div >= 7;
  const drawBeats = pxPerBeat >= 8;
  const visible = (x: number, w = 0): boolean => x + w >= L && x <= R;

  if (drawBeats || drawSub || pxPerBeat * 4 >= 8) {
    const barEvery = 4;
    const barPx = pxPerBeat * barEvery;
    if (barPx >= 6) {
      ctx.fillStyle = COLORS.gridBar;
      const k0 = Math.floor((t0 - offsetMs) / bd / barEvery);
      const k1 = Math.ceil((t1 - offsetMs) / bd / barEvery);
      for (let k = k0; k <= k1; k++) {
        const x = timeToX(offsetMs + k * barEvery * bd);
        if (x < 0 || offsetMs + k * barEvery * bd > endMs + bd) continue;
        if (!visible(x)) continue;
        ctx.fillRect(x, 0, 1, ch);
        if (barPx > 46) {
          ctx.fillStyle = COLORS.barText;
          ctx.font = "10px Consolas, monospace";
          ctx.fillText(String(k + 1), x + 3, 12);
          ctx.fillStyle = COLORS.gridBar;
        }
      }
    }
    if (drawBeats) {
      ctx.fillStyle = COLORS.gridBeat;
      const k0 = Math.floor((t0 - offsetMs) / bd);
      const k1 = Math.ceil((t1 - offsetMs) / bd);
      for (let k = k0; k <= k1; k++) {
        if (k % barEvery === 0) continue;
        const ms = offsetMs + k * bd;
        if (ms < 0 || ms > endMs) continue;
        const x = timeToX(ms);
        if (!visible(x)) continue;
        ctx.fillRect(x, RULER_H, 1, ch - RULER_H);
      }
    }
    if (drawSub) {
      ctx.fillStyle = COLORS.gridSub;
      const gd = bd / div;
      const k0 = Math.floor((t0 - offsetMs) / gd);
      const k1 = Math.ceil((t1 - offsetMs) / gd);
      for (let k = k0; k <= k1; k++) {
        if (k % div === 0) continue;
        const ms = offsetMs + k * gd;
        if (ms < 0 || ms > endMs) continue;
        const x = timeToX(ms);
        if (!visible(x)) continue;
        ctx.fillRect(x, RULER_H, 1, ch - RULER_H);
      }
    }
  }
}

const TICK_STEPS = [
  0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200,
];

function drawRuler(
  ctx: CanvasRenderingContext2D,
  t0: number,
  t1: number,
  L: number,
  R: number,
): void {
  ctx.fillStyle = "rgba(148,163,184,0.055)";
  ctx.fillRect(L, 0, R - L, RULER_H);
  const pps = store.ui.pxPerSec;
  const stepSec =
    TICK_STEPS.find((s) => s * pps >= 72) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const stepMs = stepSec * 1000;
  ctx.fillStyle = COLORS.rulerTick;
  ctx.font = "10px Consolas, monospace";
  let s = Math.floor(t0 / stepMs) * stepMs;
  const firstLabel = Math.ceil(t0 / stepMs);
  let labelIdx = firstLabel;
  while (s <= t1) {
    const x = timeToX(s);
    if (x >= L && x <= R) {
      ctx.fillRect(x, RULER_H - 5, 1, 5);
      if (Math.round(s / stepMs) === labelIdx) {
        const sec = s / 1000;
        const text = stepSec < 1 ? `${Math.round(sec * 1000)}ms` : fmtSec(sec);
        ctx.fillStyle = COLORS.rulerText;
        ctx.fillText(text, x + 3, 9);
        ctx.fillStyle = COLORS.rulerTick;
      }
    }
    s += stepMs;
    labelIdx++;
  }
}

function fmtSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const ss = Math.floor(sec % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  t0: number,
  t1: number,
  L: number,
  R: number,
): void {
  const wave = store.ui.wave;
  const cy = (y0 + y1) / 2;
  const amp = (y1 - y0) * 0.4;
  if (!wave) {
    ctx.fillStyle = "rgba(148,163,184,0.12)";
    ctx.fillRect(L, cy - 0.5, R - L, 1);
    return;
  }
  const { minMax, blockSamples: block, sampleRate: sr } = wave;
  if (minMax.length === 0) return;
  const pps = store.ui.pxPerSec;
  const minB = Math.max(0, Math.floor(((t0 / 1000) * sr) / block));
  const maxB = Math.min(
    minMax.length / 2 - 1,
    Math.ceil(((t1 / 1000) * sr) / block) + 1,
  );
  const bw = Math.max(1, (block / sr) * pps);

  for (let b = minB; b <= maxB; b++) {
    const lo = Math.min(minMax[b * 2], minMax[b * 2 + 1]);
    const hi = Math.max(minMax[b * 2], minMax[b * 2 + 1]);
    const x = timeToX((b * block * 1000) / sr);
    if (x + bw < L || x > R) continue;
    if (lo === 0 && hi === 0) continue;
    ctx.fillStyle = COLORS.waveform;
    ctx.globalAlpha = 0.28;
    ctx.fillRect(x, cy + lo * amp, bw, (hi - lo) * amp);
    ctx.globalAlpha = 0.9;
    ctx.fillRect(
      x,
      cy + lo * amp * 0.35,
      bw,
      Math.max(1, (hi - lo) * amp * 0.3),
    );
    ctx.globalAlpha = 1;
  }
}

function drawMarkers(
  ctx: CanvasRenderingContext2D,
  markerY0: number,
  L: number,
  R: number,
  ch: number,
): void {
  for (const m of sortedMarkers()) {
    const x = timeToX(m.timeMs);
    if (x < L - 4 || x > R + 4) continue;
    const selected = m.id === store.ui.selectedId;
    ctx.fillStyle = selected ? COLORS.markerSelected : COLORS.marker;
    ctx.fillRect(x - 1, markerY0 + 5, 2, ch - markerY0 - 5);
    drawDiamond(ctx, x, markerY0 + 5, selected ? 6 : 4.5);
    if (selected) {
      ctx.fillStyle = COLORS.markerSelected;
      ctx.font = "10px Consolas, monospace";
      ctx.fillText(formatTime(m.timeMs), x + 7, markerY0 + 5);
    }
  }
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

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  L: number,
  R: number,
  ch: number,
): void {
  const x = timeToX(store.ui.positionMs);
  if (x < L - 2 || x > R + 2) return;
  ctx.fillStyle = COLORS.playhead;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x + 6, 0);
  ctx.lineTo(x, 7);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x - 0.75, 0, 1.5, ch);
}

function drawGhost(
  ctx: CanvasRenderingContext2D,
  markerY0: number,
  ch: number,
  L: number,
  R: number,
): void {
  if (hover.y < markerY0 || hover.x < 0 || hover.x > clientW()) return;
  const raw = timeAtX(hover.x);
  const g = store.ui.snapEnabled ? snapTime(raw) : raw;
  const x = timeToX(g);
  if (x < L || x > R) return;
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = COLORS.markerGhost;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, markerY0 + 5);
  ctx.lineTo(x, ch);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "10px Consolas, monospace";
  const label = formatTime(g);
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = "rgba(20,23,27,0.9)";
  ctx.fillRect(x - tw / 2 - 3, ch - 20, tw + 6, 15);
  ctx.fillStyle = COLORS.markerGhost;
  ctx.fillText(label, x - tw / 2, ch - 9);
}

// ---- interaction ----

function hitMarkerId(x: number): string | null {
  const tol = 6 / store.ui.pxPerSec;
  const t = timeAtX(x);
  const hit = hitTest(t, tol);
  return hit ? hit.id : null;
}

function markerRegionY(): number {
  return RULER_H + (clientH() - RULER_H) / 2;
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0) return;
  const rect = viewEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  downX = x;
  downY = y;
  moved = false;
  activePointer = e.pointerId;
  viewEl.value!.setPointerCapture(activePointer);

  if (y < markerRegionY()) {
    mode = "scrub";
    seekTo(Math.max(0, Math.min(timeAtX(x), totalTimeMs())));
    return;
  }
  const hitId = hitMarkerId(x);
  if (hitId) {
    mode = "drag";
    dragId = hitId;
    selectMarker(hitId);
    return;
  }
  mode = "place";
  selectMarker(null);
}

function onPointerMove(e: PointerEvent): void {
  const rect = viewEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  hover.x = x;
  hover.y = y;
  if (Math.abs(x - downX) > 3 || Math.abs(y - downY) > 3) moved = true;
  if (mode === "scrub") {
    seekTo(Math.max(0, Math.min(timeAtX(x), totalTimeMs())));
  } else if (mode === "drag" && dragId) {
    const raw = timeAtX(x);
    const next =
      !e.altKey && store.ui.snapEnabled ? snapTime(raw) : Math.max(0, raw);
    moveMarker(dragId, next);
    selectMarker(dragId);
  }
}

function onPointerUp(e: PointerEvent): void {
  if (activePointer !== e.pointerId) return;
  const rect = viewEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  if (mode === "place" && !moved) {
    addMarkerAt(Math.max(0, Math.min(timeAtX(x), totalTimeMs())));
  }
  mode = "idle";
  dragId = null;
  activePointer = -1;
}

function onPointerCancel(): void {
  mode = "idle";
  dragId = null;
  activePointer = -1;
}

function onContextMenu(e: MouseEvent): void {
  const rect = viewEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  if (hitMarkerId(x)) {
    e.preventDefault();
    const t = timeAtX(x);
    removeMarkerAt(t, 8 / store.ui.pxPerSec);
  }
}

function onWheel(e: WheelEvent): void {
  const v = viewEl.value!;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const rect = v.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const t = timeAtX(mx);
    const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
    const next = Math.min(
      MAX_PX_PER_SEC,
      Math.max(MIN_PX_PER_SEC, store.ui.pxPerSec * factor),
    );
    store.ui.pxPerSec = next;
    v.scrollLeft = Math.max(0, (t / 1000) * next - mx);
    return;
  }
  e.preventDefault();
  if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    v.scrollLeft += e.deltaY !== 0 ? e.deltaY : e.deltaX;
  } else {
    v.scrollLeft += e.deltaY;
  }
}

function loop(): void {
  draw();
  if (store.ui.playing) {
    const v = viewEl.value;
    if (v) {
      const head = timeToX(store.ui.positionMs);
      const cw = clientW();
      if (head > v.scrollLeft + cw - 80)
        v.scrollLeft = Math.max(0, head - cw + 80);
      else if (head < v.scrollLeft + 40) v.scrollLeft = Math.max(0, head - 40);
    }
  }
  raf = requestAnimationFrame(loop);
}

const hintShown = computed(
  () => !store.ui.hasAudio && store.project.markers.length === 0,
);

onMounted(() => {
  setupCanvas();
  ro = new ResizeObserver(() => setupCanvas());
  if (viewEl.value) ro.observe(viewEl.value);
  raf = requestAnimationFrame(loop);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  ro?.disconnect();
});
</script>

<template>
  <div class="timeline-root">
    <canvas ref="canvasEl" class="tl-canvas" />
    <div
      ref="viewEl"
      class="tl-scroll"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @contextmenu.prevent="onContextMenu"
      @wheel.prevent="onWheel"
    >
      <div ref="spacerEl" class="tl-spacer" />
    </div>
    <div v-if="hintShown" class="tl-hint">
      <div class="tl-hint-main">{{ t("timeline.none") }}</div>
      <div class="tl-hint-sub">{{ t("timeline.clickHint") }}</div>
    </div>
  </div>
</template>

<style scoped>
.timeline-root {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  background: var(--bdg-bg);
}
.tl-canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.tl-scroll {
  position: absolute;
  inset: 0;
  overflow: auto;
  cursor: crosshair;
}
.tl-spacer {
  min-width: 100%;
}
.tl-hint {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  pointer-events: none;
  color: var(--bdg-text-dim);
  text-align: center;
}
.tl-hint-main {
  font-size: 15px;
  color: var(--bdg-text);
  opacity: 0.85;
}
.tl-hint-sub {
  font-size: 12px;
}
</style>
