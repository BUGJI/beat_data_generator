import { nextColor } from "../../metrics";
import { getTypedef, hasTypedef, localeText } from "../../plugins/registry";
import { pushHistory } from "../../services/history";
import { makeId } from "../../tempo";
import type { Marker, MarkerTrack } from "../../types";
import { clearSelectionIfMissing } from "../selection";
import { useProjectStore } from "./store";

// ---------- tracks ----------

export function addTrack(
  name?: string,
  record = true,
  type?: string,
  color?: string,
): MarkerTrack {
  const p = useProjectStore();
  if (record) pushHistory();
  const track: MarkerTrack = {
    id: makeId(),
    name:
      name?.trim() ||
      (p.tracks.length ? `Track ${p.tracks.length + 1}` : "Marker 1"),
    color: color || nextColor(p.tracks.map((tr) => tr.color)),
  };
  if (type) track.type = type;
  p.tracks.push(track);
  p.dirty = true;
  return track;
}

/** Create a track of a plugin-registered type; null when the type is unknown. */
export function addTypedTrack(typeKey: string, name?: string): string | null {
  const def = getTypedef(typeKey);
  if (!def) return null;
  const track = addTrack(
    name?.trim() || localeText(def.trackName) || typeKey,
    true,
    typeKey,
    def.color,
  );
  return track.id;
}

export function ensureDefaultTrack(): void {
  if (useProjectStore().tracks.length === 0) addTrack(undefined, false);
}

export function removeTrack(trackId: string): void {
  if (isTrackLocked(trackId)) return;
  const p = useProjectStore();
  const i = p.tracks.findIndex((tr) => tr.id === trackId);
  if (i < 0) return;
  pushHistory();
  p.tracks.splice(i, 1);
  p.markers = p.markers.filter((m) => m.trackId !== trackId);
  p.dirty = true;
  clearSelectionIfMissing();
}

export function renameTrack(trackId: string, name: string): void {
  if (isTrackLocked(trackId)) return;
  const p = useProjectStore();
  const tr = p.tracks.find((x) => x.id === trackId);
  if (tr && tr.name !== name) {
    pushHistory();
    tr.name = name;
    p.dirty = true;
  }
}

export function colorTrack(trackId: string, color: string): void {
  if (isTrackLocked(trackId)) return;
  const p = useProjectStore();
  const tr = p.tracks.find((x) => x.id === trackId);
  if (tr && tr.color !== color) {
    pushHistory();
    tr.color = color;
    p.dirty = true;
  }
}

export function moveTrack(trackId: string, dir: -1 | 1): void {
  const p = useProjectStore();
  const i = p.tracks.findIndex((tr) => tr.id === trackId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.tracks.length) return;
  pushHistory();
  const arr = p.tracks;
  [arr[i], arr[j]] = [arr[j] as MarkerTrack, arr[i] as MarkerTrack];
  p.dirty = true;
}

// ---------- track flags (lock / hide) ----------

export const isTrackLocked = (trackId: string): boolean =>
  !!useProjectStore().tracks.find((tr) => tr.id === trackId)?.locked;
export const isTrackHidden = (trackId: string): boolean =>
  !!useProjectStore().tracks.find((tr) => tr.id === trackId)?.hidden;

/** markers on non-hidden tracks (these are the ones playback/export count) */
export const visibleMarkers = (): Marker[] => {
  const p = useProjectStore();
  // one track lookup table instead of scanning the track list per marker
  const byId = new Map(p.tracks.map((t) => [t.id, t]));
  const out: Marker[] = [];
  for (const m of p.markers) {
    const t = byId.get(m.trackId);
    if (t?.hidden) continue;
    if (t?.type && t.type !== "beat") continue;
    out.push(m);
  }
  return out;
};

/** Plugin-typed track whose type plugin is not currently installed. */
export const isTypedTrackReadOnly = (trackId: string): boolean => {
  const t = useProjectStore().tracks.find((x) => x.id === trackId);
  return !!t && !!t.type && t.type !== "beat" && !hasTypedef(t.type);
};

/** Track is off-limits for marker edits (locked or an unknown typed track). */
export const isTrackBlocked = (trackId: string): boolean =>
  isTrackLocked(trackId) || isTypedTrackReadOnly(trackId);

export function setTrackLocked(trackId: string, v: boolean): void {
  const p = useProjectStore();
  const tr = p.tracks.find((x) => x.id === trackId);
  if (!tr || !!tr.locked === v) return;
  pushHistory();
  tr.locked = v;
  p.dirty = true;
}

export function setTrackHidden(trackId: string, v: boolean): void {
  const p = useProjectStore();
  const tr = p.tracks.find((x) => x.id === trackId);
  if (!tr || !!tr.hidden === v) return;
  pushHistory();
  tr.hidden = v;
  p.dirty = true;
}

export const markerCount = (): number =>
  useProjectStore().markers.filter((m) => !isTrackHidden(m.trackId)).length;
