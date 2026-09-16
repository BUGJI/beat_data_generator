import { engine } from "../engine";
import { stretchAudioBuffer } from "../stretch";
import { useTransportStore } from "../stores/transport";
import { refreshBeatFlash } from "./flash";

/**
 * Playback orchestration around the audio engine: play / pause / stop / seek,
 * plus speed changes and the optional pitch-preserving stretch buffer.
 */

export function setPosition(ms: number): void {
  const t = useTransportStore();
  t.positionMs = ms;
  if (!engine.playing) engine.seek(ms);
  refreshBeatFlash(ms);
}

const needStretch = (rate: number): boolean =>
  !useTransportStore().pitchFollow && Math.abs(rate - 1) > 1e-4;

let buildSeq = 0;

async function ensureStretched(rate: number): Promise<AudioBuffer | null> {
  if (engine.hasStretchedFor(rate)) return engine.stretched;
  const src = engine.sourceBuffer;
  if (!src) return null;
  const t = useTransportStore();
  const seq = ++buildSeq;
  t.buffering = true;
  try {
    const buf = await stretchAudioBuffer(src, rate);
    if (seq !== buildSeq) return null;
    engine.stretched = buf;
    engine.stretchedFor = rate;
    return buf;
  } catch {
    return null;
  } finally {
    if (seq === buildSeq) t.buffering = false;
  }
}

async function playNow(rateOverride?: number): Promise<void> {
  const t = useTransportStore();
  if (!t.hasAudio || t.buffering) return;
  const dur = engine.durationMs();
  if (t.positionMs >= dur) {
    engine.seek(0);
    t.positionMs = 0;
  }
  refreshBeatFlash(t.positionMs);
  t.playing = true;
  t.followActive = t.followManual;
  t.followLocked = false;
  const rate = rateOverride ?? t.rate;
  const orig = engine.sourceBuffer!;
  if (!needStretch(rate)) {
    engine.playFrom(t.positionMs, {
      buf: orig,
      contentRate: 1,
      sourceRate: rate,
    });
    return;
  }
  const buf = await ensureStretched(rate);
  if (!t.playing || !buf) return;
  engine.playFrom(t.positionMs, {
    buf,
    contentRate: rate,
    sourceRate: 1,
  });
}

export function play(rate?: number): void {
  void playNow(rate);
}

export function pause(): void {
  const t = useTransportStore();
  t.buffering = false;
  buildSeq++;
  engine.pause();
  t.playing = false;
}

export function togglePlay(rate?: number): void {
  const t = useTransportStore();
  if (t.playing || t.buffering) pause();
  else play(rate);
}

export function stop(): void {
  const t = useTransportStore();
  t.buffering = false;
  buildSeq++;
  engine.stop();
  t.playing = false;
  t.positionMs = 0;
  t.followActive = false;
  t.followLocked = false;
  refreshBeatFlash(0);
}

export function seekTo(ms: number): void {
  const t = useTransportStore();
  engine.seek(ms);
  t.positionMs = engine.positionMs();
  refreshBeatFlash(t.positionMs);
}

export function applySpeed(rate: number, pitchFollow: boolean): void {
  const t = useTransportStore();
  const r = Math.min(4, Math.max(0.1, rate));
  t.rate = r;
  t.pitchFollow = pitchFollow;
  if (!t.playing || !t.hasAudio) return;
  const pos = engine.positionMs();
  const orig = engine.sourceBuffer;
  if (!orig) return;
  const native = pitchFollow || Math.abs(r - 1) < 1e-4;
  if (native) {
    engine.playFrom(pos, { buf: orig, contentRate: 1, sourceRate: r });
    return;
  }
  engine.pause();
  void ensureStretched(r).then((buf) => {
    if (t.playing && buf) {
      engine.playFrom(pos, { buf, contentRate: r, sourceRate: 1 });
    }
  });
}
