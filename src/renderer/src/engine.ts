import type { WaveData } from "./types";

const PEAK_BLOCK_SAMPLES = 512;

export function computePeaks(buffer: AudioBuffer): WaveData {
  const channelCount = buffer.numberOfChannels;
  const totalSamples = buffer.length;
  const blocks = Math.ceil(totalSamples / PEAK_BLOCK_SAMPLES);
  const minMax = new Float32Array(blocks * 2);

  const channels: Float32Array[] = [];
  for (let c = 0; c < channelCount; c++)
    channels.push(buffer.getChannelData(c));

  for (let b = 0; b < blocks; b++) {
    const start = b * PEAK_BLOCK_SAMPLES;
    const end = Math.min(start + PEAK_BLOCK_SAMPLES, totalSamples);
    let min = 1;
    let max = -1;
    for (let i = start; i < end; i++) {
      for (let c = 0; c < channelCount; c++) {
        const v = channels[c][i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (max < min) {
      min = 0;
      max = 0;
    }
    minMax[b * 2] = min;
    minMax[b * 2 + 1] = max;
  }

  return {
    blockSamples: PEAK_BLOCK_SAMPLES,
    minMax,
    durationMs: buffer.duration * 1000,
    sampleRate: buffer.sampleRate,
  };
}

export class PlaybackEngine {
  playing = false;

  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private raf = 0;
  private startCtxTime = 0;
  private posMs = 0;
  private volume = 0.85;
  private rate = 1;
  private detuneCents = 0;

  onTick: (() => void) | null = null;

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  get hasBuffer(): boolean {
    return this.buffer !== null;
  }

  durationMs(): number {
    return this.buffer ? this.buffer.duration * 1000 : 0;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * rate: playback speed multiplier.
   * pitchFollow=true  -> resampling changes pitch along with speed (turntable style).
   * pitchFollow=false -> compensate pitch with detune so speed changes but pitch stays (time-stretch feel).
   */
  setRate(rate: number, pitchFollow: boolean): void {
    this.rate = Math.min(4, Math.max(0.1, rate));
    this.detuneCents = pitchFollow ? 0 : -1200 * Math.log2(this.rate);
    if (this.source && this.ctx) {
      const t = this.ctx.currentTime;
      this.source.playbackRate.setTargetAtTime(this.rate, t, 0.02);
      this.source.detune.setTargetAtTime(this.detuneCents, t, 0.02);
    }
  }

  async decode(bytes: Uint8Array): Promise<AudioBuffer | null> {
    const ctx = this.ensureCtx();
    const ab = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    try {
      return await ctx.decodeAudioData(ab);
    } catch {
      return null;
    }
  }

  load(buffer: AudioBuffer): void {
    this.pause();
    this.buffer = buffer;
    this.posMs = 0;
  }

  play(): void {
    if (this.playing || !this.buffer) return;
    this.ensureCtx();
    if (this.posMs >= this.durationMs()) this.posMs = 0;
    this.schedule(this.posMs);
  }

  pause(): void {
    if (!this.playing) return;
    this.posMs = this.positionMs();
    this.playing = false;
    this.stopSource();
    cancelAnimationFrame(this.raf);
    this.onTick?.();
  }

  stop(): void {
    this.pause();
    this.posMs = 0;
    this.onTick?.();
  }

  seek(ms: number): void {
    const clamped = Math.max(0, Math.min(ms, this.durationMs()));
    if (this.playing && this.buffer) {
      this.posMs = clamped;
      this.schedule(clamped);
      return;
    }
    this.posMs = clamped;
    this.onTick?.();
  }

  positionMs(): number {
    if (!this.playing || !this.ctx) return this.posMs;
    const live =
      this.posMs + (this.ctx.currentTime - this.startCtxTime) * 1000 * this.rate;
    if (live >= this.durationMs()) {
      const dur = this.durationMs();
      this.posMs = dur;
      this.playing = false;
      this.stopSource();
      cancelAnimationFrame(this.raf);
      return dur;
    }
    return live;
  }

  private schedule(fromMs: number): void {
    const ctx = this.ensureCtx();
    const dur = this.durationMs();
    const start = Math.max(0, Math.min(fromMs, dur));
    this.stopSource();
    this.posMs = start;
    this.playing = true;
    this.startCtxTime = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.rate;
    src.detune.value = this.detuneCents;
    src.connect(this.gain!);
    src.start(0, start / 1000);
    this.source = src;
    this.loop();
  }

  private stopSource(): void {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  private loop(): void {
    cancelAnimationFrame(this.raf);
    const tick = (): void => {
      if (!this.playing) return;
      if (this.positionMs() >= this.durationMs()) {
        this.pause();
        this.posMs = this.durationMs();
        this.onTick?.();
        return;
      }
      this.onTick?.();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  dispose(): void {
    this.pause();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
}

export const engine = new PlaybackEngine();
