import { engine } from "../engine";
import { visibleMarkers } from "../stores/project";
import { useTransportStore } from "../stores/transport";
import { useUiStore } from "../stores/ui";
import { timeOfBeat } from "./timeline";

// ---- beat indicators: fire once per distinct marker time crossed while
// playing. A single marker -> beat light; two or more coincident markers ->
// overlap light whose colour encodes how many markers share that instant. ----

interface FlashEvent {
  t: number;
  n: number;
  ids: string[];
}

let flashEvents: FlashEvent[] = [];
let flashIdx = 0;
let flashReady = false;

function firstEventAtOrAfter(arr: FlashEvent[], pos: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((arr[mid] as FlashEvent).t < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function refreshBeatFlash(posMs: number): void {
  // refreshed on play/seek/stop events (not per-frame), so recompute freely
  const groups = new Map<
    string,
    { beat: number; count: number; ids: string[] }
  >();
  for (const m of visibleMarkers()) {
    const key = `${Math.round(m.beat * 1e6)}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      if (!g.ids.includes(m.trackId)) g.ids.push(m.trackId);
    } else {
      groups.set(key, { beat: m.beat, count: 1, ids: [m.trackId] });
    }
  }
  flashEvents = [...groups.values()]
    .map((g) => ({ t: timeOfBeat(g.beat), n: g.count, ids: g.ids }))
    .sort((a, b) => a.t - b.t);
  flashIdx = firstEventAtOrAfter(flashEvents, posMs);
  flashReady = flashIdx < flashEvents.length;
}

export function tickBeatFlash(): void {
  const t = useTransportStore();
  if (!t.playing || !flashReady) return;
  const ui = useUiStore();
  const pos = t.positionMs;
  while (
    flashIdx < flashEvents.length &&
    pos >= (flashEvents[flashIdx] as FlashEvent).t
  ) {
    const ev = flashEvents[flashIdx] as FlashEvent;
    flashIdx++;
    ui.beatPulse++;
    engine.playMetronome(ev.n);
    if (ev.n >= 2) {
      ui.overlapPulse++;
      ui.overlapCount = ev.n;
    }
    if (ui.glowEnabled) {
      for (const id of ev.ids) {
        ui.glowSeqs[id] = (ui.glowSeqs[id] ?? 0) + 1;
      }
    }
  }
  if (flashIdx >= flashEvents.length) flashReady = false;
}
