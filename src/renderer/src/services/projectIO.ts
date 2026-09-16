import { toast } from "../ui/toast";
import { t } from "../utils/text";
import {
  addTrack,
  refreshChildren,
  useProjectStore,
  visibleMarkers,
} from "../stores/project";
import {
  BeatProjectSchema,
  parseProjectDocument,
} from "../schemas/project";
import { useTransportStore } from "../stores/transport";
import { useSelectionStore } from "../stores/selection";
import { useUiStore } from "../stores/ui";
import { useSettingsStore } from "../stores/settings";
import { stop } from "./playback";
import { markerTime } from "./timeline";
import {
  baseName,
  loadAudioResult,
  resolveAudioFullPath,
  setAudioNameRelative,
} from "./audioIO";
import { resetHistory } from "./history";
import type { BeatProject } from "../types";
import type { TextFileResult, WelcomeAction } from "../../../shared/ipc";

/**
 * Project persistence: new / open / save, autosave and the timestamp + EDL
 * exports. All of it operates on the project document store.
 */

let lastSavedAt = Date.now();

export function markSaved(): void {
  useProjectStore().dirty = false;
  lastSavedAt = Date.now();
}

function recentTitle(): string {
  const p = useProjectStore();
  const n = p.audioName;
  if (n) return baseName(n);
  return p.name || "";
}

function recordRecentNow(): void {
  const p = useProjectStore();
  if (!p.projectPath) return;
  void window.api.recordRecent(p.projectPath, recentTitle());
}

function freshProject(): void {
  stop();
  const p = useProjectStore();
  const tr = useTransportStore();
  const sel = useSelectionStore();
  p.markers = [];
  p.bpmPoints = [];
  p.tracks = [];
  p.notes = [];
  p.name = "";
  p.baseBpm = 120;
  p.offsetMs = 0;
  p.audioPath = null;
  p.audioName = null;
  p.audioMd5 = null;
  p.bpmLocked = false;
  p.projectPath = null;
  p.dirty = false;
  tr.hasAudio = false;
  tr.wave = null;
  tr.audioMissing = false;
  tr.audioConflict = false;
  tr.positionMs = 0;
  sel.selected = { kind: null, id: null };
  sel.multi = [];
  sel.cardOpen = false;
  useUiStore().timeAlign = false;
  resetHistory();
  markSaved();
  addTrack(undefined, false);
}

export function newProject(): void {
  freshProject();
}

export async function openProject(explicitPath?: string): Promise<void> {
  const p = useProjectStore();
  const tr = useTransportStore();
  const sel = useSelectionStore();
  let res: TextFileResult;
  if (explicitPath) {
    const r = await window.api.readTextFile(explicitPath);
    if (r.canceled || r.content === undefined) {
      toast.error(t("dialogs.openFail"));
      return;
    }
    res = r;
  } else {
    res = await window.api.openTextFile();
  }
  if (res.canceled) return;
  try {
    const parsed = parseProjectDocument(JSON.parse(res.content ?? "{}"));
    if (!parsed) throw new Error("bad");
    const { doc, legacyAudioPath } = parsed;

    freshProject();
    p.name = doc.name;
    p.baseBpm = doc.baseBpm;
    p.offsetMs = doc.offsetMs;
    p.audioPath = null;
    p.audioName = doc.audioName;
    p.audioMd5 = doc.audioMd5;
    p.bpmLocked = doc.bpmLocked === true;
    p.tracks = doc.tracks;
    p.markers = doc.markers;
    p.bpmPoints = doc.bpmPoints.sort((a, b) => a.beat - b.beat);
    p.notes = doc.notes;
    if (!p.tracks.length) addTrack(undefined, false);
    // canonicalize loop groups from stored main markers
    for (const parent of p.markers.filter((mk) => mk.loop && !mk.parentId)) {
      refreshChildren(parent);
    }

    p.projectPath = res.filePath ?? null;
    p.dirty = false;
    sel.selected = { kind: null, id: null };
    sel.multi = [];
    sel.cardOpen = false;
    if (p.audioName) {
      // audio is resolved relative to the project file (or the stored legacy path)
      const guess = resolveAudioFullPath(p.audioName);
      let audio = guess ? await window.api.readAudioFile(guess) : null;
      if (!audio && legacyAudioPath && guess !== legacyAudioPath) {
        audio = await window.api.readAudioFile(legacyAudioPath);
      }
      if (audio) {
        await loadAudioResult(audio, false);
        setAudioNameRelative();
        p.dirty = false;
      } else {
        tr.audioMissing = true;
      }
    }
    markSaved();
    recordRecentNow();
    toast.success(`✔ ${p.name}`);
  } catch {
    toast.error(t("dialogs.openFail"));
  }
}

function projectFileName(): string {
  const p = useProjectStore();
  const base = p.name || "untitled";
  const safe = base.replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled";
  return p.projectPath ?? `${safe}.bdg`;
}

export function projectJson(): string {
  const p = useProjectStore();
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
    notes: p.notes,
  };
  // Safety net: assert the in-memory document still matches the wire format so
  // serializer drift is caught in development instead of on a user's disk.
  const check = BeatProjectSchema.safeParse(doc);
  if (!check.success) {
    console.error("[project] document does not match schema", check.error);
  }
  return JSON.stringify(doc, null, 2);
}

export async function saveProject(saveAs = false): Promise<void> {
  const p = useProjectStore();
  const existing = !saveAs && p.projectPath ? p.projectPath : "";
  const res = await window.api.saveTextFile(existing || projectFileName());
  if (res.canceled || !res.filePath) return;
  p.projectPath = res.filePath;
  setAudioNameRelative();
  const ok = await window.api.writeProjectFile(res.filePath, projectJson());
  if (ok) {
    markSaved();
    recordRecentNow();
    toast.success(t("dialogs.saveOk"));
  } else {
    toast.error(t("dialogs.saveFail"));
  }
}

export async function saveProjectQuick(): Promise<void> {
  const p = useProjectStore();
  const path = p.projectPath;
  if (!path) {
    await saveProject(true);
    return;
  }
  setAudioNameRelative();
  const ok = await window.api.writeProjectFile(path, projectJson());
  if (ok) {
    markSaved();
    recordRecentNow();
  } else {
    toast.error(t("dialogs.saveFail"));
  }
}

export function exportLines(): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  const all = visibleMarkers().map((m) => ({ t: markerTime(m) }));
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
  const p = useProjectStore();
  const lines = exportLines();
  if (lines.length === 0) {
    toast.info(t("dialogs.exportEmpty"));
    return;
  }
  const safe = (p.name || "untitled").replace(/[\\/:*?"<>|]/g, "_");
  const res = await window.api.saveProjectFile(
    `${safe}-timestamps.txt`,
    lines.join("\n"),
  );
  if (!res.canceled)
    toast.success(t("dialogs.exportOk", { n: lines.length }));
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
  const p = useProjectStore();
  const clip =
    (p.audioName ? baseName(p.audioName) : null) ||
    p.name ||
    "beat-data-generator";
  const out: string[] = [];
  const seen = new Set<string>();
  let n = 0;
  for (const m of visibleMarkers()) {
    const tm = markerTime(m);
    const inTc = tcFromMs(tm);
    if (seen.has(inTc)) continue;
    seen.add(inTc);
    const outTc = tcFromMs(tm + (1000 / EDL_FPS) * 1);
    n++;
    out.push(
      `${String(n).padStart(3, "0")}  AX       V     C        ${inTc} ${outTc} ${inTc} ${outTc}`,
    );
    out.push(`* FROM CLIP NAME: ${clip}`);
  }
  return {
    text: `TITLE: ${p.name || "untitled"}\nFCM: NON-DROP FRAME\n\n${out.join("\n")}\n`,
    count: n,
  };
}

export async function exportEDL(): Promise<void> {
  const p = useProjectStore();
  const { text, count } = edlContent();
  if (count === 0) {
    toast.info(t("dialogs.exportEmpty"));
    return;
  }
  const safe = (p.name || "untitled").replace(/[\\/:*?"<>|]/g, "_");
  const res = await window.api.saveEDLFile(`${safe}.edl`, text);
  if (!res.canceled)
    toast.success(t("dialogs.exportEdlOk", { n: count }));
}

export async function autoSaveTick(): Promise<void> {
  const p = useProjectStore();
  const st = useSettingsStore().settings;
  if (!st.autoSave) return;
  const path = p.projectPath;
  const intervalMs = Math.max(1, st.autoSaveMinutes || 5) * 60_000;
  if (!p.dirty || !path) return;
  if (Date.now() - lastSavedAt < intervalMs) return;
  const ok = await window.api.writeProjectFile(path, projectJson());
  if (ok) markSaved();
}

export async function newProjectAt(filePath: string): Promise<void> {
  const p = useProjectStore();
  newProject();
  p.projectPath = filePath;
  setAudioNameRelative();
  const ok = await window.api.writeProjectFile(filePath, projectJson());
  if (ok) {
    markSaved();
    recordRecentNow();
    toast.success(t("dialogs.saveOk"));
  } else {
    p.projectPath = null;
    toast.error(t("dialogs.saveFail"));
  }
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
