import { engine } from "../engine";
import { isBarStartAt } from "../meter";
import { useSettingsStore } from "../stores/settings";
import { useTransportStore } from "../stores/transport";
import { beatOfTime, meterSegments } from "./timeline";

let lastBeat = -1;

export function resetGridClick(posMs?: number): void {
  const pos = posMs ?? useTransportStore().positionMs;
  const beat = beatOfTime(pos);
  const idx = Math.floor(beat + 1e-9);
  lastBeat = beat - idx < 0.03 ? idx - 1 : idx;
}

export function tickGridClick(): void {
  const t = useTransportStore();
  if (!t.playing || t.countingIn) return;
  if (!useSettingsStore().settings.gridMetronome) {
    lastBeat = Math.floor(beatOfTime(t.positionMs) + 1e-9);
    return;
  }
  const beat = beatOfTime(t.positionMs);
  const idx = Math.floor(beat + 1e-9);
  if (lastBeat < 0) {
    lastBeat = idx;
    return;
  }
  if (idx < lastBeat) {
    resetGridClick(t.positionMs);
    return;
  }
  if (idx === lastBeat) return;
  if (idx - lastBeat > 4) {
    lastBeat = idx;
    return;
  }
  const segments = meterSegments();
  for (let b = lastBeat + 1; b <= idx; b++) {
    engine.playBeatClick(isBarStartAt(segments, b));
  }
  lastBeat = idx;
}
