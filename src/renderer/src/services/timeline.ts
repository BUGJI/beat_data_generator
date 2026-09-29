import type { TempoMap } from "../tempo";
import { engine } from "../engine";
import { useProjectStore } from "../stores/project";
import { useTransportStore } from "../stores/transport";
import type { BpmPoint, Marker, Segment } from "../types";

/**
 * Tempo-map and time derived helpers. These read the project document (base
 * BPM / offset / tempo points) so they stay reactive wherever they are used.
 */

// The map is cached as a project-store getter: it is rebuilt only when base BPM
// / offset / tempo points actually change, instead of on every `timeOfBeat` /
// `beatOfTime` call. It is read inside the canvas draw loops (once per beat /
// per marker), so caching it removes the repeated sort-and-rebuild that
// dominated large-project rendering.
export const tempoMap = (): TempoMap => useProjectStore().tempoMap;

export const bpmAtBeat = (beat: number): number => tempoMap().bpmAtBeat(beat);
export const bpmAtTime = (ms: number): number => tempoMap().bpmAtTime(ms);
export const timeOfBeat = (beat: number): number => tempoMap().timeOfBeat(beat);
export const beatOfTime = (ms: number): number => tempoMap().beatOfTime(ms);
export const tempoSegments = (): Segment[] => tempoMap().segments;

export const markerTime = (m: Marker): number => timeOfBeat(m.beat);

export function effectiveBpmFor(point: BpmPoint): number {
  return tempoMap().bpmAtBeat(point.beat);
}

// Cached like the tempo map (see the transport store): the draw path asks for
// ContentEnd several times per frame, and recomputing it meant walking every
// marker each time.
export function contentEndMs(): number {
  return useTransportStore().contentEndMs;
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
