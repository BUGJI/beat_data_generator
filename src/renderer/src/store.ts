import { reactive } from "vue";
import { ElMessage } from "element-plus";
import { i18n } from "./i18n";
import { engine, computePeaks } from "./engine";
import { MAX_PX_PER_SEC, MIN_PX_PER_SEC } from "./metrics";
import type {
  AudioFileResultLike,
  BeatProject,
  Marker,
  WaveData,
} from "./types";

interface ProjectState extends BeatProject {
  projectPath: string | null;
  dirty: boolean;
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
  selectedId: string | null;
}

export const store = reactive<{ project: ProjectState; ui: UIState }>({
  project: {
    app: "beat-data-generator",
    version: 1,
    name: "",
    bpm: 120,
    offsetMs: 0,
    audioPath: null,
    audioName: null,
    markers: [],
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
    snapDiv: 4,
    pxPerSec: 90,
    selectedId: null,
  },
});

engine.onTick = () => {
  store.ui.positionMs = engine.positionMs();
  if (!engine.playing) store.ui.playing = false;
};
engine.setVolume(store.ui.volume);

const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.global.t(key, params ?? {});

export const beatMs = (bpm: number): number => 60_000 / bpm;
export const barMs = (bpm: number): number => beatMs(bpm) * 4;

export function sortedMarkers(): Marker[] {
  return [...store.project.markers].sort((a, b) => a.timeMs - b.timeMs);
}

export function snapTime(timeMs: number): number {
  const { snapEnabled, snapDiv } = store.ui;
  const { bpm, offsetMs } = store.project;
  if (!snapEnabled || snapDiv <= 0) return timeMs;
  const grid = beatMs(bpm) / snapDiv;
  return Math.max(0, offsetMs + Math.round((timeMs - offsetMs) / grid) * grid);
}

export function hitTest(
  timeMs: number,
  toleranceMs: number,
): Marker | undefined {
  return store.project.markers.find(
    (m) => Math.abs(m.timeMs - timeMs) <= toleranceMs,
  );
}

export function setPosition(ms: number): void {
  store.ui.positionMs = ms;
  if (!engine.playing) engine.seek(ms);
}

export function play(): void {
  if (!store.ui.hasAudio) return;
  if (store.ui.positionMs >= engine.durationMs()) {
    engine.seek(0);
    store.ui.positionMs = 0;
  }
  engine.play();
  store.ui.playing = true;
}

export function pause(): void {
  engine.pause();
  store.ui.playing = false;
}

export function togglePlay(): void {
  if (store.ui.playing) pause();
  else play();
}

export function stop(): void {
  engine.stop();
  store.ui.playing = false;
  store.ui.positionMs = 0;
}

export function seekTo(ms: number): void {
  engine.seek(ms);
  store.ui.positionMs = engine.positionMs();
}

export function setVolume(v: number): void {
  store.ui.volume = v;
  engine.setVolume(v);
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

export async function openProject(): Promise<void> {
  const res = await window.api.openTextFile();
  if (res.canceled) return;
  try {
    const data = JSON.parse(res.content ?? "{}") as BeatProject;
    if (data?.version !== 1 || data?.markers === undefined)
      throw new Error("bad project");
    store.project.bpm = clampBpm(data.bpm ?? 120);
    store.project.offsetMs = Number(data.offsetMs ?? 0) || 0;
    store.project.audioPath = data.audioPath ?? null;
    store.project.audioName = data.audioName ?? null;
    store.project.name = data.name || store.project.audioName || "untitled";
    store.project.markers = (Array.isArray(data.markers) ? data.markers : [])
      .map((m: Marker) => ({
        id: String(m?.id ?? Math.random()),
        timeMs: Number(m?.timeMs) || 0,
      }))
      .filter((m: Marker) => Number.isFinite(m.timeMs));
    store.project.projectPath = res.filePath ?? null;
    store.ui.selectedId = null;
    store.ui.hasAudio = false;
    store.ui.wave = null;
    store.ui.audioMissing = false;
    store.project.dirty = false;
    if (store.project.audioPath) {
      const audio = await window.api.readAudioFile(store.project.audioPath);
      if (audio) {
        await loadAudioResult(audio);
        store.project.dirty = false;
      } else {
        store.ui.audioMissing = true;
      }
    }
    ElMessage.success(`✔ ${store.project.name}`);
  } catch {
    ElMessage.error(t("dialogs.openFail"));
  }
}

export function newProject(): void {
  stop();
  store.project.markers = [];
  store.project.name = "";
  store.project.bpm = 120;
  store.project.offsetMs = 0;
  store.project.audioPath = null;
  store.project.audioName = null;
  store.project.projectPath = null;
  store.project.dirty = false;
  store.ui.hasAudio = false;
  store.ui.wave = null;
  store.ui.audioMissing = false;
  store.ui.positionMs = 0;
  store.ui.selectedId = null;
}

function clampBpm(b: number): number {
  if (!Number.isFinite(b)) return 120;
  return Math.min(400, Math.max(20, Math.round(b * 10) / 10));
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
    version: 1,
    name: p.name,
    bpm: p.bpm,
    offsetMs: p.offsetMs,
    audioPath: p.audioPath,
    audioName: p.audioName,
    markers: sortedMarkers(),
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
    store.project.dirty = false;
    ElMessage.success(t("dialogs.saveOk"));
  }
}

export async function exportTimestamps(): Promise<void> {
  const markers = sortedMarkers();
  if (markers.length === 0) {
    ElMessage.info(t("dialogs.exportEmpty"));
    return;
  }
  const lines = markers.map((m) => `${m.timeMs.toFixed(3)}`).join("\n");
  const safe = (store.project.name || "untitled").replace(/[\\/:*?"<>|]/g, "_");
  const res = await window.api.saveProjectFile(`${safe}-timestamps.txt`, lines);
  if (!res.canceled)
    ElMessage.success(t("dialogs.exportOk", { n: markers.length }));
}

export function addMarkerAt(timeMs: number): Marker {
  const snapped = snapTime(timeMs);
  const marker: Marker = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timeMs: snapped,
  };
  store.project.markers.push(marker);
  store.ui.selectedId = marker.id;
  store.project.dirty = true;
  return marker;
}

export function removeMarker(id: string): void {
  const i = store.project.markers.findIndex((m) => m.id === id);
  if (i >= 0) {
    store.project.markers.splice(i, 1);
    if (store.ui.selectedId === id) store.ui.selectedId = null;
    store.project.dirty = true;
  }
}

export function moveMarker(id: string, timeMs: number): void {
  const m = store.project.markers.find((x) => x.id === id);
  if (m) {
    m.timeMs = Math.max(0, Math.round(timeMs));
    store.project.dirty = true;
  }
}

export function removeMarkerAt(timeMs: number, toleranceMs: number): boolean {
  const hit = hitTest(timeMs, toleranceMs);
  if (hit) {
    removeMarker(hit.id);
    return true;
  }
  return false;
}

export function selectMarker(id: string | null): void {
  store.ui.selectedId = id;
}

export function zoomBy(factor: number, anchorPx?: number): void {
  const prev = store.ui.pxPerSec;
  const next = Math.min(
    MAX_PX_PER_SEC,
    Math.max(MIN_PX_PER_SEC, prev * factor),
  );
  store.ui.pxPerSec = next;
  void anchorPx;
}

export function fitZoom(durationMs: number, viewportWidthPx: number): void {
  if (durationMs <= 0 || viewportWidthPx <= 0) return;
  store.ui.pxPerSec = Math.min(
    MAX_PX_PER_SEC,
    Math.max(MIN_PX_PER_SEC, viewportWidthPx / (durationMs / 1000)),
  );
}

export function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const milli = Math.floor(ms % 1000);
  const pad = (n: number, w = 2): string => String(n).padStart(w, "0");
  return `${pad(m)}:${pad(s)}.${pad(milli, 3)}`;
}

export function durationReadout(): string {
  const d = engine.durationMs();
  if (!store.ui.hasAudio || d <= 0) return formatTime(store.ui.positionMs);
  const last = store.project.markers.length
    ? Math.max(...store.project.markers.map((m) => m.timeMs))
    : 0;
  const len = Math.max(d, last);
  return formatTime(len);
}
