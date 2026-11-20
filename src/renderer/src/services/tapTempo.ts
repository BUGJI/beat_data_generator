import { reactive } from "vue";
import { setBaseBpm } from "../stores/project";
import { BPM_MIN } from "../tempo";

const RESET_AFTER_MS = 2200;
const MAX_TAPS = 9;

export const tapTempoState = reactive<{
  count: number;
  bpm: number | null;
}>({ count: 0, bpm: null });

let taps: number[] = [];

export function tapTempo(now = performance.now()): void {
  if (taps.length && now - (taps[taps.length - 1] as number) > RESET_AFTER_MS) {
    taps = [];
  }
  taps.push(now);
  if (taps.length > MAX_TAPS) taps.shift();
  tapTempoState.count = taps.length;
  if (taps.length < 2) return;
  const deltas: number[] = [];
  for (let i = 1; i < taps.length; i++) {
    deltas.push((taps[i] as number) - (taps[i - 1] as number));
  }
  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)] as number;
  if (median <= 0) return;
  const bpm = 60000 / median;
  if (!Number.isFinite(bpm) || bpm < BPM_MIN || bpm > 400) return;
  tapTempoState.bpm = Math.round(bpm * 10) / 10;
  setBaseBpm(tapTempoState.bpm);
}

export function resetTapTempo(): void {
  taps = [];
  tapTempoState.count = 0;
  tapTempoState.bpm = null;
}
