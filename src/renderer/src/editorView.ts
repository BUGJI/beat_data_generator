import { reactive } from "vue";
import { store, contentEndMs } from "./store";
import { BPM_LANE_H, MARKER_LANE_H } from "./metrics";

export const view = reactive({ x: 0, y: 0, vw: 100, vh: 100 });

export const lanesTotalH = (): number =>
  BPM_LANE_H + Math.max(0, store.project.tracks.length) * MARKER_LANE_H;

export const contentWidthPx = (): number =>
  Math.max((contentEndMs() / 1000) * store.ui.pxPerSec + 400, view.vw);

export const maxX = (): number => Math.max(0, contentWidthPx() - view.vw);
export const maxY = (): number => Math.max(0, lanesTotalH() - view.vh);

export function setScroll(x: number, y: number): void {
  view.x = Math.min(Math.max(0, x), maxX());
  view.y = Math.min(Math.max(0, y), maxY());
}

export function setViewport(vw: number, vh: number): void {
  view.vw = Math.max(1, vw);
  view.vh = Math.max(1, vh);
}

export const laneY = (rowTopPx: number): number => rowTopPx - view.y;

/** screen y -> content lane rowTop y */
export const screenToLaneY = (screenY: number): number => screenY + view.y;

export const timeToX = (timeMs: number): number =>
  (timeMs / 1000) * store.ui.pxPerSec;
export const timeToScreenX = (timeMs: number): number =>
  timeToX(timeMs) - view.x;
export const screenToTime = (screenX: number): number =>
  ((view.x + screenX) / store.ui.pxPerSec) * 1000;
