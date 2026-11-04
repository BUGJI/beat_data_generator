import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { buildGridSegments, type GridSegment } from "../../grid";
import { DEFAULT_DIV } from "../../metrics";
import { buildTempoMap, type TempoMap } from "../../tempo";
import type {
  BeatProject,
  BpmPoint,
  Marker,
  MarkerTrack,
  ProjectNote,
} from "../../types";
import { setBaseBpmImpl, setOffsetImpl, updateBpmPointImpl } from "./bpm";
import { setBpmGridDivImpl, setGridDivImpl } from "./grid";
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

/**
 * The persisted document plus runtime-only editor metadata. Extending
 * `BeatProject` keeps the in-memory shape and the on-disk wire format from
 * drifting apart as fields are added.
 */
export interface ProjectState extends BeatProject {
  /** Absolute path of the loaded audio (runtime only). */
  audioPath: string | null;
  projectPath: string | null;
  dirty: boolean;
  bpmLocked: boolean;
}

export const useProjectStore = defineStore("project", () => {
  const app = ref<"beat-data-generator">("beat-data-generator");
  const version = ref<2>(2);
  const name = ref("");
  const baseBpm = ref(120);
  const offsetMs = ref(0);
  const gridDiv = ref(DEFAULT_DIV);
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

  /** Effective beat-grid regions: global subdivision plus BPM-point overrides. */
  const gridSegments = computed<GridSegment[]>(() =>
    buildGridSegments(gridDiv.value, bpmPoints.value),
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

  /** O(1) lookups shared by pointer hit tests, selection and plugin views. */
  const markersById = computed<Map<string, Marker>>(
    () => new Map(markers.value.map((m) => [m.id, m])),
  );
  const bpmPointsById = computed<Map<string, BpmPoint>>(
    () => new Map(bpmPoints.value.map((p) => [p.id, p])),
  );
  const tracksById = computed<Map<string, MarkerTrack>>(
    () => new Map(tracks.value.map((t) => [t.id, t])),
  );

  return {
    app,
    version,
    name,
    baseBpm,
    offsetMs,
    gridDiv,
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
    gridSegments,
    markersByTrack,
    markersById,
    bpmPointsById,
    tracksById,
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
    setGridDiv: setGridDivImpl,
    setBpmGridDiv: setBpmGridDivImpl,
  };
});
