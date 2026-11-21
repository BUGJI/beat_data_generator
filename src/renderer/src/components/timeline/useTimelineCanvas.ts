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
import { engine } from "../../engine";
import {
  FOLLOW_TAU_MS,
  followDecision,
  isFollowHeld,
  smoothScrollX,
} from "../../services/follow";
import { motionMs } from "../../services/motion";
import { draw, hasActiveFx, type DrawScene } from "./renderer";

/**
 * Owns the timeline canvas lifecycle: DPR sizing, the repaint effect, the
 * resize observer and the on-demand frame loop (playback follow + beat effects).
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
  let wasFxActive = false;
  let lastTs = 0;

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
      const now = performance.now();
      const dt = lastTs ? Math.min(50, now - lastTs) : 0;
      lastTs = now;
      if (!isFollowHeld(now)) {
        const decision = followDecision({
          active: transport.followActive,
          locked: transport.followLocked,
          enabled: settings.settings.followScroll,
          playheadPx: (engine.positionMs() / 1000) * view.pxPerSec,
          viewX: view.x,
          viewportW: view.vw,
          followPercent: settings.settings.followPercent,
        });
        transport.followActive = decision.active;
        if (decision.targetX !== null) {
          const tau = motionMs(FOLLOW_TAU_MS);
          setScroll(
            smoothScrollX(
              view.x,
              decision.targetX,
              dt,
              settings.settings.followSmooth && tau > 0,
              tau,
            ),
            view.y,
          );
        }
      }
    } else {
      lastTs = 0;
    }
    // playback effects decay over time, which no reactive value tracks, so drive
    // those frames explicitly (the initial frame is painted by the paint effect).
    // One extra frame after they end clears the residual animation.
    const fxActive = hasActiveFx();
    if (fxActive || wasFxActive) paint();
    wasFxActive = fxActive;
    if (transport.playing || fxActive) raf = requestAnimationFrame(loop);
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

  return { markDirty };
}
