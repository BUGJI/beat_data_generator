import { computed, type ComputedRef } from "vue";
import { buildTempoMap, type TempoMap } from "../tempo";
import { engine } from "../engine";
import { useProjectStore } from "../stores/project";
import { useTransportStore } from "../stores/transport";
import type { BpmPoint, Marker, Segment } from "../types";

/**
 * Tempo-map and time derived helpers. These read the project document (base
 * BPM / offset / tempo points) so they stay reactive wherever they are used.
 */

// The map is rebuilt only when base BPM / offset / tempo points actually change,
// instead of on every `timeOfBeat`/`beatOfTime` call. It is read inside the
// canvas draw loops (once per beat / per marker), so caching it removes the
// repeated sort-and-rebuild that dominated large-project rendering.
let tempoMapComputed: ComputedRef<TempoMap> | null = null;

export const tempoMap = (): TempoMap => {
  if (!tempoMapComputed) {
    tempoMapComputed = computed(() => {
      const p = useProjectStore();
      return buildTempoMap(p.baseBpm, p.offsetMs, p.bpmPoints);
    });
  }
  return tempoMapComputed.value;
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

// Cached like the tempo map: the draw path asks for ContentEnd several times
// per frame, and recomputing it meant walking every marker each time.
let contentEndComputed: ComputedRef<number> | null = null;

export function contentEndMs(): number {
  if (!contentEndComputed) {
    contentEndComputed = computed(() => {
      const p = useProjectStore();
      const t = useTransportStore();
      // track the waveform object too, so reloading audio re-evaluates the cache
      void t.wave;
      const map = tempoMap();
      const audioLen = t.hasAudio ? engine.durationMs() : 0;
      let maxMarker = 0;
      for (const m of p.markers) {
        const tm = map.timeOfBeat(m.beat);
        if (tm > maxMarker) maxMarker = tm;
      }
      for (const pt of p.bpmPoints) {
        const tm = map.timeOfBeat(pt.beat);
        if (tm > maxMarker) maxMarker = tm;
      }
      const minLen = Math.max(audioLen, maxMarker);
      if (minLen <= 0) return map.timeOfBeat(16);
      return Math.max(minLen + 2000, map.timeOfBeat(16));
    });
  }
  return contentEndComputed.value;
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
