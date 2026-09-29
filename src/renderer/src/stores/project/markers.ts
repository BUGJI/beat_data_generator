import { isFreeInput } from "../../../../shared/limits";
import type { AlignRounding } from "../../../../shared/settings";
import { defaultAttrsFor } from "../../plugins/registry";
import {
  beginEditTransaction,
  endEditTransaction,
  pushHistory,
} from "../../services/history";
import { makeId } from "../../tempo";
import type { Marker } from "../../types";
import { clearSelectionIfMissing, markerSelectionIds } from "../selection";
import { useSettingsStore } from "../settings";
import { clampBeat, round, snapped } from "./helpers";
import { findMarker, markersInTrack } from "./queries";
import { isTrackBlocked, isTrackLocked } from "./tracks";
import { useProjectStore } from "./store";

/** Hard cap on batch-generated resources (loop children) to avoid freezing the
 *  editor on a huge loop count. Enforced at the generator regardless of source. */
export const MAX_LOOP_CHILDREN = 256;

function trackHasBeat(
  trackId: string,
  beat: number,
  exceptId?: string,
  eps = 1 / 128,
): boolean {
  return useProjectStore().markers.some(
    (m) =>
      m.trackId === trackId &&
      m.id !== exceptId &&
      Math.abs(m.beat - beat) < eps,
  );
}

/** Remove every selected main marker (with their loop children). */
export function removeSelectedMarkers(): boolean {
  const ids = markerSelectionIds();
  if (!ids.length) return false;
  const p = useProjectStore();
  let removed = false;
  beginEditTransaction();
  try {
    for (const id of ids) {
      const m = findMarker(id);
      if (m && !isTrackBlocked(m.trackId)) {
        p.markers = p.markers.filter(
          (x) => x.id !== m.id && x.parentId !== m.id,
        );
        removed = true;
      }
    }
  } finally {
    endEditTransaction();
  }
  if (!removed) return false;
  p.dirty = true;
  clearSelectionIfMissing();
  return true;
}

// ---------- markers ----------

export const resolveMainMarker = (
  m: Marker | null | undefined,
): Marker | null => {
  if (!m) return null;
  return m.parentId ? (findMarker(m.parentId) ?? m) : m;
};

export const childrenOf = (mainId: string): Marker[] =>
  useProjectStore().markers.filter((x) => x.parentId === mainId);

export const groupOf = (id: string): Marker[] => {
  const m = findMarker(id);
  const main = resolveMainMarker(m);
  return main ? [main, ...childrenOf(main.id)] : [];
};

function childIndexOf(parent: Marker, child: Marker): number {
  if (!parent.loop || parent.loop.interval <= 0) return -1;
  return Math.round((child.beat - parent.beat) / parent.loop.interval);
}

export function addMarkerToStore(
  trackId: string,
  beat: number,
  extra?: Partial<Marker>,
): Marker | null {
  const p = useProjectStore();
  const track = p.tracks.find((tr) => tr.id === trackId);
  if (!track) return null;
  const marker: Marker = { id: makeId(), trackId, beat, ...extra };
  p.markers.push(marker);
  return marker;
}

export function refreshChildren(parent: Marker): void {
  const p = useProjectStore();
  if (!parent.loop) {
    p.markers = p.markers.filter((x) => x.parentId !== parent.id);
    return;
  }
  // Drop this parent's current children and, in the same pass, collect the
  // beats already occupied on its track (used to avoid overlapping children).
  const used = new Set<number>();
  p.markers = p.markers.filter((x) => {
    if (x.parentId === parent.id) return false;
    if (x.trackId === parent.trackId) used.add(Math.round(x.beat * 1e6));
    return true;
  });
  const cfg = parent.loop;
  if (!isFreeInput() && (!(cfg.interval > 0) || cfg.count < 1)) return;
  const count = isFreeInput()
    ? Math.floor(cfg.count)
    : Math.min(cfg.count, MAX_LOOP_CHILDREN);
  const exclude = new Set(cfg.exclude ?? []);
  for (let k = 1; k <= count; k++) {
    if (exclude.has(k)) continue;
    const beat = parent.beat + k * cfg.interval;
    if (used.has(Math.round(beat * 1e6))) continue;
    addMarkerToStore(parent.trackId, beat, { parentId: parent.id });
    used.add(Math.round(beat * 1e6));
  }
}

export function updateMarkerLoopImpl(
  id: string,
  cfg: { interval: number; count: number; exclude?: number[] } | null,
): void {
  const p = useProjectStore();
  const m = findMarker(id);
  const parent = resolveMainMarker(m);
  if (!parent || isTrackLocked(parent.trackId)) return;
  pushHistory();
  if (!cfg) {
    parent.loop = null;
  } else {
    parent.loop = {
      interval: isFreeInput()
        ? cfg.interval
        : cfg.interval > 0
          ? cfg.interval
          : 1,
      count: isFreeInput()
        ? Math.floor(cfg.count)
        : Math.min(MAX_LOOP_CHILDREN, Math.max(1, Math.floor(cfg.count))),
      ...(Array.isArray(cfg.exclude) && cfg.exclude.length
        ? { exclude: cfg.exclude }
        : {}),
    };
  }
  refreshChildren(parent);
  p.dirty = true;
}

export function addMarkerImpl(trackId: string, rawBeat: number): Marker | null {
  if (isTrackBlocked(trackId)) return null;
  const p = useProjectStore();
  const beat = clampBeat(snapped(rawBeat));
  if (trackHasBeat(trackId, beat)) return null;
  pushHistory();
  const track = p.tracks.find((x) => x.id === trackId);
  const marker = addMarkerToStore(trackId, beat);
  if (!marker) return null;
  if (track?.type && track.type !== "beat") {
    marker.attrs = defaultAttrsFor(track.type);
  }
  p.dirty = true;
  return marker;
}

/** Merge changes into a marker's plugin attributes (undo aware). */
export function updateMarkerAttrsImpl(
  id: string,
  patch: Record<string, unknown>,
): void {
  const m = findMarker(id);
  if (!m || isTrackBlocked(m.trackId)) return;
  pushHistory();
  const cur = m.attrs ? { ...m.attrs } : {};
  m.attrs = { ...cur, ...patch };
  useProjectStore().dirty = true;
}

export function removeMarker(id: string): void {
  const p = useProjectStore();
  const m = findMarker(id);
  if (!m || isTrackBlocked(m.trackId)) return;
  pushHistory();
  if (m.parentId) {
    const parent = findMarker(m.parentId);
    if (parent?.loop) {
      const k = childIndexOf(parent, m);
      if (k >= 1) {
        parent.loop.exclude = [...new Set([...(parent.loop.exclude ?? []), k])];
      }
    }
    const i = p.markers.findIndex((x) => x.id === id);
    if (i >= 0) p.markers.splice(i, 1);
    p.dirty = true;
    clearSelectionIfMissing();
    return;
  }
  // main marker -> cascade delete its children
  p.markers = p.markers.filter((x) => x.id !== m.id && x.parentId !== m.id);
  p.dirty = true;
  clearSelectionIfMissing();
}

export function removeMarkerAtImpl(
  trackId: string,
  beat: number,
  tol: number,
): boolean {
  const hit = markersInTrack(trackId).find(
    (m) => Math.abs(m.beat - beat) <= tol,
  );
  if (hit) {
    removeMarker(hit.id);
    return true;
  }
  return false;
}

export function moveMarkerImpl(
  id: string,
  rawBeat: number,
  force = false,
): boolean {
  const p = useProjectStore();
  const m = findMarker(id);
  if (!m || m.parentId) return false;
  if (isTrackBlocked(m.trackId)) return false;
  const beat = clampBeat(force ? round(rawBeat) : snapped(rawBeat));
  // own group = this marker plus its loop children, so skip both by id/parentId
  // in a single pass (no Set alloc and no separate childrenOf scan per frame).
  const blocked = p.markers.some(
    (x) =>
      x.trackId === m.trackId &&
      x.id !== m.id &&
      x.parentId !== m.id &&
      Math.abs(x.beat - beat) < 1 / 128,
  );
  if (blocked) return false;
  if (m.beat === beat) return true;
  pushHistory();
  m.beat = beat;
  if (m.loop) refreshChildren(m);
  p.dirty = true;
  return true;
}

/** Quantize a beat to a power-of-ten step using one of the rounding modes. */
export function quantizeBeat(
  beat: number,
  decimals: number,
  mode: AlignRounding,
): number {
  const factor = 10 ** decimals;
  const scaled = beat * factor;
  const n =
    mode === "floor"
      ? Math.floor(scaled)
      : mode === "ceil"
        ? Math.ceil(scaled)
        : Math.round(scaled);
  return n / factor;
}

/**
 * Round every editable marker's beat to the configured decimal places using
 * the configured rounding mode, so beats snap to a clean grid. Loop children
 * are rounded in place too; the loop interval is left untouched. Returns the
 * number of markers changed.
 */
export function alignMarkersToStep(
  decimals?: number,
  mode?: AlignRounding,
): number {
  const p = useProjectStore();
  const prefs = useSettingsStore().settings;
  const dec = decimals ?? prefs.alignDecimals;
  const md = mode ?? prefs.alignRounding;
  const roundTo = (b: number): number => quantizeBeat(b, dec, md);
  const changed = p.markers.filter(
    (m) => !isTrackBlocked(m.trackId) && roundTo(m.beat) !== m.beat,
  );
  if (!changed.length) return 0;
  pushHistory();
  for (const m of changed) m.beat = Math.max(0, roundTo(m.beat));
  p.dirty = true;
  return changed.length;
}

export function changeMarkerTrack(id: string, trackId: string): boolean {
  const p = useProjectStore();
  const m = findMarker(id);
  const parent = resolveMainMarker(m);
  if (!parent) return false;
  if (isTrackBlocked(parent.trackId) || isTrackBlocked(trackId)) return false;
  const others = p.markers.filter(
    (x) =>
      x.trackId === trackId && x.id !== parent.id && x.parentId !== parent.id,
  );
  if (others.some((x) => Math.abs(x.beat - parent.beat) < 1 / 128))
    return false;
  const oldType = p.tracks.find((t) => t.id === parent.trackId)?.type;
  const newType = p.tracks.find((t) => t.id === trackId)?.type;
  pushHistory();
  parent.trackId = trackId;
  if (parent.loop) refreshChildren(parent);
  if (newType !== oldType) {
    if (newType && newType !== "beat") parent.attrs = defaultAttrsFor(newType);
    else delete parent.attrs;
  }
  p.dirty = true;
  return true;
}

// ---- public function API (route through the Pinia actions) ---------------

export function updateMarkerLoop(
  id: string,
  cfg: { interval: number; count: number; exclude?: number[] } | null,
): void {
  useProjectStore().updateMarkerLoop(id, cfg);
}

export function updateMarkerAttrs(
  id: string,
  patch: Record<string, unknown>,
): void {
  useProjectStore().updateMarkerAttrs(id, patch);
}

export function addMarker(trackId: string, rawBeat: number): Marker | null {
  return useProjectStore().addMarker(trackId, rawBeat);
}

export function removeMarkerAt(
  trackId: string,
  beat: number,
  tol: number,
): boolean {
  return useProjectStore().removeMarkerAt(trackId, beat, tol);
}

export function moveMarker(
  id: string,
  rawBeat: number,
  force = false,
): boolean {
  return useProjectStore().moveMarker(id, rawBeat, force);
}
