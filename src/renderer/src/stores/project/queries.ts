import { gridDivAt } from "../../grid";
import type { BpmPoint, Marker, MarkerTrack } from "../../types";
import { useProjectStore } from "./store";

/** Read-only lookups into the project document. */

export const sortedTracks = (): MarkerTrack[] => useProjectStore().tracks;

const EMPTY_MARKERS: Marker[] = [];

export const markersInTrack = (trackId: string): Marker[] =>
  useProjectStore().markersByTrack.get(trackId) ?? EMPTY_MARKERS;

export const findMarker = (id: string): Marker | undefined =>
  useProjectStore().markersById.get(id);

export const findBpmPoint = (id: string): BpmPoint | undefined =>
  useProjectStore().bpmPointsById.get(id);

export const findTrack = (id: string): MarkerTrack | undefined =>
  useProjectStore().tracksById.get(id);

/** Effective beat-grid subdivision at a beat. */
export const gridDivAtBeat = (beat: number): number =>
  gridDivAt(useProjectStore().gridSegments, beat);
