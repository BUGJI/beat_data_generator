import { reactive } from "vue";
import { ElMessage } from "element-plus";
import { i18n } from "./i18n";
import { engine, computePeaks } from "./engine";
import { stretchAudioBuffer } from "./stretch";
import {
  buildTempoMap,
  snapBeat,
  makeId,
  clampBpm,
  BPM_MAX,
  BPM_MIN,
} from "./tempo";
import {
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  DEFAULT_DIV,
  nextColor,
} from "./metrics";
import type {
  SettingsData,
  TextFileResult,
  WelcomeAction,
} from "../../shared/ipc";
import type {
  AudioFileResultLike,
  BeatProject,
  BpmMode,
  BpmPoint,
  Marker,
  MarkerTrack,
  Segment,
  WaveData,
} from "./types";
import {
  hasTypedef,
  defaultAttrsFor,
  getTypedef,
  localeText,
} from "./plugins/registry";
import { view } from "./editorView";

interface ProjectState extends BeatProject {
  projectPath: string | null;
  dirty: boolean;
  /** transient only: absolute path of the loaded audio for this session; never persisted */
  audioPath: string | null;
}

interface Selection {
  kind: "marker" | "bpm" | null;
  id: string | null;
}

interface UIState {
  playing: boolean;
  positionMs: number;
  volume: number;
  hasAudio: boolean;
  wave: WaveData | null;
  audioMissing: boolean;
  audioConflict: boolean;
  snapEnabled: boolean;
  snapDiv: number;
  pxPerSec: number;
  rate: number;
  pitchFollow: boolean;
  buffering: boolean;
  settingsOpen: boolean;
  settings: SettingsData;
  followManual: boolean;
  followActive: boolean;
  followLocked: boolean;
  selected: Selection;
  multi: string[];
  cardOpen: boolean;
  beatPulse: number;
  overlapPulse: number;
  overlapCount: number;
  /** master switch for per-track lane/header glow on marker pass. */
  glowEnabled: boolean;
  /** per-track pulse sequence used to re-trigger 0.1s glow effects. */
  glowSeqs: Record<string, number>;
  /** quick draw/erase mode: press-drag places/deletes markers under the cursor. */
  quickPlace: boolean;
}

export const store = reactive<{ project: ProjectState; ui: UIState }>({
  project: {
    app: "beat-data-generator",
    version: 2,
    name: "",
    baseBpm: 120,
    offsetMs: 0,
    audioPath: null,
    audioName: null,
    audioMd5: null,
    bpmLocked: false,
    tracks: [],
    markers: [],
    bpmPoints: [],
    projectPath: null,
    dirty: false,
  },
  ui: {
    playing: false,
    positionMs: 0,
    volume: 0.85,
    hasAudio: false,
    wave: null,
    audioMissing: false,
    audioConflict: false,
    snapEnabled: true,
    snapDiv: DEFAULT_DIV,
    pxPerSec: 90,
    rate: 1,
    pitchFollow: true,
    buffering: false,
    settingsOpen: false,
    settings: {
      closeMode: "ask",
      devEnabled: false,
      devFreeInput: false,
      animEnabled: true,
      followScroll: true,
      followPercent: 90,
      followPreset: false,
      rememberWindow: true,
      autoSave: true,
      autoSaveMinutes: 5,
    },
    followManual: false,
    followActive: false,
    followLocked: false,
    selected: { kind: null, id: null },
    multi: [],
    cardOpen: false,
    beatPulse: 0,
    overlapPulse: 0,
    overlapCount: 0,
    glowEnabled: false,
    glowSeqs: {},
    quickPlace: false,
  },
});

engine.onTick = () => {
  store.ui.positionMs = engine.positionMs();
  const dur = engine.durationMs();
  if (dur > 0 && store.ui.positionMs >= dur - 1 && !store.ui.buffering) {
    store.ui.playing = false;
  }
  tickBeatFlash();
};
engine.setVolume(store.ui.volume);

// ---- beat indicators: fire once per distinct marker time crossed while playing.
// A single marker -> beat light; two or more coincident markers -> overlap light
// whose colour encodes how many markers share that instant. ----

interface FlashEvent {
  t: number;
  n: number;
  ids: string[];
}

let flashEvents: FlashEvent[] = [];
let flashIdx = 0;
let flashReady = false;

function firstEventAtOrAfter(arr: FlashEvent[], pos: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((arr[mid] as FlashEvent).t < pos) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function refreshBeatFlash(posMs: number): void {
  // refreshed on play/seek/stop events (not per-frame), so recompute freely
  const groups = new Map<
    string,
    { beat: number; count: number; ids: string[] }
  >();
  for (const m of visibleMarkers()) {
    const key = `${Math.round(m.beat * 1e6)}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      if (!g.ids.includes(m.trackId)) g.ids.push(m.trackId);
    } else {
      groups.set(key, { beat: m.beat, count: 1, ids: [m.trackId] });
    }
  }
  flashEvents = [...groups.values()]
    .map((g) => ({ t: timeOfBeat(g.beat), n: g.count, ids: g.ids }))
    .sort((a, b) => a.t - b.t);
  flashIdx = firstEventAtOrAfter(flashEvents, posMs);
  flashReady = flashIdx < flashEvents.length;
}

function tickBeatFlash(): void {
  if (!store.ui.playing || !flashReady) return;
  const pos = store.ui.positionMs;
  while (
    flashIdx < flashEvents.length &&
    pos >= (flashEvents[flashIdx] as FlashEvent).t
  ) {
    const ev = flashEvents[flashIdx] as FlashEvent;
    flashIdx++;
    store.ui.beatPulse++;
    if (ev.n >= 2) {
      store.ui.overlapPulse++;
      store.ui.overlapCount = ev.n;
    }
    if (store.ui.glowEnabled) {
      for (const id of ev.ids) {
        store.ui.glowSeqs[id] = (store.ui.glowSeqs[id] ?? 0) + 1;
      }
    }
  }
  if (flashIdx >= flashEvents.length) flashReady = false;
}

ensureDefaultTrack();

const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.global.t(key, params ?? {});

export const tempoMap = (): ReturnType<typeof buildTempoMap> =>
  buildTempoMap(
    store.project.baseBpm,
    store.project.offsetMs,
    store.project.bpmPoints,
  );

export const bpmAtBeat = (beat: number): number => tempoMap().bpmAtBeat(beat);
export const bpmAtTime = (ms: number): number => tempoMap().bpmAtTime(ms);
export const timeOfBeat = (beat: number): number => tempoMap().timeOfBeat(beat);
export const beatOfTime = (ms: number): number => tempoMap().beatOfTime(ms);
export const tempoSegments = (): Segment[] => tempoMap().segments;

export const sortedTracks = (): MarkerTrack[] => store.project.tracks;

export const markersInTrack = (trackId: string): Marker[] =>
  store.project.markers
    .filter((m) => m.trackId === trackId)
    .sort((a, b) => a.beat - b.beat);

export const findMarker = (id: string): Marker | undefined =>
  store.project.markers.find((m) => m.id === id);

export const findBpmPoint = (id: string): BpmPoint | undefined =>
  store.project.bpmPoints.find((p) => p.id === id);

export const markerTime = (m: Marker): number => timeOfBeat(m.beat);
export const markerCount = (): number =>
  store.project.markers.filter((m) => !isTrackHidden(m.trackId)).length;

const round = (b: number): number => Math.round(b * 1e6) / 1e6;

function snapped(b: number): number {
  return store.ui.snapEnabled ? snapBeat(b, store.ui.snapDiv) : round(b);
}

function trackHasBeat(
  trackId: string,
  beat: number,
  exceptId?: string,
  eps = 1 / 128,
): boolean {
  return store.project.markers.some(
    (m) =>
      m.trackId === trackId &&
      m.id !== exceptId &&
      Math.abs(m.beat - beat) < eps,
  );
}

function clearSelectionIfMissing(): void {
  const sel = store.ui.selected;
  if (sel.kind === "marker" && !findMarker(sel.id!))
    store.ui.selected = { kind: null, id: null };
  else if (sel.kind === "bpm" && !findBpmPoint(sel.id!))
    store.ui.selected = { kind: null, id: null };
  if (store.ui.multi.length) {
    store.ui.multi = store.ui.multi.filter(
      (id) => !!findMarker(id) && !findMarker(id)!.parentId,
    );
  }
}

export function select(kind: "marker" | "bpm" | null, id: string | null): void {
  store.ui.selected = { kind, id };
}

// ---- marker selection (single via click, multi via ctrl/meta+click) ----

/** Main-marker ids currently selected: the active one plus the multi list. */
export function markerSelectionIds(): string[] {
  const out: string[] = [];
  if (store.ui.selected.kind === "marker" && store.ui.selected.id)
    out.push(store.ui.selected.id);
  for (const id of store.ui.multi) if (!out.includes(id)) out.push(id);
  return out;
}

/** Plain click: keep a single marker selected (its loop group). */
export function selectSingleMarker(id: string): void {
  const main = resolveMainMarker(findMarker(id));
  if (!main) return;
  store.ui.selected = { kind: "marker", id: main.id };
  store.ui.multi = [];
}

/** ctrl/meta+click: add/remove a marker (its loop group) from the selection. */
export function toggleMarkerSelect(id: string): void {
  const main = resolveMainMarker(findMarker(id));
  if (!main) return;
  const mid = main.id;
  const list = markerSelectionIds();
  const had = list.includes(mid);
  const next = had ? list.filter((x) => x !== mid) : [...list, mid];
  if (!next.length) {
    store.ui.selected = { kind: null, id: null };
    store.ui.multi = [];
    return;
  }
  const active = next.includes(mid) ? mid : (next[next.length - 1] as string);
  store.ui.selected = { kind: "marker", id: active };
  store.ui.multi = next.filter((x) => x !== active);
}

/** Select every main marker (loop parents) across the project. */
export function selectAllMarkers(): boolean {
  const mains = store.project.markers.filter((m) => !m.parentId);
  if (!mains.length) {
    closeCard();
    return false;
  }
  store.ui.selected = { kind: "marker", id: mains[0].id };
  store.ui.multi = mains.slice(1).map((m) => m.id);
  store.ui.cardOpen = false;
  return true;
}

/** Clear selection and dismiss the floating property card. */
export function closeCard(): void {
  store.ui.selected = { kind: null, id: null };
  store.ui.multi = [];
  store.ui.cardOpen = false;
}

/** Remove every selected main marker (with their loop children). */
export function removeSelectedMarkers(): boolean {
  const ids = markerSelectionIds();
  if (!ids.length) return false;
  pushHistory();
  let removed = false;
  for (const id of ids) {
    const m = findMarker(id);
    if (m && !isTrackBlocked(m.trackId)) {
      store.project.markers = store.project.markers.filter(
        (x) => x.id !== m.id && x.parentId !== m.id,
      );
      removed = true;
    }
  }
  if (!removed) return false;
  store.project.dirty = true;
  store.ui.selected = { kind: null, id: null };
  store.ui.multi = [];
  store.ui.cardOpen = false;
  return true;
}

// ---------- tracks ----------

export function addTrack(
  name?: string,
  record = true,
  type?: string,
  color?: string,
): MarkerTrack {
  if (record) pushHistory();
  const track: MarkerTrack = {
    id: makeId(),
    name:
      name?.trim() ||
      (store.project.tracks.length
        ? `Track ${store.project.tracks.length + 1}`
        : "Marker 1"),
    color: color || nextColor(store.project.tracks.map((tr) => tr.color)),
  };
  if (type) track.type = type;
  store.project.tracks.push(track);
  store.project.dirty = true;
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
  if (store.project.tracks.length === 0) addTrack(undefined, false);
}

export function removeTrack(trackId: string): void {
  if (isTrackLocked(trackId)) return;
  const i = store.project.tracks.findIndex((tr) => tr.id === trackId);
  if (i < 0) return;
  pushHistory();
  store.project.tracks.splice(i, 1);
  store.project.markers = store.project.markers.filter(
    (m) => m.trackId !== trackId,
  );
  store.project.dirty = true;
  clearSelectionIfMissing();
}

export function renameTrack(trackId: string, name: string): void {
  if (isTrackLocked(trackId)) return;
  const tr = store.project.tracks.find((x) => x.id === trackId);
  if (tr) {
    pushHistory();
    tr.name = name;
    store.project.dirty = true;
  }
}

export function colorTrack(trackId: string, color: string): void {
  if (isTrackLocked(trackId)) return;
  const tr = store.project.tracks.find((x) => x.id === trackId);
  if (tr) {
    pushHistory();
    tr.color = color;
    store.project.dirty = true;
  }
}

export function moveTrack(trackId: string, dir: -1 | 1): void {
  const i = store.project.tracks.findIndex((tr) => tr.id === trackId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= store.project.tracks.length) return;
  pushHistory();
  const arr = store.project.tracks;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  store.project.dirty = true;
}

// ---------- track flags (lock / hide) ----------

export const isTrackLocked = (trackId: string): boolean =>
  !!store.project.tracks.find((tr) => tr.id === trackId)?.locked;
export const isTrackHidden = (trackId: string): boolean =>
  !!store.project.tracks.find((tr) => tr.id === trackId)?.hidden;

/** markers on non-hidden tracks (these are the ones playback/export count) */
export const visibleMarkers = (): Marker[] =>
  store.project.markers.filter((m) => {
    if (isTrackHidden(m.trackId)) return false;
    const t = store.project.tracks.find((x) => x.id === m.trackId);
    if (t?.type && t.type !== "beat") return false;
    return true;
  });

/** Plugin-typed track whose type plugin is not currently installed. */
export const isTypedTrackReadOnly = (trackId: string): boolean => {
  const t = store.project.tracks.find((x) => x.id === trackId);
  return !!t && !!t.type && t.type !== "beat" && !hasTypedef(t.type);
};

/** Track is off-limits for marker edits (locked or an unknown typed track). */
export const isTrackBlocked = (trackId: string): boolean =>
  isTrackLocked(trackId) || isTypedTrackReadOnly(trackId);

export function setTrackLocked(trackId: string, v: boolean): void {
  const tr = store.project.tracks.find((x) => x.id === trackId);
  if (!tr) return;
  pushHistory();
  tr.locked = v;
  store.project.dirty = true;
}

export function setTrackHidden(trackId: string, v: boolean): void {
  const tr = store.project.tracks.find((x) => x.id === trackId);
  if (!tr) return;
  pushHistory();
  tr.hidden = v;
  store.project.dirty = true;
}

// ---------- markers ----------

export const resolveMainMarker = (
  m: Marker | null | undefined,
): Marker | null => {
  if (!m) return null;
  return m.parentId ? (findMarker(m.parentId) ?? m) : m;
};

export const childrenOf = (mainId: string): Marker[] =>
  store.project.markers.filter((x) => x.parentId === mainId);

export const groupOf = (id: string): Marker[] => {
  const m = findMarker(id);
  const main = resolveMainMarker(m);
  return main ? [main, ...childrenOf(main.id)] : [];
};

function childIndexOf(parent: Marker, child: Marker): number {
  if (!parent.loop || parent.loop.interval <= 0) return -1;
  return Math.round((child.beat - parent.beat) / parent.loop.interval);
}

function addMarkerToStore(
  trackId: string,
  beat: number,
  extra?: Partial<Marker>,
): Marker | null {
  const track = store.project.tracks.find((tr) => tr.id === trackId);
  if (!track) return null;
  const marker: Marker = { id: makeId(), trackId, beat, ...extra };
  store.project.markers.push(marker);
  return marker;
}

export function refreshChildren(parent: Marker): void {
  if (!parent.loop) {
    store.project.markers = store.project.markers.filter(
      (x) => x.parentId !== parent.id,
    );
    return;
  }
  // drop current children of this parent
  store.project.markers = store.project.markers.filter(
    (x) => x.parentId !== parent.id,
  );
  const cfg = parent.loop;
  if (!(cfg.interval > 0) || cfg.count < 1) return;
  const exclude = new Set(cfg.exclude ?? []);
  const used = new Set<number>();
  for (const m of store.project.markers) {
    if (m.trackId === parent.trackId) used.add(Math.round(m.beat * 1e6));
  }
  for (let k = 1; k <= cfg.count; k++) {
    if (exclude.has(k)) continue;
    const beat = parent.beat + k * cfg.interval;
    if (used.has(Math.round(beat * 1e6))) continue;
    addMarkerToStore(parent.trackId, beat, { parentId: parent.id });
    used.add(Math.round(beat * 1e6));
  }
}

export function updateMarkerLoop(
  id: string,
  cfg: { interval: number; count: number; exclude?: number[] } | null,
): void {
  const m = findMarker(id);
  const parent = resolveMainMarker(m);
  if (!parent || isTrackLocked(parent.trackId)) return;
  pushHistory();
  if (!cfg) {
    parent.loop = null;
  } else {
    parent.loop = {
      interval: cfg.interval > 0 ? cfg.interval : 1,
      count: Math.max(1, Math.floor(cfg.count)),
      ...(Array.isArray(cfg.exclude) && cfg.exclude.length
        ? { exclude: cfg.exclude }
        : {}),
    };
  }
  refreshChildren(parent);
  store.project.dirty = true;
}

export function addMarker(trackId: string, rawBeat: number): Marker | null {
  if (isTrackBlocked(trackId)) return null;
  const beat = Math.max(0, snapped(rawBeat));
  if (trackHasBeat(trackId, beat)) return null;
  pushHistory();
  const track = store.project.tracks.find((x) => x.id === trackId);
  const marker = addMarkerToStore(trackId, beat);
  if (!marker) return null;
  if (track?.type && track.type !== "beat") {
    marker.attrs = defaultAttrsFor(track.type);
  }
  store.ui.selected = { kind: "marker", id: marker.id };
  store.project.dirty = true;
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
  store.project.dirty = true;
}

export function removeMarker(id: string): void {
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
    const i = store.project.markers.findIndex((x) => x.id === id);
    if (i >= 0) store.project.markers.splice(i, 1);
    store.project.dirty = true;
    clearSelectionIfMissing();
    return;
  }
  // main marker -> cascade delete its children
  store.project.markers = store.project.markers.filter(
    (x) => x.id !== m.id && x.parentId !== m.id,
  );
  store.project.dirty = true;
  clearSelectionIfMissing();
}

export function removeMarkerAt(
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

export function moveMarker(
  id: string,
  rawBeat: number,
  force = false,
): boolean {
  const m = findMarker(id);
  if (!m || m.parentId) return false;
  if (isTrackBlocked(m.trackId)) return false;
  const beat = Math.max(0, force ? round(rawBeat) : snapped(rawBeat));
  const ownGroup = new Set([m.id, ...childrenOf(m.id).map((c) => c.id)]);
  const blocked = store.project.markers.some(
    (x) =>
      x.trackId === m.trackId &&
      !ownGroup.has(x.id) &&
      Math.abs(x.beat - beat) < 1 / 128,
  );
  if (blocked) return false;
  pushHistory();
  m.beat = beat;
  if (m.loop) refreshChildren(m);
  store.project.dirty = true;
  return true;
}

export function changeMarkerTrack(id: string, trackId: string): boolean {
  const m = findMarker(id);
  const parent = resolveMainMarker(m);
  if (!parent) return false;
  if (isTrackBlocked(parent.trackId) || isTrackBlocked(trackId)) return false;
  const others = store.project.markers.filter(
    (x) =>
      x.trackId === trackId && x.id !== parent.id && x.parentId !== parent.id,
  );
  if (others.some((x) => Math.abs(x.beat - parent.beat) < 1 / 128))
    return false;
  const oldType = store.project.tracks.find(
    (t) => t.id === parent.trackId,
  )?.type;
  const newType = store.project.tracks.find((t) => t.id === trackId)?.type;
  pushHistory();
  parent.trackId = trackId;
  if (parent.loop) refreshChildren(parent);
  if (newType !== oldType) {
    if (newType && newType !== "beat") parent.attrs = defaultAttrsFor(newType);
    else delete parent.attrs;
  }
  store.project.dirty = true;
  return true;
}

// ---------- bpm points ----------

export const isBpmLocked = (): boolean => store.project.bpmLocked === true;

export function setBpmLocked(v: boolean): void {
  if (store.project.bpmLocked === v) return;
  pushHistory();
  store.project.bpmLocked = v;
  store.project.dirty = true;
}

function pointHasBeat(beat: number, exceptId?: string): boolean {
  return store.project.bpmPoints.some(
    (p) => p.id !== exceptId && Math.abs(p.beat - Math.max(0, beat)) < 1e-6,
  );
}

export function addBpmPoint(
  rawBeat: number,
  mode: BpmMode = "abs",
  value?: number,
): BpmPoint | null {
  const beat = Math.max(0, snapped(rawBeat));
  const existing = store.project.bpmPoints.find(
    (p) => Math.abs(p.beat - beat) < 1e-6,
  );
  if (isBpmLocked()) {
    if (existing) {
      store.ui.selected = { kind: "bpm", id: existing.id };
      return existing;
    }
    return null;
  }
  if (existing) {
    store.ui.selected = { kind: "bpm", id: existing.id };
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
  store.project.bpmPoints.push(point);
  store.project.dirty = true;
  store.ui.selected = { kind: "bpm", id: point.id };
  return point;
}

export function updateBpmPoint(
  id: string,
  patch: Partial<Pick<BpmPoint, "beat" | "mode" | "value">>,
): void {
  const p = findBpmPoint(id);
  if (!p || isBpmLocked()) return;
  if (!editingGesture) pushHistory();
  if (patch.beat !== undefined) {
    const beat = Math.max(0, snapped(patch.beat));
    if (pointHasBeat(beat, id)) return;
    p.beat = beat;
  }
  if (patch.mode !== undefined && patch.mode !== p.mode) {
    const eff = effectiveBpmFor(p);
    if (patch.mode === "mult") {
      const prev = bpmAtBeat(Math.max(0, p.beat - 1e-4));
      p.mode = "mult";
      p.value = prev > 0 ? round(eff / prev) : 1;
    } else {
      p.mode = "abs";
      p.value = clampBpm(eff);
    }
  }
  if (patch.value !== undefined) {
    const v = Number(patch.value) || 0;
    p.value =
      p.mode === "mult" ? Math.min(100, Math.max(0.01, v)) : clampBpm(v);
  }
  store.project.dirty = true;
}

export function setBpmMode(id: string, mode: BpmMode): void {
  const p = findBpmPoint(id);
  if (!p || p.mode === mode) return;
  updateBpmPoint(id, { mode });
}

export function removeBpmPoint(id: string): void {
  if (isBpmLocked()) return;
  const i = store.project.bpmPoints.findIndex((p) => p.id === id);
  if (i >= 0) {
    pushHistory();
    store.project.bpmPoints.splice(i, 1);
    store.project.dirty = true;
    clearSelectionIfMissing();
  }
}

export function effectiveBpmFor(point: BpmPoint): number {
  const map = buildTempoMap(
    store.project.baseBpm,
    store.project.offsetMs,
    store.project.bpmPoints,
  );
  return map.bpmAtBeat(point.beat);
}

// ---------- playback / zoom ----------

export function setPosition(ms: number): void {
  store.ui.positionMs = ms;
  if (!engine.playing) engine.seek(ms);
  refreshBeatFlash(ms);
}

const needStretch = (): boolean =>
  !store.ui.pitchFollow && Math.abs(store.ui.rate - 1) > 1e-4;

let buildSeq = 0;

async function ensureStretched(rate: number): Promise<AudioBuffer | null> {
  if (engine.hasStretchedFor(rate)) return engine.stretched;
  const src = engine.sourceBuffer;
  if (!src) return null;
  const seq = ++buildSeq;
  store.ui.buffering = true;
  try {
    const buf = await stretchAudioBuffer(src, rate);
    if (seq !== buildSeq) return null;
    engine.stretched = buf;
    engine.stretchedFor = rate;
    return buf;
  } catch {
    return null;
  } finally {
    if (seq === buildSeq) store.ui.buffering = false;
  }
}

async function playNow(): Promise<void> {
  if (!store.ui.hasAudio || store.ui.buffering) return;
  const dur = engine.durationMs();
  if (store.ui.positionMs >= dur) {
    engine.seek(0);
    store.ui.positionMs = 0;
  }
  refreshBeatFlash(store.ui.positionMs);
  store.ui.playing = true;
  store.ui.followActive = store.ui.followManual;
  store.ui.followLocked = false;
  const rate = store.ui.rate;
  const orig = engine.sourceBuffer!;
  if (!needStretch()) {
    engine.playFrom(store.ui.positionMs, {
      buf: orig,
      contentRate: 1,
      sourceRate: rate,
    });
    return;
  }
  const buf = await ensureStretched(rate);
  if (!store.ui.playing || !buf) return;
  engine.playFrom(store.ui.positionMs, {
    buf,
    contentRate: rate,
    sourceRate: 1,
  });
}

export function play(): void {
  void playNow();
}

export function pause(): void {
  store.ui.buffering = false;
  buildSeq++;
  engine.pause();
  store.ui.playing = false;
}

export function togglePlay(): void {
  if (store.ui.playing || store.ui.buffering) pause();
  else play();
}

export function stop(): void {
  store.ui.buffering = false;
  buildSeq++;
  engine.stop();
  store.ui.playing = false;
  store.ui.positionMs = 0;
  store.ui.followActive = false;
  store.ui.followLocked = false;
  refreshBeatFlash(0);
}

export function disableFollowOnScrub(): void {
  if (store.ui.playing) {
    store.ui.followActive = false;
    store.ui.followLocked = true;
  }
}

export function clickFollow(): void {
  if (store.ui.buffering) return;
  if (store.ui.playing) {
    if (store.ui.followActive) {
      store.ui.followActive = false;
      store.ui.followLocked = true;
    } else {
      store.ui.followActive = true;
      store.ui.followLocked = false;
    }
    return;
  }
  store.ui.followManual = !store.ui.followManual;
  store.ui.settings.followPreset = store.ui.followManual;
  void patchSettings({ followPreset: store.ui.followManual });
  if (!store.ui.followManual) store.ui.followActive = false;
}

export function seekTo(ms: number): void {
  engine.seek(ms);
  store.ui.positionMs = engine.positionMs();
  refreshBeatFlash(store.ui.positionMs);
}

export function setVolume(v: number): void {
  store.ui.volume = v;
  engine.setVolume(v);
}

export function applySpeed(rate: number, pitchFollow: boolean): void {
  const r = Math.min(4, Math.max(0.1, rate));
  store.ui.rate = r;
  store.ui.pitchFollow = pitchFollow;
  if (!store.ui.playing || !store.ui.hasAudio) return;
  const pos = engine.positionMs();
  const orig = engine.sourceBuffer;
  if (!orig) return;
  const native = pitchFollow || Math.abs(r - 1) < 1e-4;
  if (native) {
    engine.playFrom(pos, { buf: orig, contentRate: 1, sourceRate: r });
    return;
  }
  engine.pause();
  void ensureStretched(r).then((buf) => {
    if (store.ui.playing && buf) {
      engine.playFrom(pos, { buf, contentRate: r, sourceRate: 1 });
    }
  });
}

export async function loadSettings(): Promise<void> {
  try {
    const got = await window.api.getSettings();
    store.ui.settings = { ...store.ui.settings, ...got };
    store.ui.followManual = got.followPreset;
  } catch {
    /* fallback defaults */
  }
}

let settingsTimer: number | undefined;

export function patchSettings(patch: Partial<SettingsData>): void {
  store.ui.settings = { ...store.ui.settings, ...patch };
  if (settingsTimer !== undefined) clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => {
    void window.api.updateSettings({ ...store.ui.settings });
  }, 180);
}

export function setSettingsOpen(open: boolean): void {
  store.ui.settingsOpen = open;
}

export async function openDevTools(): Promise<void> {
  await window.api.toggleDevTools();
}

// ---- zoom with optional 0.3s ease-out animation (interruptible) ----

const ZOOM_ANIM_MS = 100;
let zoomRaf = 0;
let zoom0 = 0;
let zoom1 = 0;
let zoomStart = 0;

function stopZoom(): void {
  cancelAnimationFrame(zoomRaf);
  zoomRaf = 0;
}

function clampZoom(v: number): number {
  return Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, v));
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

let zoomAnchorSec: number | null = null;
let zoomAnchorX = 0;

function keepZoomAnchor(): void {
  if (zoomAnchorSec === null) return;
  const pps = store.ui.pxPerSec;
  const nx = zoomAnchorSec * pps - zoomAnchorX;
  const end = contentEndMs();
  const cw = Math.max((end / 1000) * pps + 400, view.vw);
  const mx = Math.max(0, cw - view.vw);
  view.x = Math.min(mx, Math.max(0, nx));
}

function animateZoomTo(target: number, anchorSec: number | null): void {
  stopZoom();
  const from = store.ui.pxPerSec;
  if (anchorSec !== null) {
    zoomAnchorSec = anchorSec;
    zoomAnchorX = anchorSec * from - view.x;
  } else {
    zoomAnchorSec = null;
  }
  if (!store.ui.settings.animEnabled || Math.abs(target - from) < 0.001) {
    store.ui.pxPerSec = target;
    keepZoomAnchor();
    zoomAnchorSec = null;
    return;
  }
  zoom0 = from;
  zoom1 = target;
  zoomStart = performance.now();
  const step = (): void => {
    const k = Math.min(1, (performance.now() - zoomStart) / ZOOM_ANIM_MS);
    store.ui.pxPerSec = zoom0 + (zoom1 - zoom0) * easeOutCubic(k);
    keepZoomAnchor();
    if (k < 1) {
      zoomRaf = requestAnimationFrame(step);
    } else {
      store.ui.pxPerSec = zoom1;
      keepZoomAnchor();
      zoomAnchorSec = null;
    }
  };
  zoomRaf = requestAnimationFrame(step);
}

export function zoomBy(factor: number): void {
  const pps = store.ui.pxPerSec;
  const posSec = store.ui.positionMs / 1000;
  const ppx = posSec * pps - view.x;
  // anchor to the playhead when it is on screen; otherwise keep the visible
  // left edge stable so zooming never teleports the view to the start.
  const anchorSec =
    ppx >= 0 && ppx <= view.vw ? posSec : view.x / pps;
  animateZoomTo(clampZoom(pps * factor), anchorSec);
}

export function contentEndMs(): number {
  const map = tempoMap();
  const cands: number[] = [];
  if (store.ui.hasAudio) cands.push(engine.durationMs());
  for (const m of store.project.markers) cands.push(map.timeOfBeat(m.beat));
  for (const p of store.project.bpmPoints) cands.push(map.timeOfBeat(p.beat));
  const audioLen = store.ui.hasAudio ? engine.durationMs() : 0;
  const base = cands.length ? Math.max(...cands) : 0;
  const minLen = Math.max(audioLen, base);
  if (minLen <= 0) return map.timeOfBeat(16);
  return Math.max(minLen + 2000, map.timeOfBeat(16));
}

export function fitZoom(viewportWidthPx: number): void {
  if (viewportWidthPx <= 0) return;
  const len = Math.max(1, contentEndMs());
  animateZoomTo(
    clampZoom(viewportWidthPx / (len / 1000)),
    null,
  );
}

// ---------- audio ----------

// ---- path helpers (the renderer has no node path module) ----

function normSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}
function dirOf(p: string): string {
  const n = normSlashes(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(0, i) : "";
}
function baseName(p: string): string {
  const n = normSlashes(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}
function isAbsolutePath(p: string): boolean {
  const n = normSlashes(p);
  return /^[A-Za-z]:\//.test(n) || n.startsWith("/");
}
function joinDir(dir: string, name: string): string {
  if (!dir) return normSlashes(name);
  const d = normSlashes(dir).replace(/\/+$/, "");
  return d + "/" + normSlashes(name).replace(/^\/+/, "");
}
/** relative path from `dir` to `fp`, or null when not computable (different drive) */
function relativeToDir(dir: string, fp: string): string | null {
  const d = normSlashes(dir).replace(/\/+$/, "");
  const f = normSlashes(fp);
  if (!d || !f) return null;
  const dm = /^([A-Za-z]):/.exec(d);
  const fm = /^([A-Za-z]):/.exec(f);
  if (dm && fm && dm[1] !== fm[1]) return null;
  const da = d.split("/");
  const fa = f.split("/");
  let i = 0;
  while (i < da.length && i < fa.length && da[i] === fa[i]) i++;
  const ups = da.length - i;
  const tail = fa.slice(i).join("/");
  if (!tail) return null;
  return ups > 0 ? `${new Array(ups).fill("..").join("/")}/${tail}` : tail;
}

/** The actual audio location for a persisted audioName (same folder as the project by default). */
function resolveAudioFullPath(name: string | null): string | null {
  if (!name) return null;
  const n = normSlashes(name);
  if (isAbsolutePath(n)) return n;
  const dir = dirOf(store.project.projectPath ?? "");
  return joinDir(dir, n);
}

/** Recompute persisted audioName relative to the current project folder. */
function setAudioNameRelative(): void {
  const ap = store.project.audioPath;
  if (!ap) return;
  const rel = relativeToDir(dirOf(store.project.projectPath ?? ""), ap);
  store.project.audioName = rel ?? baseName(ap);
}

async function decodeAndApply(
  bytes: Uint8Array,
  path: string,
  name: string,
): Promise<boolean> {
  const buffer = await engine.decode(bytes);
  if (!buffer) return false;
  engine.load(buffer);
  store.ui.wave = computePeaks(buffer);
  store.ui.hasAudio = true;
  store.ui.audioMissing = false;
  store.project.audioPath = path;
  store.project.audioName = name;
  // persist a portable name (relative to the project folder) once it is known
  setAudioNameRelative();
  if (!store.project.name || store.project.name === "untitled") {
    store.project.name = name.replace(/\.[^.]+$/, "");
  }
  store.project.dirty = true;
  return true;
}

export async function loadAudioResult(
  res: AudioFileResultLike,
  adopt = true,
): Promise<void> {
  const ok = await decodeAndApply(res.data, res.filePath, res.name);
  if (!ok) {
    ElMessage.error(t("dialogs.audioDecodeFail"));
    return;
  }
  store.ui.audioMissing = false;
  const md5 = await window.api.computeMd5(res.filePath);
  const stored = store.project.audioMd5;
  if (!stored || adopt) {
    store.project.audioMd5 = md5 ?? stored;
    store.ui.audioConflict = false;
  } else {
    store.ui.audioConflict = !!md5 && md5 !== stored;
  }
}

export async function openAudioDialog(): Promise<void> {
  const res = await window.api.openAudio();
  if (res) await loadAudioResult(res);
}

export async function relinkAudio(): Promise<void> {
  const path = await window.api.getFilePath(t("sidebar.chooseSong"));
  if (!path) return;
  const res = await window.api.readAudioFile(path);
  if (!res) {
    ElMessage.error(t("dialogs.audioDecodeFail"));
    return;
  }
  await loadAudioResult(res);
}

// ---------- project io ----------

function freshProject(): void {
  stop();
  store.project.markers = [];
  store.project.bpmPoints = [];
  store.project.tracks = [];
  store.project.name = "";
  store.project.baseBpm = 120;
  store.project.offsetMs = 0;
  store.project.audioPath = null;
  store.project.audioName = null;
  store.project.audioMd5 = null;
  store.project.bpmLocked = false;
  store.project.projectPath = null;
  store.project.dirty = false;
  store.ui.hasAudio = false;
  store.ui.wave = null;
  store.ui.audioMissing = false;
  store.ui.audioConflict = false;
  store.ui.positionMs = 0;
  store.ui.selected = { kind: null, id: null };
  store.ui.multi = [];
  store.ui.cardOpen = false;
  resetHistory();
  markSaved();
  addTrack(undefined, false);
}

export function newProject(): void {
  freshProject();
}

export async function openProject(explicitPath?: string): Promise<void> {
  let res: TextFileResult;
  if (explicitPath) {
    const r = await window.api.readTextFile(explicitPath);
    if (r.canceled || r.content === undefined) {
      ElMessage.error(t("dialogs.openFail"));
      return;
    }
    res = r;
  } else {
    res = await window.api.openTextFile();
  }
  if (res.canceled) return;
  try {
    const raw = JSON.parse(res.content ?? "{}") as {
      app?: string;
      version?: number;
      name?: string;
      bpm?: number;
      baseBpm?: number;
      offsetMs?: number;
      audioPath?: string | null;
      audioName?: string | null;
      audioMd5?: string | null;
      bpmLocked?: boolean;
      tracks?: MarkerTrack[];
      markers?: unknown[];
      bpmPoints?: unknown[];
    };
    if (raw?.app !== "beat-data-generator" || raw?.markers === undefined)
      throw new Error("bad");
    const v1 = raw.version !== 2;
    const legacyAudioPath =
      typeof raw.audioPath === "string" && raw.audioPath.trim()
        ? raw.audioPath
        : null;

    freshProject();
    store.project.name =
      raw.name ||
      (raw.audioName ? baseName(raw.audioName) : null) ||
      "untitled";
    store.project.baseBpm = clampBpm(Number(v1 ? raw.bpm : raw.baseBpm) || 120);
    store.project.offsetMs = Number(raw.offsetMs ?? 0) || 0;
    store.project.audioPath = null;
    store.project.audioName =
      raw.audioName || (legacyAudioPath ? baseName(legacyAudioPath) : null);
    store.project.audioMd5 =
      typeof raw.audioMd5 === "string" ? raw.audioMd5 : null;
    store.project.bpmLocked = raw.bpmLocked === true;

    if (v1) {
      const map = buildTempoMap(
        store.project.baseBpm,
        store.project.offsetMs,
        [],
      );
      const track = store.project.tracks[0]!;
      for (const it of raw.markers as Array<Record<string, unknown>>) {
        if (!it || typeof it !== "object") continue;
        const tms = Number(it.timeMs);
        if (!Number.isFinite(tms)) continue;
        store.project.markers.push({
          id: String(it.id ?? makeId()),
          trackId: track.id,
          beat: Math.max(0, map.beatOfTime(tms)),
        });
      }
    } else {
      const tracks = (raw.tracks ?? []).filter(
        (t): t is MarkerTrack =>
          !!t && typeof (t as MarkerTrack).id === "string",
      );
      if (tracks.length) store.project.tracks = tracks;

      for (const it of raw.bpmPoints as Array<Record<string, unknown>>) {
        if (!it || typeof it !== "object") continue;
        const beat = Number(it.beat);
        if (!Number.isFinite(beat) || beat <= 0) continue;
        store.project.bpmPoints.push({
          id: String(it.id ?? makeId()),
          beat,
          mode: it.mode === "mult" ? "mult" : "abs",
          value: Number(it.value) || 1,
        });
      }
      store.project.bpmPoints.sort((a, b) => a.beat - b.beat);

      const validTracks = new Set(store.project.tracks.map((tr) => tr.id));
      for (const it of raw.markers as Array<Record<string, unknown>>) {
        if (!it || typeof it !== "object") continue;
        const beat = Number(it.beat);
        const trackId = String(it.trackId ?? "");
        if (!Number.isFinite(beat) || !validTracks.has(trackId)) continue;
        const mk: Marker = {
          id: String(it.id ?? makeId()),
          trackId,
          beat: Math.max(0, beat),
        };
        const pid = it.parentId ? String(it.parentId) : undefined;
        if (pid) mk.parentId = pid;
        const l = it.loop as Record<string, unknown> | null | undefined;
        if (l && typeof l === "object") {
          const iv = Number(l.interval);
          const cnt = Number(l.count);
          if (
            Number.isFinite(iv) &&
            iv > 0 &&
            Number.isFinite(cnt) &&
            cnt >= 1
          ) {
            mk.loop = { interval: iv, count: Math.floor(cnt) };
            if (Array.isArray(l.exclude)) {
              const ex = l.exclude
                .map((n) => Number(n))
                .filter((n) => Number.isFinite(n) && n >= 1);
              if (ex.length) mk.loop.exclude = [...new Set(ex)];
            }
          }
        }
        const at = it.attrs as Record<string, unknown> | null | undefined;
        if (at && typeof at === "object" && !Array.isArray(at)) {
          mk.attrs = { ...at };
        }
        store.project.markers.push(mk);
      }
      // canonicalize loop groups from stored main markers
      for (const parent of store.project.markers.filter(
        (mk) => mk.loop && !mk.parentId,
      )) {
        refreshChildren(parent);
      }
    }

    store.project.projectPath = res.filePath ?? null;
    store.project.dirty = false;
    store.ui.selected = { kind: null, id: null };
    store.ui.multi = [];
    store.ui.cardOpen = false;
    if (store.project.audioName) {
      // audio is resolved relative to the project file (or the stored legacy path)
      const guess = resolveAudioFullPath(store.project.audioName);
      let audio = guess ? await window.api.readAudioFile(guess) : null;
      if (!audio && legacyAudioPath && guess !== legacyAudioPath) {
        audio = await window.api.readAudioFile(legacyAudioPath);
      }
      if (audio) {
        await loadAudioResult(audio, false);
        setAudioNameRelative();
        store.project.dirty = false;
      } else {
        store.ui.audioMissing = true;
      }
    }
    markSaved();
    recordRecentNow();
    ElMessage.success(`✔ ${store.project.name}`);
  } catch {
    ElMessage.error(t("dialogs.openFail"));
  }
}

function projectFileName(): string {
  const base = store.project.name || "untitled";
  const safe = base.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled";
  return store.project.projectPath ?? `${safe}.bdg`;
}

export function projectJson(): string {
  const p = store.project;
  const doc: BeatProject = {
    app: "beat-data-generator",
    version: 2,
    name: p.name,
    baseBpm: p.baseBpm,
    offsetMs: p.offsetMs,
    audioName: p.audioName,
    audioMd5: p.audioMd5,
    bpmLocked: p.bpmLocked === true,
    tracks: p.tracks,
    markers: [...p.markers].sort((a, b) => a.beat - b.beat),
    bpmPoints: [...p.bpmPoints].sort((a, b) => a.beat - b.beat),
  };
  return JSON.stringify(doc, null, 2);
}

export async function saveProject(saveAs = false): Promise<void> {
  const existing =
    !saveAs && store.project.projectPath ? store.project.projectPath : "";
  const res = await window.api.saveTextFile(existing || projectFileName());
  if (res.canceled || !res.filePath) return;
  store.project.projectPath = res.filePath;
  setAudioNameRelative();
  const ok = await window.api.writeProjectFile(res.filePath, projectJson());
  if (ok) {
    markSaved();
    recordRecentNow();
    ElMessage.success(t("dialogs.saveOk"));
  } else {
    ElMessage.error(t("dialogs.saveFail"));
  }
}
export async function saveProjectQuick(): Promise<void> {
  const p = store.project.projectPath;
  if (!p) {
    await saveProject(true);
    return;
  }
  setAudioNameRelative();
  const ok = await window.api.writeProjectFile(p, projectJson());
  if (ok) {
    markSaved();
    recordRecentNow();
  } else {
    ElMessage.error(t("dialogs.saveFail"));
  }
}

export function exportLines(): string[] {
  const map = tempoMap();
  const seen = new Set<string>();
  const lines: string[] = [];
  const all = visibleMarkers().map((m) => ({
    t: map.timeOfBeat(m.beat),
  }));
  all.sort((a, b) => a.t - b.t);
  for (const item of all) {
    const s = item.t.toFixed(3);
    if (seen.has(s)) continue;
    seen.add(s);
    lines.push(s);
  }
  return lines;
}

export async function exportTimestamps(): Promise<void> {
  const lines = exportLines();
  if (lines.length === 0) {
    ElMessage.info(t("dialogs.exportEmpty"));
    return;
  }
  const safe = (store.project.name || "untitled").replace(/[\\/:*?"<>|]/g, "_");
  const res = await window.api.saveProjectFile(
    `${safe}-timestamps.txt`,
    lines.join("\n"),
  );
  if (!res.canceled)
    ElMessage.success(t("dialogs.exportOk", { n: lines.length }));
}

// ---- CMX3600 EDL export (25 fps, non-drop frame) ----

const EDL_FPS = 25;

function tcFromMs(ms: number): string {
  let frames = Math.round((Math.max(0, ms) / 1000) * EDL_FPS);
  const h = Math.floor(frames / (3600 * EDL_FPS));
  frames %= 3600 * EDL_FPS;
  const m = Math.floor(frames / (60 * EDL_FPS));
  frames %= 60 * EDL_FPS;
  const s = Math.floor(frames / EDL_FPS);
  const f = frames % EDL_FPS;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

export function edlContent(): { text: string; count: number } {
  const map = tempoMap();
  const clip =
    (store.project.audioName ? baseName(store.project.audioName) : null) ||
    store.project.name ||
    "beat-data-generator";
  const out: string[] = [];
  const seen = new Set<string>();
  let n = 0;
  for (const m of visibleMarkers()) {
    const t = map.timeOfBeat(m.beat);
    const inTc = tcFromMs(t);
    if (seen.has(inTc)) continue;
    seen.add(inTc);
    const outTc = tcFromMs(t + (1000 / EDL_FPS) * 1);
    n++;
    out.push(
      `${String(n).padStart(3, "0")}  AX       V     C        ${inTc} ${outTc} ${inTc} ${outTc}`,
    );
    out.push(`* FROM CLIP NAME: ${clip}`);
  }
  return {
    text: `TITLE: ${store.project.name || "untitled"}\nFCM: NON-DROP FRAME\n\n${out.join("\n")}\n`,
    count: n,
  };
}

export async function exportEDL(): Promise<void> {
  const { text, count } = edlContent();
  if (count === 0) {
    ElMessage.info(t("dialogs.exportEmpty"));
    return;
  }
  const safe = (store.project.name || "untitled").replace(/[\\/:*?"<>|]/g, "_");
  const res = await window.api.saveEDLFile(`${safe}.edl`, text);
  if (!res.canceled)
    ElMessage.success(t("dialogs.exportEdlOk", { n: count }));
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
  const d = engine.durationMs();
  if (!store.ui.hasAudio || d <= 0) return formatTime(store.ui.positionMs);
  return formatTime(Math.max(d, contentEndMs()));
}

export { clampBpm, BPM_MAX, BPM_MIN };

// ================= engineering: autosave / recents / welcome / history / clipboard =================

let lastSavedAt = Date.now();

export function markSaved(): void {
  store.project.dirty = false;
  lastSavedAt = Date.now();
}

function recentTitle(): string {
  const n = store.project.audioName;
  if (n) return baseName(n);
  return store.project.name || "";
}

function recordRecentNow(): void {
  const p = store.project.projectPath;
  if (!p) return;
  void window.api.recordRecent(p, recentTitle());
}

async function autoSaveTick(): Promise<void> {
  const st = store.ui.settings;
  if (!st.autoSave) return;
  const p = store.project.projectPath;
  const intervalMs = Math.max(1, st.autoSaveMinutes || 5) * 60_000;
  if (!store.project.dirty || !p) return;
  if (Date.now() - lastSavedAt < intervalMs) return;
  const ok = await window.api.writeProjectFile(p, projectJson());
  if (ok) markSaved();
}

window.setInterval(() => {
  void autoSaveTick();
}, 1000);

export async function newProjectAt(filePath: string): Promise<void> {
  newProject();
  store.project.projectPath = filePath;
  setAudioNameRelative();
  const ok = await window.api.writeProjectFile(filePath, projectJson());
  if (ok) {
    markSaved();
    recordRecentNow();
    ElMessage.success(t("dialogs.saveOk"));
  } else {
    store.project.projectPath = null;
    ElMessage.error(t("dialogs.saveFail"));
  }
}

// ---------- undo / redo (snapshots) ----------

interface Snap {
  baseBpm: number;
  offsetMs: number;
  tracks: unknown;
  markers: unknown;
  bpmPoints: unknown;
}

const undoStack: Snap[] = [];
const redoStack: Snap[] = [];
let editingGesture = false;

function snapshotNow(): Snap {
  const p = store.project;
  return JSON.parse(
    JSON.stringify({
      baseBpm: p.baseBpm,
      offsetMs: p.offsetMs,
      tracks: p.tracks,
      markers: p.markers,
      bpmPoints: p.bpmPoints,
    }),
  ) as Snap;
}

function applySnap(snap: Snap): void {
  const p = store.project;
  p.baseBpm = snap.baseBpm;
  p.offsetMs = snap.offsetMs;
  p.tracks = snap.tracks as MarkerTrack[];
  p.markers = snap.markers as Marker[];
  p.bpmPoints = snap.bpmPoints as BpmPoint[];
  store.ui.selected = { kind: null, id: null };
  store.ui.multi = [];
  store.ui.cardOpen = false;
  p.dirty = true;
}

function pushHistory(): void {
  if (editingGesture) return;
  undoStack.push(snapshotNow());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}

export function historyGestureBegin(): void {
  if (editingGesture) return;
  editingGesture = true;
  undoStack.push(snapshotNow());
  if (undoStack.length > 100) undoStack.shift();
  redoStack.length = 0;
}

export function historyGestureEnd(): void {
  editingGesture = false;
}

export function resetHistory(): void {
  undoStack.length = 0;
  redoStack.length = 0;
  editingGesture = false;
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}
export function canRedo(): boolean {
  return redoStack.length > 0;
}

export function undo(): void {
  const prev = undoStack.pop();
  if (!prev) return;
  redoStack.push(snapshotNow());
  applySnap(prev);
}

export function redo(): void {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(snapshotNow());
  applySnap(next);
}

// ---------- copy / paste (marker main points + loop groups, multi-select aware) ----------

interface ClipMarker {
  trackId: string;
  beat: number;
  loop: NonNullable<Marker["loop"]> | null;
}

let clipMarkers: ClipMarker[] = [];

export function copyMarkerGroup(): boolean {
  const mains = markerSelectionIds()
    .map((id) => resolveMainMarker(findMarker(id)))
    .filter((m): m is Marker => !!m);
  if (!mains.length) return false;
  const minBeat = Math.min(...mains.map((m) => m.beat));
  clipMarkers = mains.map((m) => ({
    trackId: m.trackId,
    beat: m.beat - minBeat,
    loop: m.loop
      ? {
          interval: m.loop.interval,
          count: m.loop.count,
          ...(m.loop.exclude ? { exclude: [...m.loop.exclude] } : {}),
        }
      : null,
  }));
  return true;
}

export function canPaste(): boolean {
  return clipMarkers.length > 0;
}

export function pasteMarkerGroup(): boolean {
  if (!clipMarkers.length) return false;
  const anchor = Math.max(0, snapped(beatOfTime(store.ui.positionMs)));
  const trackIds = new Set(store.project.tracks.map((t) => t.id));
  pushHistory();
  let created = false;
  for (const clip of clipMarkers) {
    const beat = anchor + clip.beat;
    if (!trackIds.has(clip.trackId)) continue;
    if (isTrackLocked(clip.trackId)) continue;
    if (trackHasBeat(clip.trackId, beat)) continue;
    const m = addMarkerToStore(clip.trackId, beat);
    if (!m) continue;
    const clipTrack = store.project.tracks.find(
      (x) => x.id === clip.trackId,
    );
    if (clipTrack?.type && clipTrack.type !== "beat") {
      m.attrs = defaultAttrsFor(clipTrack.type);
    }
    if (clip.loop) {
      m.loop = {
        interval: clip.loop.interval,
        count: clip.loop.count,
        ...(clip.loop.exclude && clip.loop.exclude.length
          ? { exclude: [...clip.loop.exclude] }
          : {}),
      };
      refreshChildren(m);
    }
    created = true;
  }
  if (!created) return false;
  store.project.dirty = true;
  return true;
}

// ---------- base bpm / offset recorded edits ----------

export function setBaseBpm(v: number): void {
  const next = clampBpm(v);
  if (next === store.project.baseBpm) return;
  pushHistory();
  store.project.baseBpm = next;
  store.project.dirty = true;
}

export function setOffset(v: number): void {
  const next = Math.round(v);
  if (next === store.project.offsetMs) return;
  pushHistory();
  store.project.offsetMs = next;
  store.project.dirty = true;
}

// ---------- welcome action handling ----------

export function bindWelcomeActions(): () => void {
  return window.api.onMainAction((payload: WelcomeAction) => {
    if (payload.type === "new") {
      // main process already showed the Save dialog; if a path was chosen we
      // get it here, otherwise (cancel) nothing is sent and the project is kept.
      if (typeof payload.path === "string") void newProjectAt(payload.path);
      else newProject();
    } else if (payload.type === "open") {
      // main process already ran the file picker
      if (typeof payload.path === "string") void openProject(payload.path);
    } else if (payload.type === "recent") {
      void openProject(payload.path);
    }
  });
}
