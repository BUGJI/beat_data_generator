declare module "soundtouchjs" {
  export class SoundTouch {
    sampleRate: number;
    channels: number;
    rate: number;
    tempo: number;
    pitch: number;
  }
  export class SimpleFilter {
    constructor(source: unknown, pipe: unknown, onEnd?: () => void);
    extract(target: Float32Array, numFrames: number): number;
    sourcePosition: number;
  }
  export class WebAudioBufferSource {
    constructor(buffer: AudioBuffer);
    extract(target: Float32Array, numFrames: number, position: number): number;
    dualChannel: boolean;
  }
}
