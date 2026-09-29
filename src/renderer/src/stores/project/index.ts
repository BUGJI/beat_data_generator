/**
 * Project document store and its edit API, split by concern:
 *   store.ts     - the Pinia store (state + derived getters + actions)
 *   queries.ts   - read-only lookups
 *   tracks.ts    - track CRUD and lock/hide flags
 *   markers.ts   - marker edits, loop children, alignment
 *   notes.ts     - sticky notes
 *   bpm.ts       - tempo points and base BPM / offset
 *   timeAlign.ts - preserve absolute marker times across tempo changes
 *
 * Import paths stay `stores/project`, so callers need no changes.
 */

export { type ProjectState, useProjectStore } from "./store";
export {
  findBpmPoint,
  findMarker,
  markersInTrack,
  sortedTracks,
} from "./queries";
export {
  addTrack,
  addTypedTrack,
  colorTrack,
  ensureDefaultTrack,
  isTrackBlocked,
  isTrackHidden,
  isTrackLocked,
  isTypedTrackReadOnly,
  markerCount,
  moveTrack,
  removeTrack,
  renameTrack,
  setTrackHidden,
  setTrackLocked,
  visibleMarkers,
} from "./tracks";
export {
  MAX_LOOP_CHILDREN,
  addMarker,
  addMarkerToStore,
  alignMarkersToStep,
  changeMarkerTrack,
  childrenOf,
  groupOf,
  moveMarker,
  quantizeBeat,
  refreshChildren,
  removeMarker,
  removeMarkerAt,
  removeSelectedMarkers,
  resolveMainMarker,
  updateMarkerAttrs,
  updateMarkerLoop,
} from "./markers";
export {
  addNote,
  removeNote,
  setNoteLocked,
  setNoteText,
  updateNote,
} from "./notes";
export {
  addBpmPoint,
  isBpmLocked,
  removeBpmPoint,
  setBaseBpm,
  setBpmLocked,
  setBpmMode,
  setOffset,
  updateBpmPoint,
} from "./bpm";
export { withTimeAlign } from "./timeAlign";
export { BPM_MIN, clampBpm } from "../../tempo";
