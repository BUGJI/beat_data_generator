import type { BpmPoint, Marker, MarkerTrack } from "../../types";
import { useProjectStore } from "./store";

/** Read-only lookups into the project document. */

export const sortedTracks = (): MarkerTrack[] => useProjectStore().tracks;

const EMPTY_MARKERS: Marker[] = [];

export const markersInTrack = (trackId: string): Marker[] =>
  useProjectStore().markersByTrack.get(trackId) ?? EMPTY_MARKERS;

export const findMarker = (id: string): Marker | undefined =>
  useProjectStore().markers.find((m) => m.id === id);

export const findBpmPoint = (id: string): BpmPoint | undefined =>
  useProjectStore().bpmPoints.find((p) => p.id === id);
