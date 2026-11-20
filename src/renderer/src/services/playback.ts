import { engine } from "../engine";
import { stretchAudioBuffer } from "../stretch";
import { rateCacheKey } from "../stretch/cache";
import { isStretchTooLarge } from "../stretch/errors";
import { StretchScheduler } from "../stretch/scheduler";
import { findMarker, useProjectStore } from "../stores/project";
import { markerSelectionIds } from "../stores/selection";
import { useSettingsStore } from "../stores/settings";
import { resetLoopState, useTransportStore } from "../stores/transport";
import { toast } from "../ui/toast";
import { t } from "../utils/text";
import { refreshBeatFlash } from "./flash";
import { resetGridClick } from "./gridClick";
import {
  bpmAtTime,
  beatOfTime,
  beatsPerBarAtBeat,
  contentEndMs,
  timeOfBeat,
} from "./timeline";
import { msPerBeat } from "../tempo";
import { currentNumberPolicy } from "../utils/numberPolicy";
import { alignViewForPlayback, clearFollowHold } from "./follow";

/**
 * Playback orchestration around the audio engine: play / pause / stop / seek,
 * plus speed changes and the optional pitch-preserving stretch buffer.
 */

export function setPosition(ms: number): void {
  const t = useTransportStore();
  if (t.countingIn) {
    cancelCountIn();
    t.playing = false;
  }
  t.positionMs = ms;
  if (!engine.playing) engine.seek(ms);
  resetGridClick(ms);
  refreshBeatFlash(ms);
}

let countInTimer = 0;
let countInToken = 0;

function cancelCountIn(): void {
  countInToken++;
  if (countInTimer) {
    window.clearTimeout(countInTimer);
    countInTimer = 0;
  }
  engine.cancelScheduledClicks();
  useTransportStore().countingIn = false;
}

function beginPlayback(config: {
  buf: AudioBuffer;
  contentRate: number;
  sourceRate: number;
}): void {
  const t = useTransportStore();
  const bars = Math.max(
    0,
    Math.min(4, Math.round(useSettingsStore().settings.countInBars)),
  );
  cancelCountIn();
  if (bars <= 0) {
    engine.playFrom(t.positionMs, config);
    resetGridClick(t.positionMs);
    return;
  }
  const bpm = Math.min(400, Math.max(30, bpmAtTime(t.positionMs)));
  const beatMs = msPerBeat(bpm);
  const beatsPerBar = Math.max(
    1,
    Math.round(beatsPerBarAtBeat(beatOfTime(t.positionMs))),
  );
  const beats = bars * beatsPerBar;
  const token = ++countInToken;
  t.countingIn = true;
  for (let i = 0; i < beats; i++) {
    engine.scheduleClick((i * beatMs) / 1000, i % beatsPerBar === 0);
  }
  resetGridClick(t.positionMs);
  countInTimer = window.setTimeout(() => {
    if (token !== countInToken) return;
    countInTimer = 0;
    t.countingIn = false;
    engine.playFrom(t.positionMs, config);
    resetGridClick(t.positionMs);
  }, beats * beatMs);
}

const needStretch = (rate: number): boolean =>
  !useTransportStore().pitchFollow && Math.abs(rate - 1) > 1e-4;

/** Wait for a rate change to settle before rendering a new stretched buffer. */
const RATE_SETTLE_MS = 120;
/** Avoid flashing the "processing" label for short renders. */
const BUFFERING_DELAY_MS = 200;

let pendingRenders = false;
let bufferingTimer = 0;
/** Rate key the current playback intent expects; stale errors are ignored. */
let desiredStretchKey: string | null = null;

function clearBufferingTimer(): void {
  if (!bufferingTimer) return;
  window.clearTimeout(bufferingTimer);
  bufferingTimer = 0;
}

function setStretchPending(pending: boolean): void {
  const tr = useTransportStore();
  pendingRenders = pending;
  if (pending) {
    if (tr.buffering || bufferingTimer) return;
    bufferingTimer = window.setTimeout(() => {
      bufferingTimer = 0;
      if (pendingRenders) tr.buffering = true;
    }, BUFFERING_DELAY_MS);
    return;
  }
  clearBufferingTimer();
  tr.buffering = false;
}

function onStretchError(error: unknown, key: string): void {
  // A render for an abandoned rate may fail after the user moved on; it must
  // not stop the new playback or raise a toast.
  if (key !== desiredStretchKey) return;
  const tr = useTransportStore();
  tr.playing = false;
  desiredStretchKey = null;
  pendingRenders = false;
  clearBufferingTimer();
  tr.buffering = false;
  toast.error(
    t(
      isStretchTooLarge(error)
        ? "transport.stretchTooLarge"
        : "transport.stretchFailed",
    ),
  );
}

/**
 * One scheduler owns cache lookups, in-flight de-duplication and epoch guards.
 * A finished render is cached even when playback was paused meanwhile, so the
 * next play at the same rate does not stretch the track again.
 */
const stretchScheduler = new StretchScheduler({
  source: () => engine.sourceBuffer,
  get: (key) => engine.getStretched(key),
  put: (key, buffer) => engine.putStretched(key, buffer),
  render: (source, rate) =>
    stretchAudioBuffer(source, rate, useSettingsStore().settings.stretchEngine),
  epoch: () => engine.stretchEpochValue(),
  onPending: setStretchPending,
  onError: onStretchError,
});

let rateApplyTimer = 0;
let rateApplyToken = 0;
let playIntent = 0;

function cancelScheduledRateApply(): void {
  rateApplyToken++;
  if (!rateApplyTimer) return;
  window.clearTimeout(rateApplyTimer);
  rateApplyTimer = 0;
}

function scheduleRateApply(rate: number): void {
  const token = ++rateApplyToken;
  if (rateApplyTimer) window.clearTimeout(rateApplyTimer);
  rateApplyTimer = window.setTimeout(() => {
    rateApplyTimer = 0;
    if (token !== rateApplyToken) return;
    void switchToStretched(rate, token);
  }, RATE_SETTLE_MS);
}

async function switchToStretched(rate: number, token: number): Promise<void> {
  const tr = useTransportStore();
  if (!tr.playing || tr.countingIn) return;
  const key = rateCacheKey(rate);
  desiredStretchKey = key;
  const cached = engine.getStretched(key);
  if (cached) {
    if (token !== rateApplyToken) return;
    engine.pinStretched(key);
    const pos = engine.positionMs();
    engine.playFrom(pos, {
      buf: cached,
      contentRate: Number(key),
      sourceRate: 1,
    });
    resetGridClick(pos);
    return;
  }
  engine.pause();
  const result = await stretchScheduler.request(rate);
  if (token !== rateApplyToken || !tr.playing || !result) return;
  engine.pinStretched(result.key);
  const pos = engine.positionMs();
  engine.playFrom(pos, {
    buf: result.buffer,
    contentRate: result.rate,
    sourceRate: 1,
  });
  resetGridClick(pos);
}

async function playNow(rateOverride?: number): Promise<void> {
  const tr = useTransportStore();
  if (!tr.hasAudio) return;
  const intent = ++playIntent;
  cancelScheduledRateApply();
  const dur = engine.durationMs();
  if (tr.positionMs >= dur) {
    engine.seek(0);
    tr.positionMs = 0;
  }
  refreshBeatFlash(tr.positionMs);
  clearFollowHold();
  if (tr.followManual) alignViewForPlayback(tr.positionMs);
  tr.playing = true;
  tr.followActive = tr.followManual;
  tr.followLocked = false;
  const rate = rateOverride ?? tr.rate;
  const orig = engine.sourceBuffer;
  // the transport can report audio before the buffer is swapped in (e.g. right
  // after opening a project); never dereference a missing buffer
  if (!orig) {
    tr.playing = false;
    desiredStretchKey = null;
    return;
  }
  if (!needStretch(rate)) {
    desiredStretchKey = null;
    engine.pinStretched(null);
    beginPlayback({ buf: orig, contentRate: 1, sourceRate: rate });
    return;
  }
  desiredStretchKey = rateCacheKey(rate);
  const result = await stretchScheduler.request(rate);
  if (intent !== playIntent || !tr.playing) return;
  if (!result) {
    // A superseded request leaves the newest one in charge; a dropped result
    // with nothing else running means playback never started.
    if (!stretchScheduler.pending) tr.playing = false;
    return;
  }
  engine.pinStretched(result.key);
  beginPlayback({
    buf: result.buffer,
    contentRate: result.rate,
    sourceRate: 1,
  });
}

export function play(rate?: number): void {
  void playNow(rate);
}

export function pause(): void {
  const t = useTransportStore();
  playIntent++;
  desiredStretchKey = null;
  cancelScheduledRateApply();
  cancelCountIn();
  engine.pause();
  t.playing = false;
  resetGridClick(t.positionMs);
}

export function togglePlay(rate?: number): void {
  const t = useTransportStore();
  if (t.playing) pause();
  else play(rate);
}

export function stop(): void {
  const t = useTransportStore();
  playIntent++;
  desiredStretchKey = null;
  cancelScheduledRateApply();
  cancelCountIn();
  engine.stop();
  clearFollowHold();
  t.playing = false;
  t.positionMs = 0;
  t.followActive = false;
  t.followLocked = false;
  resetGridClick(0);
  refreshBeatFlash(0);
}

export function seekTo(ms: number): void {
  const t = useTransportStore();
  if (t.countingIn) {
    cancelCountIn();
    t.playing = false;
  }
  engine.seek(ms);
  t.positionMs = engine.positionMs();
  resetGridClick(t.positionMs);
  refreshBeatFlash(t.positionMs);
}

/** Smallest positive playback rate representable at the UI's 2-decimal precision. */
export const SPEED_MIN = 0.01;

export function applySpeed(rate: number, pitchFollow: boolean): void {
  const tr = useTransportStore();
  const r = !Number.isFinite(rate)
    ? 1
    : currentNumberPolicy().free
      ? rate
      : Math.max(SPEED_MIN, rate);
  tr.rate = r;
  tr.pitchFollow = pitchFollow;
  if (!tr.playing || !tr.hasAudio) {
    desiredStretchKey = null;
    cancelScheduledRateApply();
    return;
  }
  if (tr.countingIn) {
    pause();
    play(r);
    return;
  }
  const orig = engine.sourceBuffer;
  if (!orig) return;
  if (pitchFollow || Math.abs(r - 1) < 1e-4) {
    cancelScheduledRateApply();
    desiredStretchKey = null;
    const pos = engine.positionMs();
    engine.pinStretched(null);
    engine.playFrom(pos, { buf: orig, contentRate: 1, sourceRate: r });
    resetGridClick(pos);
    return;
  }
  const key = rateCacheKey(r);
  const cached = engine.getStretched(key);
  if (cached) {
    cancelScheduledRateApply();
    desiredStretchKey = key;
    const pos = engine.positionMs();
    engine.pinStretched(key);
    engine.playFrom(pos, {
      buf: cached,
      contentRate: Number(key),
      sourceRate: 1,
    });
    resetGridClick(pos);
    return;
  }
  // No cached buffer yet: let wheel/typing settle so only the final rate is
  // rendered. The old audio keeps playing during this short window.
  desiredStretchKey = key;
  scheduleRateApply(r);
}

export function setLoopRange(
  startMs: number,
  endMs: number,
  enabled = true,
): void {
  const t = useTransportStore();
  const audioDur = engine.durationMs();
  const limit = Math.max(0, audioDur > 0 ? audioDur : contentEndMs());
  const start = Math.max(0, Math.min(startMs, limit));
  const end = Math.max(0, Math.min(endMs, limit));
  t.loopStartMs = Math.min(start, end);
  t.loopEndMs = Math.max(start, end);
  t.loopEnabled = enabled && t.loopEndMs > t.loopStartMs + 50;
  engine.setLoop(t.loopEnabled, t.loopStartMs, t.loopEndMs);
}

export function clearLoop(): void {
  resetLoopState();
}

function loopRangeFromSelection(): [number, number] | null {
  const ids = new Set(markerSelectionIds());
  if (!ids.size) return null;
  const project = useProjectStore();
  const selected: number[] = [];
  for (const marker of project.markers) {
    if (ids.has(marker.id) || (marker.parentId && ids.has(marker.parentId))) {
      selected.push(timeOfBeat(marker.beat));
    }
  }
  if (!selected.length) return null;
  if (selected.length === 1) {
    const marker = findMarker(markerSelectionIds()[0] ?? "");
    if (!marker) return null;
    return [
      timeOfBeat(marker.beat),
      timeOfBeat(
        marker.beat + Math.max(1, Math.round(beatsPerBarAtBeat(marker.beat))),
      ),
    ];
  }
  return [Math.min(...selected), Math.max(...selected)];
}

export function toggleLoop(): void {
  const t = useTransportStore();
  if (t.loopEnabled) {
    t.loopEnabled = false;
    engine.setLoop(false, t.loopStartMs, t.loopEndMs);
    return;
  }
  if (t.loopEndMs > t.loopStartMs + 50) {
    t.loopEnabled = true;
    engine.setLoop(true, t.loopStartMs, t.loopEndMs);
    return;
  }
  const selection = loopRangeFromSelection();
  if (selection) {
    setLoopRange(selection[0], selection[1], true);
    return;
  }
  const beat = beatOfTime(t.positionMs);
  setLoopRange(
    t.positionMs,
    timeOfBeat(beat + Math.max(1, Math.round(beatsPerBarAtBeat(beat)))),
    true,
  );
}

export function setLoopFromDetection(
  startSec: number | null,
  endSec: number | null,
): void {
  if (startSec === null || endSec === null) return;
  if (!(endSec > startSec)) return;
  setLoopRange(startSec * 1000, endSec * 1000, true);
}
