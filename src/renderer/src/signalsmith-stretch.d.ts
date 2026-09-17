/**
 * Minimal typings for `signalsmith-stretch` (ships as plain ESM/UMD without
 * types). Only the surface we use is declared.
 */
declare module "signalsmith-stretch" {
  export interface StretchSchedule {
    output?: number;
    active?: boolean;
    input?: number;
    rate?: number;
    semitones?: number;
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
    loopStart?: number;
    loopEnd?: number;
  }

  export interface StretchNode extends AudioNode {
    /** Current input position (seconds) within the loaded buffers. */
    inputTime: number;
    addBuffers(buffers: Float32Array[]): Promise<number>;
    dropBuffers(
      toSeconds?: number,
    ): Promise<number | { start: number; end: number }>;
    schedule(change: StretchSchedule): Promise<void>;
    start(when?: number): void;
    stop(when?: number): void;
    latency(): Promise<number>;
    configure(options: {
      blockMs?: number | null;
      intervalMs?: number;
      splitComputation?: boolean;
      preset?: "default" | "cheaper";
    }): Promise<void>;
    setUpdateInterval(
      seconds: number,
      callback?: (time: number) => void,
    ): Promise<void>;
  }

  export default function SignalsmithStretch(
    audioContext: BaseAudioContext,
    options?: AudioWorkletNodeOptions,
  ): Promise<StretchNode>;
}
