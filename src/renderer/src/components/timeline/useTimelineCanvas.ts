import {
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  watchEffect,
  type Ref,
} from "vue";
import { useSettingsStore } from "../../stores/settings";
import { useTransportStore } from "../../stores/transport";
import { useViewStore, setScroll, setViewport } from "../../stores/view";
import { RULER_H } from "../../metrics";
import { draw, hasActiveGlow, type DrawScene } from "./renderer";

/**
 * Owns the timeline canvas lifecycle: DPR sizing, the repaint effect, the
 * resize observer and the on-demand frame loop (playback follow + lane glow).
 *
 * Painting is dependency-driven instead of a constant 60fps redraw: the paint
 * effect re-runs only when reactive state the canvas reads changes, and the loop
 * stays alive solely for the two time-based cases. `markDirty` is the escape
 * hatch for render inputs that aren't reactive (the box-selection rect).
 */
export function useTimelineCanvas(opts: {
  rootEl: Ref<HTMLElement | null>;
  canvasEl: Ref<HTMLCanvasElement | null>;
  getScene: () => DrawScene;
}) {
  const transport = useTransportStore();
  const view = useViewStore();
  const settings = useSettingsStore();

  let raf = 0;
  let ro: ResizeObserver | null = null;
  let stopPaint: (() => void) | null = null;
  let wasGlowing = false;

  const renderNonce = ref(0);
  function markDirty(): void {
    renderNonce.value++;
  }

  function paint(): void {
    draw(opts.getScene());
  }

  function setupCanvas(): void {
    const root = opts.rootEl.value;
    const cv = opts.canvasEl.value;
    if (!root || !cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = root.clientWidth;
    const h = root.clientHeight;
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.max(1, Math.round(h * dpr));
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    setViewport(w, Math.max(1, h - RULER_H));
  }

  function requestLoop(): void {
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function loop(): void {
    raf = 0;
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
    // frames explicitly (the initial frame is painted by the paint effect). One
    // extra frame after it ends clears the residual glow.
    const glowing = hasActiveGlow();
    if (glowing || wasGlowing) paint();
    wasGlowing = glowing;
    if (transport.playing || glowing) raf = requestAnimationFrame(loop);
  }

  watch(
    () => transport.playing,
    (playing) => {
      if (playing) requestLoop();
    },
  );

  onMounted(() => {
    setupCanvas();
    // Registered after setupCanvas so the first run has a live canvas to track
    // against and paint into.
    stopPaint = watchEffect(() => {
      void renderNonce.value;
      paint();
    });
    ro = new ResizeObserver(() => {
      setupCanvas();
      paint();
    });
    if (opts.rootEl.value) ro.observe(opts.rootEl.value);
    requestLoop();
  });

  onBeforeUnmount(() => {
    cancelAnimationFrame(raf);
    stopPaint?.();
    stopPaint = null;
    ro?.disconnect();
  });

  return { markDirty, requestLoop };
}
