import type { WaveData } from "./types";
import { StretchCache } from "./stretch/cache";
import { totalClickGain, type BeatOverlapMode } from "@shared/beatClick";

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
  /** Shared peak protection for the music + click mix. */
  private limiter: DynamicsCompressorNode | null = null;
  private metronomeVolume = 0.85;
  private metronomeFollowsMaster = true;
  private overlapMode: BeatOverlapMode = "limit";
  private accentEnabled = true;
  private accentGain = 1.45;
  private outputProtection = true;
  private scheduledClicks: OscillatorNode[] = [];
  /**
   * Click samples scheduled ahead of time, keyed by their optional gain node so
   * both can be disconnected when they finish or when playback is interrupted.
   */
  private scheduledSamples = new Map<AudioBufferSourceNode, GainNode | null>();
  /** Bumped whenever the audio clock is restarted; dependent schedulers reset. */
  private clockEpoch = 0;
  private loopEnabled = false;
  private loopStartMs = 0;
  private loopEndMs = 0;

  onTick: (() => void) | null = null;

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      // Both buses meet at one limiter so music + clicks cannot clip the output
      // whatever the overlap count or volume. Disabling protection makes the
      // limiter transparent instead of rewiring the graph mid-playback.
      this.limiter = this.ctx.createDynamicsCompressor();
      this.applyLimiter();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.limiter);
      this.metronomeGain = this.ctx.createGain();
      this.metronomeGain.gain.value = this.effectiveMetronomeVolume();
      this.metronomeGain.connect(this.limiter);
      this.limiter.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Push the peak-protection curve; ratio 1 / knee 0 is effectively bypassed. */
  private applyLimiter(): void {
    const limiter = this.limiter;
    if (!limiter) return;
    const on = this.outputProtection;
    // Only catch peaks close to full scale so normal playback keeps its
    // dynamics; 1.5 dB of headroom is enough for the click bus.
    limiter.threshold.value = on ? -1.5 : 0;
    limiter.knee.value = on ? 3 : 0;
    limiter.ratio.value = on ? 20 : 1;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
  }

  /** Toggle the master peak protection (default on). */
  setOutputProtection(on: boolean): void {
    this.outputProtection = on;
    this.applyLimiter();
  }

  /** Loudness policy for coincident marker clicks. */
  setBeatOverlap(mode: BeatOverlapMode): void {
    this.overlapMode = mode;
  }

  /** Accent clicks that land on a bar start, and how much louder they are. */
  setBeatAccent(enabled: boolean, gain: number): void {
    this.accentEnabled = enabled;
    this.accentGain = Number.isFinite(gain) ? Math.max(1, gain) : 1.45;
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

  /** Play the click for `count` coincident markers immediately. */
  playMetronome(count: number, accent = false): void {
    if (!this.metronome || count < 1) return;
    const ctx = this.ensureCtx();
    if (!ctx) return;
    this.playMetronomeAt(ctx.currentTime, count, accent);
  }

  /**
   * Schedule one click at an absolute AudioContext time.
   *
   * All coincident markers sum to a single source with one computed gain
   * (`totalClickGain`), which is mathematically identical to starting N
   * identical buffers together but avoids N node allocations, N starts and an
   * unbounded amplitude that clipped the output.
   */
  playMetronomeAt(whenSec: number, count: number, accent = false): void {
    if (!this.metronome || count < 1) return;
    const ctx = this.ensureCtx();
    const dest = this.metronomeGain;
    if (!ctx || !dest) return;
    const total = totalClickGain(count, this.overlapMode);
    const gainValue =
      total * (accent && this.accentEnabled ? this.accentGain : 1);
    const src = ctx.createBufferSource();
    src.buffer = this.metronome;
    let gain: GainNode | null = null;
    if (Math.abs(gainValue - 1) > 1e-6) {
      gain = ctx.createGain();
      gain.gain.value = gainValue;
      src.connect(gain);
      gain.connect(dest);
    } else {
      src.connect(dest);
    }
    src.start(Math.max(ctx.currentTime, whenSec));
    this.scheduledSamples.set(src, gain);
    src.onended = () => {
      this.scheduledSamples.delete(src);
      try {
        src.disconnect();
      } catch {
        /* already disconnected */
      }
      gain?.disconnect();
    };
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
    // Accent strength is user-tunable (and can be switched off entirely); the
    // sample-based click applies the same factor in `playMetronomeAt`.
    const accentOn = accent && this.accentEnabled;
    const peak = 0.18 * (accentOn ? this.accentGain : 1);
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = accentOn ? 1568 : 1046;
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(peak, when + 0.004);
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

  /** Drop every future count-in / beat click (oscillator and sample based). */
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
    for (const [src, gain] of this.scheduledSamples) {
      try {
        src.onended = null;
        src.stop();
      } catch {
        /* already stopped */
      }
      try {
        src.disconnect();
      } catch {
        /* already disconnected */
      }
      gain?.disconnect();
    }
    this.scheduledSamples.clear();
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
    this.clockEpoch++;
    this.cancelScheduledClicks();
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

  /**
   * Audio-clock anchor for the current play run, or null when paused. Callers
   * map project time to an absolute AudioContext time with
   * `startCtxTime + (projectMs - startPosMs) / 1000 / speed`.
   */
  audioClock(): {
    ctxTime: number;
    startCtxTime: number;
    startPosMs: number;
    speed: number;
    epoch: number;
  } | null {
    if (!this.playing || !this.ctx) return null;
    return {
      ctxTime: this.ctx.currentTime,
      startCtxTime: this.startCtxTime,
      startPosMs: this.posMs,
      speed: this.speed > 1e-6 ? this.speed : 1,
      epoch: this.clockEpoch,
    };
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
      // Clicks queued up to the lookahead horizon must not sound after the
      // audio has already ended.
      this.clockEpoch++;
      this.cancelScheduledClicks();
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
    // Any click scheduled against the previous run is now stale (seek, loop
    // wrap, speed change or a fresh start), so drop it and reset the epoch.
    this.cancelScheduledClicks();
    this.clockEpoch++;
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
