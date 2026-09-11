export interface LoopConfig {
  interval: number;
  count: number;
  exclude?: number[];
}

export interface Marker {
  id: string;
  trackId: string;
  beat: number;
  loop?: LoopConfig | null;
  parentId?: string;
  /** plugin-defined attributes when this marker lives on a typed track. */
  attrs?: Record<string, unknown>;
}

export interface MarkerTrack {
  id: string;
  name: string;
  color: string;
  locked?: boolean;
  hidden?: boolean;
  /**
   * Track kind. Absent or "beat" is the built-in beat-marker track;
   * otherwise it is a plugin-typed track key ("<pluginId>:<localId>").
   */
  type?: string;
}

export interface ProjectNote {
  id: string;
  /** Anchor time (ms) along the timeline — controls the horizontal position. */
  timeMs: number;
  /** Vertical offset (px) within the track/lane region of the timeline. */
  y: number;
  /** Markdown body rendered via slimdown-js. */
  text: string;
  /** Locked notes cannot be moved or edited. */
  locked?: boolean;
}

export type BpmMode = "abs" | "mult";

export interface BpmPoint {
  id: string;
  beat: number;
  mode: BpmMode;
  value: number;
}

export interface BeatProject {
  app: "beat-data-generator";
  version: 2;
  name: string;
  baseBpm: number;
  offsetMs: number;
  audioName: string | null;
  audioMd5: string | null;
  bpmLocked?: boolean;
  tracks: MarkerTrack[];
  markers: Marker[];
  bpmPoints: BpmPoint[];
  notes: ProjectNote[];
}

export interface WaveData {
  blockSamples: number;
  minMax: Float32Array;
  durationMs: number;
  sampleRate: number;
}

export interface AudioFileResultLike {
  filePath: string;
  name: string;
  data: Uint8Array;
}

export interface Segment {
  beatStart: number;
  beatEnd: number | null;
  bpm: number;
  timeStartMs: number;
  timeEndMs: number | null;
}
