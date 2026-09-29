import type { BpmPoint, Marker, MarkerTrack, ProjectNote } from "../../types";

/** What the active pointer gesture is doing. */
export type GestureMode =
  | "idle"
  | "scrub"
  | "placeBpm"
  | "placeMarker"
  | "dragBpm"
  | "dragMarker"
  | "brushAdd"
  | "brushErase"
  | "boxSelect"
  | "pan";

export type LaneKind = { kind: "bpm" | "marker"; index: number };

export type VisibleRow = { i: number; y: number; h: number; bpm: boolean };

export type BpmSegment = {
  beatStart: number;
  beatEnd: number | null;
  bpm: number;
};

export type BoxRect = { x0: number; y0: number; x1: number; y1: number };

export type GhostState = {
  beat: number;
  ok: boolean;
  y0: number;
  y1: number;
};

/**
 * Non-reactive inputs the canvas renderer needs from the component: the canvas
 * element and the live gesture state (which lives in plain `let`s, not refs,
 * for per-frame performance).
 */
export interface RenderState {
  canvas: HTMLCanvasElement;
  gesture: {
    mode: GestureMode;
    dragId: string | null;
    dragTrackId: string | null;
    dragGroupIds: Set<string>;
    boxRect: BoxRect | null;
    hover: { x: number; y: number };
    ghost: GhostState | null;
  };
}

export type { BpmPoint, Marker, MarkerTrack, ProjectNote };
