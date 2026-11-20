import type { WaveData } from "./types";
import { StretchCache } from "./stretch/cache";

const PEAK_BLOCK_SAMPLES = 512;

/** Default retained size for stretched playback buffers (configurable). */
const DEFAULT_STRETCH_CACHE_BYTES = 256 * 1024 * 1024;

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

  private stretchCache = new StretchCache(DEFAULT_STRETCH_CACHE_BYTES);
  private stretchEpoch = 0;

  private metronome: AudioBuffer | null = null;
  /** Own gain so the metronome can bypass the master volume. */
  private metronomeGain: GainNode | null = null;
  private metronomeVolume = 0.85;
  private metronomeFollowsMaster = true;
  private scheduledClicks: OscillatorNode[] = [];
  private loopEnabled = false;
  private loopStartMs = 0;
  private loopEndMs = 0;

  onTick: (() => void) | null = null;

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
      this.metronomeGain = this.ctx.createGain();
      this.metronomeGain.gain.value = this.effectiveMetronomeVolume();
      this.metronomeGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private effectiveMetronomeVolume(): number {
    return this.metronomeFollowsMaster ? this.volume : this.metronomeVolume;
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

  /** Cached stretched buffer for a canonical rate key, if any. */
  getStretched(key: string): AudioBuffer | null {
    return this.stretchCache.get(key);
  }

  /** Store a stretched buffer for a canonical rate key. */
  putStretched(key: string, buffer: AudioBuffer): void {
    this.stretchCache.put(key, buffer);
  }

  /** Keep the entry used by the current playback alive across evictions. */
  pinStretched(key: string | null): void {
    this.stretchCache.pin(key);
  }

  /** Change the retained-cache budget (bytes); evicts immediately. */
  setStretchBudget(bytes: number): void {
    this.stretchCache.setMaxBytes(bytes);
  }

  /** Increments when the cache is invalidated (audio load / engine change). */
  stretchEpochValue(): number {
    return this.stretchEpoch;
  }

  /** Drop every cached stretched buffer (e.g. after the engine setting changes). */
  clearStretched(): void {
    this.stretchCache.clear();
    this.stretchEpoch++;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
    if (this.metronomeGain && this.ctx && this.metronomeFollowsMaster) {
      this.metronomeGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
  }

  setMetronome(buffer: AudioBuffer | null): void {
    this.metronome = buffer;
  }

  /** Independent metronome volume (0–1), used when not following the master. */
  setMetronomeVolume(v: number): void {
    this.metronomeVolume = v;
    if (this.metronomeGain && this.ctx && !this.metronomeFollowsMaster) {
      this.metronomeGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }
  }

  /** When true the metronome tracks the master volume; otherwise its own. */
  setMetronomeFollowsMaster(follow: boolean): void {
    this.metronomeFollowsMaster = follow;
    if (this.metronomeGain && this.ctx) {
      this.metronomeGain.gain.setTargetAtTime(
        this.effectiveMetronomeVolume(),
        this.ctx.currentTime,
        0.02,
      );
    }
  }

  /** play the metronome click `count` times simultaneously (overlapping markers). */
  playMetronome(count: number, accent = false): void {
    if (!this.metronome || count < 1) return;
    const ctx = this.ensureCtx();
    if (!ctx || !this.metronomeGain) return;
    for (let i = 0; i < count; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.metronome;
      if (accent) {
        const gain = ctx.createGain();
        gain.gain.value = 1.45;
        src.connect(gain);
        gain.connect(this.metronomeGain);
      } else {
        src.connect(this.metronomeGain);
      }
      src.start();
    }
  }

  /** Play a grid/beat click; falls back to the oscillator when no sample is set. */
  playBeatClick(accent = false): void {
    if (this.metronome) {
      this.playMetronome(1, accent);
      return;
    }
    this.scheduleClick(0, accent);
  }

  /** Schedule a short count-in click relative to now; independent of the click sample. */
  scheduleClick(delaySec: number, accent = false): void {
    const ctx = this.ensureCtx();
    const dest = this.metronomeGain ?? this.gain;
    if (!ctx || !dest) return;
    const when = ctx.currentTime + Math.max(0, delaySec);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = accent ? 1568 : 1046;
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(accent ? 0.3 : 0.18, when + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.08);
    osc.connect(env);
    env.connect(dest);
    osc.start(when);
    osc.stop(when + 0.1);
    this.scheduledClicks.push(osc);
    osc.onended = () => {
      const i = this.scheduledClicks.indexOf(osc);
      if (i >= 0) this.scheduledClicks.splice(i, 1);
    };
  }

  cancelScheduledClicks(): void {
    for (const osc of this.scheduledClicks) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
      osc.disconnect();
    }
    this.scheduledClicks = [];
  }

  setLoop(enabled: boolean, startMs: number, endMs: number): void {
    this.loopEnabled = enabled && endMs > startMs + 1;
    this.loopStartMs = Math.max(0, startMs);
    this.loopEndMs = Math.max(this.loopStartMs, endMs);
  }

  async decode(bytes: Uint8Array): Promise<AudioBuffer | null> {
    const ctx = this.ensureCtx();
    // Hand decodeAudioData the caller's buffer directly when the view spans it
    // (the common IPC case), avoiding a full-size copy of the encoded file.
    // decodeAudioData detaches it, which is fine: callers never reuse `bytes`.
    const ab = (
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          )
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
    this.clearStretched();
    this.active = null;
    this.posMs = 0;
  }

  /** start from posMs (original clock) using the given playback configuration */
  playFrom(posMs: number, config: PlayConfig): void {
    if (!this.original || !config.buf) return;
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
    const cfg = this.active;
    if (!cfg?.buf) return;
    const ctx = this.ensureCtx();
    const dur = this.durationMs();
    let start = Math.max(0, Math.min(fromMs, dur));
    if (
      this.loopEnabled &&
      (start < this.loopStartMs || start >= this.loopEndMs)
    ) {
      start = Math.max(0, Math.min(this.loopStartMs, dur));
    }
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
      const pos = this.positionMs();
      if (
        this.loopEnabled &&
        this.loopEndMs > this.loopStartMs + 1 &&
        pos >= this.loopEndMs - 1
      ) {
        this.schedule(this.loopStartMs);
        return;
      }
      if (pos >= this.durationMs()) {
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
    this.cancelScheduledClicks();
    this.pause();
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
}

export const engine = new PlaybackEngine();
