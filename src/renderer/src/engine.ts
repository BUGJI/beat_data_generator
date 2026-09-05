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

export interface PlayConfig {
  buf: AudioBuffer;
  contentRate: number; // original audio seconds represented per buffer second
  sourceRate: number; // playbackRate applied to the source
}

/**
 * time -> original-clock advance speed = sourceRate * contentRate.
 * native (pitch-follows-speed): buf=original, contentRate=1, sourceRate=rate
 * stretch (speed w/o pitch change): buf=stretched, contentRate=rate, sourceRate=1
 */
export class PlaybackEngine {
  playing = false;

  private ctx: AudioContext | null = null;
  private original: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private raf = 0;
  private startCtxTime = 0;
  private posMs = 0;
  private volume = 0.85;
  private speed = 1;
  private active: PlayConfig | null = null;

  stretched: AudioBuffer | null = null;
  stretchedFor = 0;

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
    return this.original !== null;
  }

  get sourceBuffer(): AudioBuffer | null {
    return this.original;
  }

  durationMs(): number {
    return this.original ? this.original.duration * 1000 : 0;
  }

  hasStretchedFor(rate: number): boolean {
    return this.stretchedFor === rate && this.stretched !== null;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
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
    this.original = buffer;
    this.stretched = null;
    this.stretchedFor = 0;
    this.active = null;
    this.posMs = 0;
  }

  /** start from posMs (original clock) using the given playback configuration */
  playFrom(posMs: number, config: PlayConfig): void {
    if (!this.original) return;
    this.ensureCtx();
    const dur = this.durationMs();
    let start = Math.max(0, Math.min(posMs, dur));
    if (start >= dur) start = 0;
    this.active = config;
    this.speed = config.sourceRate * config.contentRate;
    this.schedule(start);
  }

  /** restart currently-running native path with a new source playbackRate at same position */
  restartWithSourceRate(sourceRate: number): void {
    if (!this.active || !this.playing) return;
    const pos = this.positionMs();
    this.active = { ...this.active, sourceRate };
    this.speed = sourceRate * this.active.contentRate;
    this.schedule(pos);
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
    if (this.playing && this.active) {
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
      this.posMs +
      (this.ctx.currentTime - this.startCtxTime) * 1000 * this.speed;
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
    const cfg = this.active!;
    const ctx = this.ensureCtx();
    const dur = this.durationMs();
    const start = Math.max(0, Math.min(fromMs, dur));
    this.stopSource();
    this.posMs = start;
    this.playing = true;
    this.startCtxTime = ctx.currentTime;
    const buf = cfg.buf;
    const startBufSec = Math.min(
      buf.duration,
      Math.max(0, start / 1000 / cfg.contentRate),
    );
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = cfg.sourceRate;
    src.connect(this.gain!);
    src.start(0, startBufSec);
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
