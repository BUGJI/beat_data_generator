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
}

export interface MarkerTrack {
  id: string;
  name: string;
  color: string;
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
  audioPath: string | null;
  audioName: string | null;
  tracks: MarkerTrack[];
  markers: Marker[];
  bpmPoints: BpmPoint[];
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
