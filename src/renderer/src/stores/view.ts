import { defineStore } from "pinia";
import { ref } from "vue";
import {
  BPM_LANE_H,
  MARKER_LANE_H,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  DEFAULT_DIV,
} from "../metrics";
import { contentEndMs } from "../services/timeline";
import { useSettingsStore } from "./settings";
import { useProjectStore } from "./project";
import { useTransportStore } from "./transport";

/**
 * Timeline viewport: scroll offset, size and horizontal zoom, plus the snap
 * grid. Session-only; the zoom animation reads `settings.animEnabled`.
 */
export const useViewStore = defineStore("view", () => {
  const x = ref(0);
  const y = ref(0);
  const vw = ref(100);
  const vh = ref(100);
  const pxPerSec = ref(90);
  const snapEnabled = ref(true);
  const snapDiv = ref(DEFAULT_DIV);

  // ---- high-frequency viewport mutations exposed as Pinia actions ----
  function setScrollImpl(nx: number, ny: number): void {
    x.value = Math.min(Math.max(0, nx), maxX());
    y.value = Math.min(Math.max(0, ny), maxY());
  }

  function setViewportImpl(nw: number, nh: number): void {
    vw.value = Math.max(1, nw);
    vh.value = Math.max(1, nh);
  }

  function zoomByImpl(factor: number): void {
    const pps = pxPerSec.value;
    const posSec = useTransportStore().positionMs / 1000;
    const ppx = posSec * pps - x.value;
    // anchor to the playhead when it is on screen; otherwise keep the visible
    // left edge stable so zooming never teleports the view to the start.
    const anchorSec = ppx >= 0 && ppx <= vw.value ? posSec : x.value / pps;
    animateZoomTo(clampZoom(pps * factor), anchorSec);
  }

  function fitZoomImpl(viewportWidthPx: number): void {
    if (viewportWidthPx <= 0) return;
    const len = Math.max(1, contentEndMs());
    animateZoomTo(clampZoom(viewportWidthPx / (len / 1000)), null);
  }

  return {
    x,
    y,
    vw,
    vh,
    pxPerSec,
    snapEnabled,
    snapDiv,
    setScroll: setScrollImpl,
    setViewport: setViewportImpl,
    zoomBy: zoomByImpl,
    fitZoom: fitZoomImpl,
  };
});

export const lanesTotalH = (): number => {
  const project = useProjectStore();
  return BPM_LANE_H + Math.max(0, project.tracks.length) * MARKER_LANE_H;
};

export const contentWidthPx = (): number =>
  Math.max(
    (contentEndMs() / 1000) * useViewStore().pxPerSec + 400,
    useViewStore().vw,
  );

export const maxX = (): number =>
  Math.max(0, contentWidthPx() - useViewStore().vw);
export const maxY = (): number =>
  Math.max(0, lanesTotalH() - useViewStore().vh);

export function setScroll(x: number, y: number): void {
  useViewStore().setScroll(x, y);
}

export function setViewport(vw: number, vh: number): void {
  useViewStore().setViewport(vw, vh);
}

export const laneY = (rowTopPx: number): number => rowTopPx - useViewStore().y;

/** screen y -> content lane rowTop y */
export const screenToLaneY = (screenY: number): number =>
  screenY + useViewStore().y;

export const timeToX = (timeMs: number): number =>
  (timeMs / 1000) * useViewStore().pxPerSec;
export const timeToScreenX = (timeMs: number): number =>
  timeToX(timeMs) - useViewStore().x;
export const screenToTime = (screenX: number): number =>
  ((useViewStore().x + screenX) / useViewStore().pxPerSec) * 1000;

// ---- zoom with optional 0.1s ease-out animation (interruptible) ----

const ZOOM_ANIM_MS = 100;
let zoomRaf = 0;
let zoom0 = 0;
let zoom1 = 0;
let zoomStart = 0;

function stopZoom(): void {
  cancelAnimationFrame(zoomRaf);
  zoomRaf = 0;
}

function clampZoom(v: number): number {
  return Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, v));
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

let zoomAnchorSec: number | null = null;
let zoomAnchorX = 0;

function keepZoomAnchor(): void {
  if (zoomAnchorSec === null) return;
  const view = useViewStore();
  const pps = view.pxPerSec;
  const nx = zoomAnchorSec * pps - zoomAnchorX;
  const end = contentEndMs();
  const cw = Math.max((end / 1000) * pps + 400, view.vw);
  const mx = Math.max(0, cw - view.vw);
  view.x = Math.min(mx, Math.max(0, nx));
}

function animateZoomTo(target: number, anchorSec: number | null): void {
  stopZoom();
  const view = useViewStore();
  const from = view.pxPerSec;
  if (anchorSec !== null) {
    zoomAnchorSec = anchorSec;
    zoomAnchorX = anchorSec * from - view.x;
  } else {
    zoomAnchorSec = null;
  }
  if (
    !useSettingsStore().settings.animEnabled ||
    Math.abs(target - from) < 0.001
  ) {
    view.pxPerSec = target;
    keepZoomAnchor();
    zoomAnchorSec = null;
    return;
  }
  zoom0 = from;
  zoom1 = target;
  zoomStart = performance.now();
  const step = (): void => {
    const k = Math.min(1, (performance.now() - zoomStart) / ZOOM_ANIM_MS);
    view.pxPerSec = zoom0 + (zoom1 - zoom0) * easeOutCubic(k);
    keepZoomAnchor();
    if (k < 1) {
      zoomRaf = requestAnimationFrame(step);
    } else {
      view.pxPerSec = zoom1;
      keepZoomAnchor();
      zoomAnchorSec = null;
    }
  };
  zoomRaf = requestAnimationFrame(step);
}

export function zoomBy(factor: number): void {
  useViewStore().zoomBy(factor);
}

export function fitZoom(viewportWidthPx: number): void {
  useViewStore().fitZoom(viewportWidthPx);
}
