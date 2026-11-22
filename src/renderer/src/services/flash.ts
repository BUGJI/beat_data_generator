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
import { timeOfBeat } from "./timeline";

// ---- beat indicators: fire once per distinct marker time crossed while
// playing. A single marker -> beat light; two or more coincident markers ->
// overlap light whose colour encodes how many markers share that instant. ----

interface FlashEvent {
  t: number;
  n: number;
  /** distinct tracks that have a marker at this instant. */
  trackIds: string[];
  /** every marker id at this instant (for per-marker effects). */
  markerIds: string[];
}

let flashEvents: FlashEvent[] = [];
let flashIdx = 0;
let flashReady = false;
// Clicks are pre-scheduled on the audio clock; this is how far ahead we queue.
const SCHEDULE_AHEAD_MS = 120;
// Next event to hand to the audio scheduler (leads flashIdx).
let schedIdx = 0;
// Last observed playhead position, used to detect a suspended tick loop.
let lastPosMs = 0;
// A forward jump larger than this means frames were suspended (the window was
// hidden without background throttling disabled, or the machine slept). The
// events we blew past are dropped instead of all firing at once as a burst of
// overlapping metronome clicks (which clips / pops).
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
  flashEvents = [...groups.values()]
    .map((g) => ({
      t: timeOfBeat(g.beat),
      n: g.count,
      trackIds: g.trackIds,
      markerIds: g.markerIds,
    }))
    .sort((a, b) => a.t - b.t);
  flashIdx = firstEventAtOrAfter(flashEvents, posMs);
  schedIdx = flashIdx;
  flashReady = flashIdx < flashEvents.length;
  lastPosMs = posMs;
}

export function tickBeatFlash(): void {
  const t = useTransportStore();
  if (!t.playing || !flashReady) return;
  const ui = useUiStore();
  const enabled = useSettingsStore().settings.beatFx;
  const pos = t.positionMs;
  // Drop the events we jumped past after a stall rather than firing them all
  // together (that is what produced the overlapping-click burst / clipping).
  const suspended = pos - lastPosMs > SUSPEND_GAP_MS;
  lastPosMs = pos;

  // Audio: queue clicks ahead on the audio clock. Frame-rate jitter and short
  // main-thread stalls then no longer shift the click off its beat.
  const rate = t.rate > 0 ? t.rate : 1;
  const aheadMs = SCHEDULE_AHEAD_MS * rate;
  while (schedIdx < flashEvents.length) {
    const evA = flashEvents[schedIdx] as FlashEvent;
    const dtMs = evA.t - pos;
    if (dtMs > aheadMs) break;
    if (suspended && dtMs < 0) {
      schedIdx++;
      continue; // 跳过的旧事件不再补播，避免爆音
    }
    engine.scheduleMetronomeSample(Math.max(0, dtMs) / 1000 / rate, evA.n >= 3);
    schedIdx++;
  }

  while (
    flashIdx < flashEvents.length &&
    pos >= (flashEvents[flashIdx] as FlashEvent).t
  ) {
    const ev = flashEvents[flashIdx] as FlashEvent;
    flashIdx++;
    if (suspended) continue;
    ui.beatPulse++;
    // Click audio is already queued by the scheduler above.
    if (ev.n >= 2) {
      ui.overlapPulse++;
      ui.overlapCount = ev.n;
    }
    const now = performance.now();
    for (const id of BEAT_FX_IDS) {
      if (!ui.fxMasterOn || !enabled[id]) continue;
      const pulses = ui.fxPulses[id];
      for (const key of FX_TARGETS[id](ev)) {
        pulses[key] = { seq: (pulses[key]?.seq ?? 0) + 1, at: now };
      }
      ui.fxUntil[id] = Math.max(ui.fxUntil[id], now + BEAT_FX_DURATION_MS[id]);
    }
  }
  if (flashIdx >= flashEvents.length) flashReady = false;
}
