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

interface ProjectState extends BeatProject {
  projectPath: string | null;
  dirty: boolean;
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
  },
});

engine.onTick = () => {
  store.ui.positionMs = engine.positionMs();
  const dur = engine.durationMs();
  if (dur > 0 && store.ui.positionMs >= dur - 1 && !store.ui.buffering) {
    store.ui.playing = false;
  }
};
engine.setVolume(store.ui.volume);

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
export const markerCount = (): number => store.project.markers.length;

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
}

export function select(kind: "marker" | "bpm" | null, id: string | null): void {
  store.ui.selected = { kind, id };
}

// ---------- tracks ----------

export function addTrack(name?: string, record = true): MarkerTrack {
  if (record) pushHistory();
  const track: MarkerTrack = {
    id: makeId(),
    name:
      name?.trim() ||
      (store.project.tracks.length
        ? `Track ${store.project.tracks.length + 1}`
        : "Marker 1"),
    color: nextColor(store.project.tracks.map((tr) => tr.color)),
  };
  store.project.tracks.push(track);
  store.project.dirty = true;
  return track;
}

export function ensureDefaultTrack(): void {
  if (store.project.tracks.length === 0) addTrack(undefined, false);
}

export function removeTrack(trackId: string): void {
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
  const tr = store.project.tracks.find((x) => x.id === trackId);
  if (tr) {
    pushHistory();
    tr.name = name;
    store.project.dirty = true;
  }
}

export function colorTrack(trackId: string, color: string): void {
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
  if (!parent) return;
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
  const beat = Math.max(0, snapped(rawBeat));
  if (trackHasBeat(trackId, beat)) return null;
  pushHistory();
  const marker = addMarkerToStore(trackId, beat);
  if (!marker) return null;
  store.ui.selected = { kind: "marker", id: marker.id };
  store.project.dirty = true;
  return marker;
}

export function removeMarker(id: string): void {
  const m = findMarker(id);
  if (!m) return;
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
  const others = store.project.markers.filter(
    (x) =>
      x.trackId === trackId && x.id !== parent.id && x.parentId !== parent.id,
  );
  if (others.some((x) => Math.abs(x.beat - parent.beat) < 1 / 128))
    return false;
  pushHistory();
  parent.trackId = trackId;
  if (parent.loop) refreshChildren(parent);
  store.project.dirty = true;
  return true;
}

// ---------- bpm points ----------

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
  if (!p) return;
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

export function zoomBy(factor: number): void {
  store.ui.pxPerSec = Math.min(
    MAX_PX_PER_SEC,
    Math.max(MIN_PX_PER_SEC, store.ui.pxPerSec * factor),
  );
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
  store.ui.pxPerSec = Math.min(
    MAX_PX_PER_SEC,
    Math.max(MIN_PX_PER_SEC, viewportWidthPx / (len / 1000)),
  );
}

// ---------- audio ----------

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
  if (!store.project.name || store.project.name === "untitled") {
    store.project.name = name.replace(/\.[^.]+$/, "");
  }
  store.project.dirty = true;
  return true;
}

export async function loadAudioResult(res: AudioFileResultLike): Promise<void> {
  const ok = await decodeAndApply(res.data, res.filePath, res.name);
  if (!ok) ElMessage.error(t("dialogs.audioDecodeFail"));
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
  store.project.projectPath = null;
  store.project.dirty = false;
  store.ui.hasAudio = false;
  store.ui.wave = null;
  store.ui.audioMissing = false;
  store.ui.positionMs = 0;
  store.ui.selected = { kind: null, id: null };
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
    if (r.canceled || r.content === undefined) return;
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
      tracks?: MarkerTrack[];
      markers?: unknown[];
      bpmPoints?: unknown[];
    };
    if (raw?.app !== "beat-data-generator" || raw?.markers === undefined)
      throw new Error("bad");
    const v1 = raw.version !== 2;

    freshProject();
    store.project.name = raw.name || raw.audioName || "untitled";
    store.project.baseBpm = clampBpm(Number(v1 ? raw.bpm : raw.baseBpm) || 120);
    store.project.offsetMs = Number(raw.offsetMs ?? 0) || 0;
    store.project.audioPath = raw.audioPath ?? null;
    store.project.audioName = raw.audioName ?? null;

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
    if (store.project.audioPath) {
      const audio = await window.api.readAudioFile(store.project.audioPath);
      if (audio) {
        await loadAudioResult(audio);
        store.project.dirty = false;
      } else {
        store.ui.audioMissing = true;
      }
    }
    markSaved();
    if (store.project.projectPath)
      void window.api.recordRecent(store.project.projectPath);
    ElMessage.success(`✔ ${store.project.name}`);
  } catch {
    ElMessage.error(t("dialogs.openFail"));
  }
}

function projectFileName(): string {
  const base = store.project.name || "untitled";
  const safe = base.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled";
  return store.project.projectPath ?? `${safe}.bdg.json`;
}

export function projectJson(): string {
  const p = store.project;
  const doc: BeatProject = {
    app: "beat-data-generator",
    version: 2,
    name: p.name,
    baseBpm: p.baseBpm,
    offsetMs: p.offsetMs,
    audioPath: p.audioPath,
    audioName: p.audioName,
    tracks: p.tracks,
    markers: [...p.markers].sort((a, b) => a.beat - b.beat),
    bpmPoints: [...p.bpmPoints].sort((a, b) => a.beat - b.beat),
  };
  return JSON.stringify(doc, null, 2);
}

export async function saveProject(saveAs = false): Promise<void> {
  const path =
    saveAs || !store.project.projectPath ? "" : store.project.projectPath;
  const res = await window.api.saveTextFile(
    path || projectFileName(),
    projectJson(),
  );
  if (!res.canceled && res.filePath) {
    store.project.projectPath = res.filePath;
    markSaved();
    void window.api.recordRecent(res.filePath);
    ElMessage.success(t("dialogs.saveOk"));
  }
}

export function exportLines(): string[] {
  const map = tempoMap();
  const seen = new Set<string>();
  const lines: string[] = [];
  const all = store.project.markers.map((m) => ({ t: map.timeOfBeat(m.beat) }));
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

export async function newProjectWithSave(): Promise<void> {
  newProject();
  const def = projectFileName();
  const res = await window.api.saveTextFile(def, projectJson());
  if (!res.canceled && res.filePath) {
    store.project.projectPath = res.filePath;
    markSaved();
    void window.api.recordRecent(res.filePath);
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

// ---------- copy / paste (marker main point + loop group) ----------

interface ClipMarker {
  trackId: string;
  loop: NonNullable<Marker["loop"]> | null;
}

let clipboardMarker: ClipMarker | null = null;

export function copyMarkerGroup(): boolean {
  const m = store.project.markers.find((x) => x.id === store.ui.selected.id);
  const main = resolveMainMarker(m);
  if (!main) return false;
  clipboardMarker = {
    trackId: main.trackId,
    loop: main.loop
      ? {
          interval: main.loop.interval,
          count: main.loop.count,
          ...(main.loop.exclude ? { exclude: [...main.loop.exclude] } : {}),
        }
      : null,
  };
  return true;
}

export function canPaste(): boolean {
  return clipboardMarker !== null;
}

export function pasteMarkerGroup(): boolean {
  const clip = clipboardMarker;
  if (!clip) return false;
  const beat = Math.max(0, snapped(beatOfTime(store.ui.positionMs)));
  if (trackHasBeat(clip.trackId, beat)) return false;
  pushHistory();
  const m = addMarkerToStore(clip.trackId, beat);
  if (!m) return false;
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
  store.ui.selected = { kind: "marker", id: m.id };
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
    if (payload.type === "new") void newProjectWithSave();
    else if (payload.type === "open") void openProject();
    else if (payload.type === "recent") void openProject(payload.path);
  });
}
