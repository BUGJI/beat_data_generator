export interface Marker {
  id: string;
  timeMs: number;
}

export interface BeatProject {
  app: "beat-data-generator";
  version: 1;
  name: string;
  bpm: number;
  offsetMs: number;
  audioPath: string | null;
  audioName: string | null;
  markers: Marker[];
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
