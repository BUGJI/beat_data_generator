import {
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  watchEffect,
  type Ref,
} from "vue";
import { COLORS, RULER_H } from "../../metrics";
import { useProjectStore } from "../../stores/project";
import { useSelectionStore } from "../../stores/selection";
import { useSettingsStore } from "../../stores/settings";
import { useTransportStore } from "../../stores/transport";
import { useUiStore } from "../../stores/ui";
import { useViewStore, setScroll, setViewport } from "../../stores/view";
import { engine } from "../../engine";
import {
  FOLLOW_TAU_MS,
  followDecision,
  isFollowHeld,
  smoothScrollX,
} from "../../services/follow";
import { motionMs } from "../../services/motion";
import { drawBase, drawOverlay, hasActiveFx, type DrawScene } from "./renderer";

/**
 * Owns the timeline canvas lifecycle: DPR sizing of the base + overlay
 * canvases, the repaint effects, the resize observer and the on-demand frame
 * loop (playback follow + beat effects).
 *
 * The base layer is dependency-driven: it repaints only when the document,
 * viewport, theme or selection changes. The overlay (playhead, gestures,
 * playback effects) is repainted at most once per animation frame while
 * playback or an effect is active, or whenever its reactive inputs change.
 * `markDirty` is the escape hatch for render inputs that aren't reactive (the
 * box-selection rect).
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
  let overlayFrame = 0;
  let ro: ResizeObserver | null = null;
  let stopBase: (() => void) | null = null;
  let stopOverlay: (() => void) | null = null;
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

  /** Coalesce overlay paints so several reactive updates per frame cost one draw. */
  function scheduleOverlay(): void {
    if (overlayFrame) return;
    overlayFrame = requestAnimationFrame(() => {
      overlayFrame = 0;
      paintOverlay();
    });
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
    // Playback effects decay over time, which no reactive value tracks, so
    // drive those frames explicitly. One extra frame after they end clears the
    // residual animation.
    const fxActive = hasActiveFx();
    if (transport.playing || fxActive || wasFxActive) scheduleOverlay();
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
    // Static scene: tracks every document/viewport/theme value the base reads.
    stopBase = watchEffect(() => {
      paintBase();
    });
    // Overlay: gesture state + position + palette/fx toggles. The actual paint
    // is deferred to the next frame so a burst of updates draws once.
    stopOverlay = watchEffect(() => {
      void renderNonce.value;
      void transport.positionMs;
      const scene = opts.getScene();
      void scene.boxRect;
      void scene.ghost;
      // Palette / effect values are read inside the deferred paint, so touch
      // them here to keep this effect subscribed to their changes.
      void COLORS.playhead;
      void COLORS.markerSelected;
      void COLORS.markerGhostOk;
      void COLORS.markerGhostBad;
      void COLORS.labelBg;
      const ui = useUiStore();
      void ui.fxPulses;
      void ui.fxUntil;
      void useSettingsStore().settings.beatFxMaster;
      void useSettingsStore().settings.beatFx;
      void useSelectionStore().selected;
      void useProjectStore().markers;
      scheduleOverlay();
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
    cancelAnimationFrame(overlayFrame);
    overlayFrame = 0;
    raf = 0;
    stopBase?.();
    stopBase = null;
    stopOverlay?.();
    stopOverlay = null;
    ro?.disconnect();
  });

  return { markDirty };
}
