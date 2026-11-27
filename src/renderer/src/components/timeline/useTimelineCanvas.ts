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
import { rulerLabelDigits, timeRulerStepSec } from "./geometry";
import { noteRulerTier, resetRulerTier, rulerTierActive } from "./rulerFx";
import { drawBase, drawOverlay, hasActiveFx, type DrawScene } from "./renderer";

/**
 * Owns the timeline canvas lifecycle: DPR sizing for the base + overlay
 * canvases, the repaint effects, the resize observer and the on-demand frame
 * loop (playback follow + beat effects).
 *
 * The base layer is dependency-driven: it repaints only when the document,
 * viewport, theme or selection changes. The overlay (playhead, gestures,
 * playback effects) repaints whenever its reactive inputs change and each
 * frame while playback or an effect is active. Both layers are painted from
 * the same flush so their scroll offsets can never diverge. `markDirty` is the
 * escape hatch for non-reactive render inputs (the box-selection rect).
 */
export function useTimelineCanvas(opts: {
  rootEl: Ref<HTMLElement | null>;
  canvasEl: Ref<HTMLCanvasElement | null>;
  overlayEl: Ref<HTMLCanvasElement | null>;
  getScene: () => DrawScene;
}) {
  const transport = useTransportStore();
  const view = useViewStore();
  const settings = useSettingsStore();

  let raf = 0;
  let ro: ResizeObserver | null = null;
  let stopBase: (() => void) | null = null;
  let stopOverlay: (() => void) | null = null;
  let stopRuler: (() => void) | null = null;
  let wasFxActive = false;
  let lastTs = 0;

  const renderNonce = ref(0);
  function markDirty(): void {
    renderNonce.value++;
  }

  function paintBase(): void {
    drawBase(opts.canvasEl.value);
  }

  function paintOverlay(): void {
    drawOverlay(opts.getScene());
  }

  function setupCanvas(): void {
    const root = opts.rootEl.value;
    if (!root) return;
    const dpr = window.devicePixelRatio || 1;
    const w = root.clientWidth;
    const h = root.clientHeight;
    for (const cv of [opts.canvasEl.value, opts.overlayEl.value]) {
      if (!cv) continue;
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
    }
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
      if (!isFollowHeld(now) && settings.settings.followMode === "smooth") {
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
    // While playing, the overlay effect repaints on every position update, so
    // the loop only follows the playhead. Paused effects still decay over
    // time (no reactive value tracks that), so drive those frames explicitly;
    // one extra frame after they end clears the residual animation.
    const fxActive = hasActiveFx();
    if (!transport.playing && (fxActive || wasFxActive)) paintOverlay();
    wasFxActive = fxActive;
    const rulerActive = rulerTierActive();
    if (rulerActive) paintBase();
    if (transport.playing || fxActive || rulerActive)
      raf = requestAnimationFrame(loop);
  }

  watch(
    () => transport.playing,
    (playing) => {
      if (playing) requestLoop();
    },
  );

  onMounted(() => {
    setupCanvas();
    resetRulerTier();
    stopRuler = watch(
      () => view.pxPerSec,
      (pps) => {
        const step = timeRulerStepSec(pps);
        if (noteRulerTier(step, rulerLabelDigits(step))) requestLoop();
      },
      { immediate: true },
    );
    // Static scene: tracks every document/viewport/theme value the base reads.
    stopBase = watchEffect(() => {
      paintBase();
    });
    // Overlay: position, gesture state, viewport geometry and effect toggles.
    // The playhead and ghost are screen-space, so zoom/pan must repaint them.
    stopOverlay = watchEffect(() => {
      void renderNonce.value;
      const scene = opts.getScene();
      paintOverlay();
      void scene.boxRect;
      void scene.ghost;
      void scene.hover.x;
    });
    ro = new ResizeObserver(() => {
      setupCanvas();
      paintBase();
      paintOverlay();
    });
    if (opts.rootEl.value) ro.observe(opts.rootEl.value);
    requestLoop();
  });

  onBeforeUnmount(() => {
    cancelAnimationFrame(raf);
    raf = 0;
    stopBase?.();
    stopBase = null;
    stopOverlay?.();
    stopOverlay = null;
    stopRuler?.();
    stopRuler = null;
    ro?.disconnect();
  });

  return { markDirty };
}
