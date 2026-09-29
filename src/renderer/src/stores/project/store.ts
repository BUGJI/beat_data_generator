import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { buildTempoMap, type TempoMap } from "../../tempo";
import type { BpmPoint, Marker, MarkerTrack, ProjectNote } from "../../types";
import { setBaseBpmImpl, setOffsetImpl, updateBpmPointImpl } from "./bpm";
import {
  addMarkerImpl,
  moveMarkerImpl,
  removeMarkerAtImpl,
  updateMarkerAttrsImpl,
  updateMarkerLoopImpl,
} from "./markers";
import { updateNoteImpl } from "./notes";

/**
 * The persisted project document: tempo, tracks, markers, bpm points and notes.
 * This is the single source of truth for everything that is saved to disk. The
 * edit functions live in sibling modules and are exposed here as Pinia actions.
 */

export interface ProjectState {
  app: "beat-data-generator";
  version: 2;
  name: string;
  baseBpm: number;
  offsetMs: number;
  audioPath: string | null;
  audioName: string | null;
  audioMd5: string | null;
  bpmLocked: boolean;
  tracks: MarkerTrack[];
  markers: Marker[];
  bpmPoints: BpmPoint[];
  notes: ProjectNote[];
  projectPath: string | null;
  dirty: boolean;
}

export const useProjectStore = defineStore("project", () => {
  const app = ref<"beat-data-generator">("beat-data-generator");
  const version = ref<2>(2);
  const name = ref("");
  const baseBpm = ref(120);
  const offsetMs = ref(0);
  const audioPath = ref<string | null>(null);
  const audioName = ref<string | null>(null);
  const audioMd5 = ref<string | null>(null);
  const bpmLocked = ref(false);
  const tracks = ref<MarkerTrack[]>([]);
  const markers = ref<Marker[]>([]);
  const bpmPoints = ref<BpmPoint[]>([]);
  const notes = ref<ProjectNote[]>([]);
  const projectPath = ref<string | null>(null);
  const dirty = ref(false);

  // Derived document state kept as store getters so each cache is tied to the
  // store instance lifecycle (previously module-level computeds that outlived a
  // disposed Pinia instance and captured the first one forever).

  /** Tempo map derived from base BPM / offset / tempo points. */
  const tempoMap = computed<TempoMap>(() =>
    buildTempoMap(baseBpm.value, offsetMs.value, bpmPoints.value),
  );

  /** Markers grouped and sorted per track. Rebuilt only when a marker's track
   *  or beat changes; the canvas reads it once per visible lane per frame. */
  const markersByTrack = computed<Map<string, Marker[]>>(() => {
    const map = new Map<string, Marker[]>();
    for (const m of markers.value) {
      const arr = map.get(m.trackId);
      if (arr) arr.push(m);
      else map.set(m.trackId, [m]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.beat - b.beat);
    return map;
  });

  return {
    app,
    version,
    name,
    baseBpm,
    offsetMs,
    audioPath,
    audioName,
    audioMd5,
    bpmLocked,
    tracks,
    markers,
    bpmPoints,
    notes,
    projectPath,
    dirty,
    tempoMap,
    markersByTrack,
    // ---- high-frequency mutations exposed as Pinia actions ----
    moveMarker: moveMarkerImpl,
    addMarker: addMarkerImpl,
    removeMarkerAt: removeMarkerAtImpl,
    updateMarkerLoop: updateMarkerLoopImpl,
    updateMarkerAttrs: updateMarkerAttrsImpl,
    updateBpmPoint: updateBpmPointImpl,
    updateNote: updateNoteImpl,
    setBaseBpm: setBaseBpmImpl,
    setOffset: setOffsetImpl,
  };
});
