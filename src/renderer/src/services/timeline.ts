import { buildTempoMap } from "../tempo";
import { engine } from "../engine";
import { useProjectStore } from "../stores/project";
import { useTransportStore } from "../stores/transport";
import type { BpmPoint, Marker, Segment } from "../types";

/**
 * Tempo-map and time derived helpers. These read the project document (base
 * BPM / offset / tempo points) so they stay reactive wherever they are used.
 */

export const tempoMap = (): ReturnType<typeof buildTempoMap> => {
  const p = useProjectStore();
  return buildTempoMap(p.baseBpm, p.offsetMs, p.bpmPoints);
};

export const bpmAtBeat = (beat: number): number => tempoMap().bpmAtBeat(beat);
export const bpmAtTime = (ms: number): number => tempoMap().bpmAtTime(ms);
export const timeOfBeat = (beat: number): number => tempoMap().timeOfBeat(beat);
export const beatOfTime = (ms: number): number => tempoMap().beatOfTime(ms);
export const tempoSegments = (): Segment[] => tempoMap().segments;

export const markerTime = (m: Marker): number => timeOfBeat(m.beat);

export function effectiveBpmFor(point: BpmPoint): number {
  return tempoMap().bpmAtBeat(point.beat);
}

export function contentEndMs(): number {
  const p = useProjectStore();
  const t = useTransportStore();
  const map = tempoMap();
  const cands: number[] = [];
  if (t.hasAudio) cands.push(engine.durationMs());
  for (const m of p.markers) cands.push(markerTime(m));
  for (const pt of p.bpmPoints) cands.push(map.timeOfBeat(pt.beat));
  const audioLen = t.hasAudio ? engine.durationMs() : 0;
  const base = cands.length ? Math.max(...cands) : 0;
  const minLen = Math.max(audioLen, base);
  if (minLen <= 0) return map.timeOfBeat(16);
  return Math.max(minLen + 2000, map.timeOfBeat(16));
}

export function formatTime(ms: number): string {
  const sign = ms < 0 ? "-" : "";
  const abs = Math.abs(ms);
  const totalSec = Math.floor(abs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const milli = Math.floor(abs % 1000);
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${sign}${pad(m)}:${pad(s)}.${pad(milli, 3)}`;
}

export function durationReadout(): string {
  const t = useTransportStore();
  const d = engine.durationMs();
  if (!t.hasAudio || d <= 0) return formatTime(t.positionMs);
  return formatTime(Math.max(d, contentEndMs()));
}
