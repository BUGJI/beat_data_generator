import { defineStore } from "pinia";
import { ref } from "vue";
import { snapBeat, makeId, clampBpm, BPM_MAX, BPM_MIN } from "../tempo";
import { nextColor } from "../metrics";
import {
  getTypedef,
  defaultAttrsFor,
  hasTypedef,
  localeText,
} from "../plugins/registry";
import { useViewStore } from "./view";
import { useUiStore } from "./ui";
import { useSettingsStore } from "./settings";
import type { AlignRounding } from "../../../shared/settings";
import {
  clearSelectionIfMissing,
  markerSelectionIds,
  select,
} from "./selection";
import { pushHistory } from "../services/history";
import {
  bpmAtBeat,
  effectiveBpmFor,
  tempoMap,
} from "../services/timeline";
import type {
  BpmMode,
  BpmPoint,
  LoopConfig,
  Marker,
  MarkerTrack,
  ProjectNote,
} from "../types";

/** Hard cap on batch-generated resources (loop children) to avoid freezing the
 *  editor on a huge loop count. Enforced at the generator regardless of source. */
export const MAX_LOOP_CHILDREN = 256;

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

/**
 * The persisted project document: tempo, tracks, markers, bpm points and notes.
 * This is the single source of truth for everything that is saved to disk.
 */
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
    // ---- high-frequency mutations exposed as Pinia actions ----
    moveMarker: moveMarkerImpl,
    addMarker: addMarkerImpl,
    removeMarkerAt: removeMarkerAtImpl,
    updateMarkerLoop: updateMarkerLoopImpl,
    updateBpmPoint: updateBpmPointImpl,
    updateNote: updateNoteImpl,
    setBaseBpm: setBaseBpmImpl,
    setOffset: setOffsetImpl,
  };
});

const round = (b: number): number => Math.round(b * 1e6) / 1e6;

export const sortedTracks = (): MarkerTrack[] => useProjectStore().tracks;

export const markersInTrack = (trackId: string): Marker[] =>
  useProjectStore()
    .markers.filter((m) => m.trackId === trackId)
    .sort((a, b) => a.beat - b.beat);

export const findMarker = (id: string): Marker | undefined =>
  useProjectStore().markers.find((m) => m.id === id);

export const findBpmPoint = (id: string): BpmPoint | undefined =>
  useProjectStore().bpmPoints.find((p) => p.id === id);

export const markerCount = (): number =>
  useProjectStore().markers.filter((m) => !isTrackHidden(m.trackId)).length;

function snapped(b: number): number {
  const view = useViewStore();
  return view.snapEnabled ? snapBeat(b, view.snapDiv) : round(b);
}

// `timeAlign` keeps markers pinned to their absolute time when the tempo map
// (base BPM / offset / tempo points) changes. It does so by rewriting each
// marker's beat against the new map, so beats always describe the current tempo
// map — saving, reloading and exporting therefore always match what is on
// screen. (The old implementation kept session-only anchors and only rewrote
// beats on toggle-off, which desynced from the saved file and mixed markers
// that were anchored under different tempo maps.)

/** Snapshot the absolute times of every marker and the ms-length of every loop
 *  interval; the returned function rewrites beats/intervals against the
 *  (possibly changed) tempo map so those absolute times are preserved. */
function captureTimePositions(): () => void {
  const before = tempoMap();
  const p = useProjectStore();
  const markerTimes = p.markers
    .filter((m) => !m.parentId)
    .map((m) => ({ id: m.id, timeMs: before.timeOfBeat(m.beat) }));
  const loopSpans = p.markers
    .filter((m) => !!m.loop)
    .map((m) => {
      const loop = m.loop as LoopConfig;
      return {
        id: m.id,
        spanMs: loop.interval * (60_000 / before.bpmAtBeat(m.beat)),
      };
    });
  return () => {
    const after = tempoMap();
    for (const it of markerTimes) {
      const m = findMarker(it.id);
      if (m) m.beat = Math.max(0, after.beatOfTime(it.timeMs));
    }
    for (const it of loopSpans) {
      const m = findMarker(it.id);
      if (m?.loop)
        m.loop.interval = Math.max(
          1e-4,
          it.spanMs / (60_000 / after.bpmAtBeat(m.beat)),
        );
    }
    for (const m of useProjectStore().markers.filter(
      (x) => x.loop && !x.parentId,
    ))
      refreshChildren(m);
  };
}

/** Run a tempo-map mutation; while `timeAlign` is on, marker absolute positions
 *  are preserved by rewriting their beats afterward. */
export function withTimeAlign<T>(mutate: () => T): T {
  const restore = useUiStore().timeAlign ? captureTimePositions() : null;
  const result = mutate();
  if (restore) restore();
  return result;
}

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
  pushHistory();
  let removed = false;
  for (const id of ids) {
    const m = findMarker(id);
    if (m && !isTrackBlocked(m.trackId)) {
      p.markers = p.markers.filter(
        (x) => x.id !== m.id && x.parentId !== m.id,
      );
      removed = true;
    }
  }
  if (!removed) return false;
  p.dirty = true;
  clearSelectionIfMissing();
  return true;
}

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
      (p.tracks.length
        ? `Track ${p.tracks.length + 1}`
        : "Marker 1"),
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
  if (tr) {
    pushHistory();
    tr.name = name;
    p.dirty = true;
  }
}

export function colorTrack(trackId: string, color: string): void {
  if (isTrackLocked(trackId)) return;
  const p = useProjectStore();
  const tr = p.tracks.find((x) => x.id === trackId);
  if (tr) {
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
export const visibleMarkers = (): Marker[] =>
  useProjectStore().markers.filter((m) => {
    if (isTrackHidden(m.trackId)) return false;
    const t = useProjectStore().tracks.find((x) => x.id === m.trackId);
    if (t?.type && t.type !== "beat") return false;
    return true;
  });

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
  if (!tr) return;
  pushHistory();
  tr.locked = v;
  p.dirty = true;
}

export function setTrackHidden(trackId: string, v: boolean): void {
  const p = useProjectStore();
  const tr = p.tracks.find((x) => x.id === trackId);
  if (!tr) return;
  pushHistory();
  tr.hidden = v;
  p.dirty = true;
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
  // drop current children of this parent
  p.markers = p.markers.filter((x) => x.parentId !== parent.id);
  const cfg = parent.loop;
  if (!(cfg.interval > 0) || cfg.count < 1) return;
  const count = Math.min(cfg.count, MAX_LOOP_CHILDREN);
  const exclude = new Set(cfg.exclude ?? []);
  const used = new Set<number>();
  for (const m of p.markers) {
    if (m.trackId === parent.trackId) used.add(Math.round(m.beat * 1e6));
  }
  for (let k = 1; k <= count; k++) {
    if (exclude.has(k)) continue;
    const beat = parent.beat + k * cfg.interval;
    if (used.has(Math.round(beat * 1e6))) continue;
    addMarkerToStore(parent.trackId, beat, { parentId: parent.id });
    used.add(Math.round(beat * 1e6));
  }
}

function updateMarkerLoopImpl(
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
      interval: cfg.interval > 0 ? cfg.interval : 1,
      count: Math.min(
        MAX_LOOP_CHILDREN,
        Math.max(1, Math.floor(cfg.count)),
      ),
      ...(Array.isArray(cfg.exclude) && cfg.exclude.length
        ? { exclude: cfg.exclude }
        : {}),
    };
  }
  refreshChildren(parent);
  p.dirty = true;
}

function addMarkerImpl(trackId: string, rawBeat: number): Marker | null {
  if (isTrackBlocked(trackId)) return null;
  const p = useProjectStore();
  const beat = Math.max(0, snapped(rawBeat));
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
export function updateMarkerAttrs(
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
    if (parent && parent.loop) {
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

function removeMarkerAtImpl(
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

function moveMarkerImpl(
  id: string,
  rawBeat: number,
  force = false,
): boolean {
  const p = useProjectStore();
  const m = findMarker(id);
  if (!m || m.parentId) return false;
  if (isTrackBlocked(m.trackId)) return false;
  const beat = Math.max(0, force ? round(rawBeat) : snapped(rawBeat));
  const ownGroup = new Set([m.id, ...childrenOf(m.id).map((c) => c.id)]);
  const blocked = p.markers.some(
    (x) =>
      x.trackId === m.trackId &&
      !ownGroup.has(x.id) &&
      Math.abs(x.beat - beat) < 1 / 128,
  );
  if (blocked) return false;
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

// ---------- sticky notes ----------

export function addNote(opts: {
  timeMs: number;
  y: number;
  text?: string;
}): ProjectNote {
  const note: ProjectNote = {
    id: makeId(),
    timeMs: Math.max(0, opts.timeMs),
    y: Math.max(0, opts.y),
    text:
      opts.text ??
      (document.documentElement.lang !== "en"
        ? "**注意** 双击编辑，拖动定位"
        : "**Note** double-click to edit, drag to move"),
    locked: false,
  };
  pushHistory();
  const p = useProjectStore();
  p.notes.push(note);
  p.dirty = true;
  return note;
}

function updateNoteImpl(
  id: string,
  patch: { timeMs?: number; y?: number },
): boolean {
  const p = useProjectStore();
  const n = p.notes.find((x) => x.id === id);
  if (!n || n.locked) return false;
  pushHistory();
  if (patch.timeMs !== undefined) n.timeMs = Math.max(0, patch.timeMs);
  // Notes float freely; no alignment to tracks/lanes. A generous soft bound
  // keeps them usable without ever clamping onto a lane edge (which made the
  // note look "stuck" to the cursor at a boundary).
  if (patch.y !== undefined) n.y = Math.max(0, Math.min(20000, patch.y));
  p.dirty = true;
  return true;
}

export function removeNote(id: string): void {
  const p = useProjectStore();
  const i = p.notes.findIndex((x) => x.id === id);
  if (i < 0) return;
  pushHistory();
  p.notes.splice(i, 1);
  p.dirty = true;
}

export function setNoteLocked(id: string, locked: boolean): void {
  const p = useProjectStore();
  const n = p.notes.find((x) => x.id === id);
  if (!n || n.locked === locked) return;
  pushHistory();
  n.locked = locked;
  p.dirty = true;
}

export function setNoteText(id: string, text: string): void {
  const p = useProjectStore();
  const n = p.notes.find((x) => x.id === id);
  if (!n || n.locked) return;
  if (n.text === text) return;
  pushHistory();
  n.text = text;
  p.dirty = true;
}

// ---------- bpm points ----------

export const isBpmLocked = (): boolean => useProjectStore().bpmLocked === true;

export function setBpmLocked(v: boolean): void {
  const p = useProjectStore();
  if (p.bpmLocked === v) return;
  pushHistory();
  p.bpmLocked = v;
  p.dirty = true;
}

function pointHasBeat(beat: number, exceptId?: string): boolean {
  return useProjectStore().bpmPoints.some(
    (p) => p.id !== exceptId && Math.abs(p.beat - Math.max(0, beat)) < 1e-6,
  );
}

export function addBpmPoint(
  rawBeat: number,
  mode: BpmMode = "abs",
  value?: number,
): BpmPoint | null {
  const p = useProjectStore();
  const beat = Math.max(0, snapped(rawBeat));
  const existing = p.bpmPoints.find(
    (pt) => Math.abs(pt.beat - beat) < 1e-6,
  );
  if (isBpmLocked()) {
    if (existing) {
      select("bpm", existing.id);
      return existing;
    }
    return null;
  }
  if (existing) {
    select("bpm", existing.id);
    return existing;
  }
  const inheritBpm = bpmAtBeat(beat);
  pushHistory();
  const point: BpmPoint = {
    id: makeId(),
    beat,
    mode,
    value: value ?? clampBpm(inheritBpm),
  };
  withTimeAlign(() => {
    p.bpmPoints.push(point);
  });
  p.dirty = true;
  select("bpm", point.id);
  return point;
}

function updateBpmPointImpl(
  id: string,
  patch: Partial<Pick<BpmPoint, "beat" | "mode" | "value">>,
): void {
  const p = useProjectStore();
  const pt = findBpmPoint(id);
  if (!pt || isBpmLocked()) return;
  const beat =
    patch.beat !== undefined ? Math.max(0, snapped(patch.beat)) : undefined;
  if (beat !== undefined && pointHasBeat(beat, id)) return;
  pushHistory();
  withTimeAlign(() => {
    if (beat !== undefined) pt.beat = beat;
    if (patch.mode !== undefined && patch.mode !== pt.mode) {
      const eff = effectiveBpmFor(pt);
      if (patch.mode === "mult") {
        const prev = bpmAtBeat(Math.max(0, pt.beat - 1e-4));
        pt.mode = "mult";
        pt.value = prev > 0 ? round(eff / prev) : 1;
      } else {
        pt.mode = "abs";
        pt.value = clampBpm(eff);
      }
    }
    if (patch.value !== undefined) {
      const v = Number(patch.value) || 0;
      pt.value =
        pt.mode === "mult" ? Math.min(100, Math.max(0.01, v)) : clampBpm(v);
    }
  });
  p.dirty = true;
}

export function setBpmMode(id: string, mode: BpmMode): void {
  const pt = findBpmPoint(id);
  if (!pt || pt.mode === mode) return;
  updateBpmPoint(id, { mode });
}

export function removeBpmPoint(id: string): void {
  if (isBpmLocked()) return;
  const p = useProjectStore();
  const i = p.bpmPoints.findIndex((pt) => pt.id === id);
  if (i >= 0) {
    pushHistory();
    withTimeAlign(() => {
      p.bpmPoints.splice(i, 1);
    });
    p.dirty = true;
    clearSelectionIfMissing();
  }
}

// ---------- base bpm / offset recorded edits ----------

function setBaseBpmImpl(v: number): void {
  const p = useProjectStore();
  const next = clampBpm(v);
  if (next === p.baseBpm) return;
  pushHistory();
  withTimeAlign(() => {
    p.baseBpm = next;
  });
  p.dirty = true;
}

function setOffsetImpl(v: number): void {
  const p = useProjectStore();
  const next = Math.round(v);
  if (next === p.offsetMs) return;
  pushHistory();
  withTimeAlign(() => {
    p.offsetMs = next;
  });
  p.dirty = true;
}

// ---- public function API -------------------------------------------------
// These delegators route call sites through the Pinia actions above so that
// Vue DevTools records them as named mutations (time-travel + action log).

export function updateMarkerLoop(
  id: string,
  cfg: { interval: number; count: number; exclude?: number[] } | null,
): void {
  useProjectStore().updateMarkerLoop(id, cfg);
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

export function updateNote(
  id: string,
  patch: { timeMs?: number; y?: number },
): boolean {
  return useProjectStore().updateNote(id, patch);
}

export function updateBpmPoint(
  id: string,
  patch: Partial<Pick<BpmPoint, "beat" | "mode" | "value">>,
): void {
  useProjectStore().updateBpmPoint(id, patch);
}

export function setBaseBpm(v: number): void {
  useProjectStore().setBaseBpm(v);
}

export function setOffset(v: number): void {
  useProjectStore().setOffset(v);
}

export { clampBpm, BPM_MAX, BPM_MIN };
