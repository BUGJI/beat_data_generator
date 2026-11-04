import { useProjectStore } from "../stores/project";
import { tempoMap } from "../services/timeline";
import type { LoopConfig } from "../types";

export interface TrackView {
  id: string;
  name: string;
  color: string;
  locked: boolean;
  hidden: boolean;
  type: string;
}

export interface MarkerView {
  id: string;
  trackId: string;
  beat: number;
  timeMs: number;
  parentId?: string;
  loop?: LoopConfig | null;
  attrs?: Record<string, unknown>;
}

export interface BpmView {
  id: string;
  beat: number;
  mode: "abs" | "mult";
  value: number;
}

export interface ProjectView {
  name: string;
  baseBpm: number;
  offsetMs: number;
  audioName: string | null;
  audioMd5: string | null;
  bpmLocked: boolean;
  tracks: TrackView[];
  markers: MarkerView[];
  bpmPoints: BpmView[];
}

export interface SelectionView {
  kind: "marker" | "bpm" | null;
  id: string | null;
  markerIds: string[];
}

function clampMarkerLoop(l?: LoopConfig | null): LoopConfig | null {
  if (!l) return null;
  return {
    interval: l.interval,
    count: l.count,
    ...(l.exclude?.length ? { exclude: [...l.exclude] } : {}),
  };
}

/** Immutable, hidden-track-filtered view of the project for plugin code. */
export function snapshotProject(): ProjectView {
  const map = tempoMap();
  const p = useProjectStore();
  // hidden tracks (and their markers) are withheld from plugins.
  const hiddenSet = new Set(
    p.tracks.filter((t) => t.hidden === true).map((t) => t.id),
  );
  return {
    name: p.name,
    baseBpm: p.baseBpm,
    offsetMs: p.offsetMs,
    audioName: p.audioName,
    audioMd5: p.audioMd5,
    bpmLocked: p.bpmLocked === true,
    tracks: p.tracks
      .filter((t) => t.hidden !== true)
      .map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        locked: t.locked === true,
        hidden: t.hidden === true,
        type: (t as { type?: string }).type ?? "beat",
      })),
    markers: p.markers
      .filter((m) => !hiddenSet.has(m.trackId))
      .map((m) => {
        const out: MarkerView = {
          id: m.id,
          trackId: m.trackId,
          beat: m.beat,
          timeMs: map.timeOfBeat(m.beat),
        };
        if (m.parentId) out.parentId = m.parentId;
        const loop = clampMarkerLoop(m.loop);
        if (loop) out.loop = loop;
        const attrs = (m as { attrs?: Record<string, unknown> }).attrs;
        if (attrs) out.attrs = { ...attrs };
        return out;
      }),
    bpmPoints: p.bpmPoints.map((b) => ({
      id: b.id,
      beat: b.beat,
      mode: b.mode,
      value: b.value,
    })),
  };
}
