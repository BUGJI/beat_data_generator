import {
  BEAT_FX_DURATION_MS,
  BEAT_FX_IDS,
  type BeatFxId,
} from "@shared/beatFx";
import { engine } from "../engine";
import { visibleMarkers } from "../stores/project";
import { useSettingsStore } from "../stores/settings";
import { useTransportStore } from "../stores/transport";
import { useUiStore } from "../stores/ui";
import { lowerBound } from "../utils/search";
import { isBarStartAt } from "../meter";
import { motionMs } from "./motion";
import { meterSegments, timeOfBeat } from "./timeline";
import { BeatClickScheduler } from "./beatClick";

// ---- beat indicators: fire once per distinct marker time crossed while
// playing. A single marker -> beat light; two or more coincident markers ->
// overlap light whose colour encodes how many markers share that instant. ----

interface FlashEvent {
  t: number;
  n: number;
  /** true when this instant lands on a bar line (accented click). */
  accent: boolean;
  /** distinct tracks that have a marker at this instant. */
  trackIds: string[];
  /** every marker id at this instant (for per-marker effects). */
  markerIds: string[];
}

/** How far ahead clicks are handed to the audio clock. */
const CLICK_LOOKAHEAD_SEC = 0.2;

const clickScheduler = new BeatClickScheduler();

let flashEvents: FlashEvent[] = [];
let flashIdx = 0;
let flashReady = false;
// Last observed playhead position, used to detect a suspended tick loop.
let lastPosMs = 0;
// A forward jump larger than this means frames were suspended (the window was
// hidden without background throttling disabled, or the machine slept). The
// visual pulses we blew past are dropped instead of firing as one burst; the
// audio scheduler independently skips overdue clicks.
const SUSPEND_GAP_MS = 500;

/**
 * Per-effect target selector: which entity keys an effect animates for one
 * crossed beat. Adding a new playback effect supplies one entry here, its id in
 * shared/beatFx.ts, a render consumer and an i18n label.
 */
const FX_TARGETS: Record<BeatFxId, (ev: FlashEvent) => string[]> = {
  laneGlow: (ev) => ev.trackIds,
  markerFlash: (ev) => ev.markerIds,
};

function firstEventAtOrAfter(arr: FlashEvent[], pos: number): number {
  return lowerBound(arr, (ev) => ev.t, pos);
}

export function refreshBeatFlash(posMs: number): void {
  // refreshed on play/seek/stop events (not per-frame), so recompute freely
  const ui = useUiStore();
  for (const id of BEAT_FX_IDS) {
    ui.fxPulses[id] = {};
    ui.fxUntil[id] = 0;
  }
  const groups = new Map<
    string,
    { beat: number; count: number; trackIds: string[]; markerIds: string[] }
  >();
  for (const m of visibleMarkers()) {
    const key = `${Math.round(m.beat * 1e6)}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      g.markerIds.push(m.id);
      if (!g.trackIds.includes(m.trackId)) g.trackIds.push(m.trackId);
    } else {
      groups.set(key, {
        beat: m.beat,
        count: 1,
        trackIds: [m.trackId],
        markerIds: [m.id],
      });
    }
  }
  const segments = meterSegments();
  flashEvents = [...groups.values()]
    .map((g) => ({
      t: timeOfBeat(g.beat),
      n: g.count,
      accent: isBarStartAt(segments, g.beat),
      trackIds: g.trackIds,
      markerIds: g.markerIds,
    }))
    .sort((a, b) => a.t - b.t);
  flashIdx = firstEventAtOrAfter(flashEvents, posMs);
  flashReady = flashIdx < flashEvents.length;
  lastPosMs = posMs;
  clickScheduler.invalidate();
}

export function tickBeatFlash(): void {
  const t = useTransportStore();
  if (!t.playing) return;
  scheduleBeatClicks(t);
  const pos = t.positionMs;
  // A loop wrap moves the playhead backwards. Reset the visual cursor so the
  // effects fire again on the next pass; clicks follow the engine clock epoch.
  if (pos + 50 < lastPosMs) {
    flashIdx = firstEventAtOrAfter(flashEvents, pos);
    flashReady = flashIdx < flashEvents.length;
    lastPosMs = pos;
    return;
  }
  if (!flashReady) return;
  const ui = useUiStore();
  const settings = useSettingsStore().settings;
  const enabled = settings.beatFx;
  const pulseOn = settings.beatPulse;
  const fxOn = settings.beatFxMaster;
  // In lightweight mode only a handful of entities animate per instant; this
  // keeps dense multi-track projects from turning every crossing into a full
  // canvas of blooms.
  const maxTargets = settings.beatFxDensity === "light" ? 8 : Infinity;
  // Drop the events we jumped past after a stall rather than firing them all
  // together (that is what produced the overlapping-click burst / clipping).
  const suspended = pos - lastPosMs > SUSPEND_GAP_MS;
  lastPosMs = pos;
  while (
    flashIdx < flashEvents.length &&
    pos >= (flashEvents[flashIdx] as FlashEvent).t
  ) {
    const ev = flashEvents[flashIdx] as FlashEvent;
    flashIdx++;
    if (suspended) continue;
    // Nothing visual is enabled: the audio scheduler above already handled the
    // click, so skip the pulse bookkeeping entirely.
    if (!pulseOn && !fxOn) continue;
    if (pulseOn) {
      ui.beatPulse++;
      if (ev.n >= 2) {
        ui.overlapPulse++;
        ui.overlapCount = ev.n;
      }
    }
    if (!fxOn) continue;
    const now = performance.now();
    for (const id of BEAT_FX_IDS) {
      if (!enabled[id]) continue;
      const dur = motionMs(BEAT_FX_DURATION_MS[id]);
      if (dur <= 0) continue;
      const pulses = ui.fxPulses[id];
      const targets = FX_TARGETS[id](ev);
      const n = Math.min(targets.length, maxTargets);
      for (let i = 0; i < n; i++) {
        const key = targets[i]!;
        pulses[key] = { seq: (pulses[key]?.seq ?? 0) + 1, at: now, dur };
      }
      ui.fxUntil[id] = Math.max(ui.fxUntil[id], now + dur);
    }
  }
  if (flashIdx >= flashEvents.length) flashReady = false;
}

/**
 * Hand upcoming clicks to the audio clock ahead of time. This is deliberately
 * separate from the visual pulse loop: audio is scheduled early, effects fire
 * when the playhead actually crosses the marker.
 */
function scheduleBeatClicks(t: ReturnType<typeof useTransportStore>): void {
  if (!flashEvents.length) return;
  const clock = engine.audioClock();
  if (!clock) return;
  const loopEnd =
    t.loopEnabled && t.loopEndMs > t.loopStartMs + 1 ? t.loopEndMs : null;
  clickScheduler.tick(clock, flashEvents, {
    lookaheadSec: CLICK_LOOKAHEAD_SEC,
    loopEndMs: loopEnd,
    schedule: (when, count, accent) =>
      engine.playMetronomeAt(when, count, accent),
  });
}
