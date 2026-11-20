import { toast } from "../ui/toast";
import { t } from "../utils/text";
import { DEFAULT_DIV } from "../metrics";
import {
  addTrack,
  refreshChildren,
  useProjectStore,
  visibleMarkers,
} from "../stores/project";
import {
  parseProjectDocument,
  projectSchemasFor,
  type ParsedProject,
} from "../schemas/project";
import { resetLoopState, useTransportStore } from "../stores/transport";
import { markerSelectionIds, useSelectionStore } from "../stores/selection";
import { useUiStore } from "../stores/ui";
import { useSettingsStore } from "../stores/settings";
import { stop } from "./playback";
import { markerTime } from "./timeline";
import {
  audioLoadEpoch,
  invalidateAudioLoad,
  loadAudioResult,
  resolveAudioFullPath,
  setAudioNameRelative,
} from "./audioIO";
import { resetHistory } from "./history";
import { resetAnalysis } from "../analysis";
import { currentNumberPolicy } from "../utils/numberPolicy";
import { baseName } from "@shared/path";
import { safeFileBase } from "../utils/fileName";
import type { BeatProject, Marker } from "../types";
import type {
  RecoverySnapshot,
  TextFileResult,
  WelcomeAction,
} from "@shared/ipc";

/**
 * Project persistence: new / open / save, autosave and the timestamp + EDL
 * exports. All of it operates on the project document store.
 */

let lastSavedAt = Date.now();
let lastRecoveryAt = 0;

function clearRecoveryFile(): void {
  if (typeof window.api.clearRecovery === "function") {
    void window.api.clearRecovery();
  }
}

export function markSaved(): void {
  useProjectStore().dirty = false;
  lastSavedAt = Date.now();
}

/**
 * Mark the project clean only when the document still matches what was written.
 * If the user edited while the async write was in flight the document differs,
 * so the dirty flag stays set and the edit is not silently treated as saved.
 */
function markSavedIfUnchanged(payload: string): void {
  if (projectJson() === payload) markSaved();
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
  // Abandon any silent audio load (and its MD5 check) still in flight for the
  // project being left behind, so its result can never be applied to the new one.
  invalidateAudioLoad();
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
  p.beatsPerBar = 4;
  p.gridDiv = DEFAULT_DIV;
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
  resetLoopState();
  sel.selected = { kind: null, id: null };
  sel.multi = [];
  sel.cardOpen = false;
  useUiStore().timeAlign = false;
  resetHistory();
  resetAnalysis();
  markSaved();
  lastRecoveryAt = 0;
  addTrack(undefined, false);
}

/**
 * Ask for a location, then create and write a fresh project there. Cancelling
 * the dialog leaves the current project untouched. Same flow as the welcome
 * window's "new project" so both entry points behave identically.
 */
export async function newProject(): Promise<void> {
  const res = await window.api.saveTextFile("untitled.bdg");
  if (res.canceled || !res.filePath) return;
  await newProjectAt(res.filePath);
}

interface ApplyProjectOptions {
  legacyAudioPath?: string | null;
  audioPath?: string | null;
  adoptAudio?: boolean;
  keepDirty?: boolean;
}

async function applyProjectDocument(
  doc: ParsedProject["doc"],
  projectPath: string | null,
  opts: ApplyProjectOptions = {},
): Promise<boolean> {
  const p = useProjectStore();
  const tr = useTransportStore();
  const sel = useSelectionStore();

  freshProject();
  // Tag this open so a later project switch (which bumps the epoch) aborts the
  // rest of this one instead of writing its state into the new document.
  const epoch = audioLoadEpoch();
  p.name = doc.name;
  p.baseBpm = doc.baseBpm;
  p.offsetMs = doc.offsetMs;
  p.beatsPerBar = doc.beatsPerBar;
  p.gridDiv = doc.gridDiv;
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

  p.projectPath = projectPath;
  p.dirty = opts.keepDirty === true;
  sel.selected = { kind: null, id: null };
  sel.multi = [];
  sel.cardOpen = false;
  if (p.audioName) {
    // audio is resolved relative to the project file (or the stored legacy path)
    const guess = opts.audioPath ?? resolveAudioFullPath(p.audioName);
    let audio = guess ? await window.api.readAudioFile(guess) : null;
    if (epoch !== audioLoadEpoch()) return false;
    if (
      audio === null &&
      opts.legacyAudioPath &&
      guess !== opts.legacyAudioPath
    ) {
      audio = await window.api.readAudioFile(opts.legacyAudioPath);
      if (epoch !== audioLoadEpoch()) return false;
    }
    if (audio) {
      // Loading audio for an existing project must not auto-apply detected
      // BPM/beats: await the analysis so it finishes before we mark the
      // project clean, and never let it rewrite the loaded document.
      await loadAudioResult(audio, opts.adoptAudio === true, false);
      if (epoch !== audioLoadEpoch()) return false;
      setAudioNameRelative();
      p.dirty = opts.keepDirty === true;
    } else {
      tr.audioMissing = true;
    }
  }
  if (epoch !== audioLoadEpoch()) return false;
  if (opts.keepDirty === true) {
    p.dirty = true;
  } else {
    markSaved();
    recordRecentNow();
  }
  return true;
}

export async function openProject(explicitPath?: string): Promise<void> {
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
    const parsed = parseProjectDocument(
      JSON.parse(res.content ?? "{}"),
      currentNumberPolicy(),
    );
    if (!parsed) throw new Error("bad");
    await applyProjectDocument(parsed.doc, res.filePath ?? null, {
      legacyAudioPath: parsed.legacyAudioPath,
      adoptAudio: false,
    });
    // Opening stays silent: a matching audio MD5 shows no toast, and a real
    // mismatch is surfaced by the ProjectBar warning banner instead.
  } catch {
    toast.error(t("dialogs.openFail"));
  }
}

async function restoreRecovery(
  parsed: ParsedProject,
  snap: RecoverySnapshot,
): Promise<void> {
  const ok = await applyProjectDocument(parsed.doc, snap.projectPath, {
    legacyAudioPath: parsed.legacyAudioPath,
    audioPath: snap.audioPath,
    adoptAudio: true,
    keepDirty: true,
  });
  if (!ok) return;
  toast.success(t("dialogs.recovered"));
}

export async function maybeOfferRecovery(): Promise<void> {
  if (typeof window.api.readRecovery !== "function") return;
  const snap = await window.api.readRecovery();
  if (!snap || typeof snap.content !== "string") return;
  let parsed: ParsedProject | null = null;
  try {
    parsed = parseProjectDocument(
      JSON.parse(snap.content),
      currentNumberPolicy(),
    );
  } catch {
    parsed = null;
  }
  if (!parsed) {
    clearRecoveryFile();
    return;
  }
  const when = snap.savedAt ? new Date(snap.savedAt) : null;
  const time =
    when && !Number.isNaN(when.getTime()) ? when.toLocaleString() : "";
  toast.action(
    t("dialogs.recoveryFound", { time }),
    t("dialogs.recover"),
    () => {
      if (parsed) void restoreRecovery(parsed, snap);
    },
    12000,
    "warning",
  );
}

function projectFileName(): string {
  const p = useProjectStore();
  return p.projectPath ?? `${safeFileBase(p.name)}.bdg`;
}

export function projectJson(): string {
  const p = useProjectStore();
  const doc: BeatProject = {
    app: "beat-data-generator",
    version: 2,
    name: p.name,
    baseBpm: p.baseBpm,
    offsetMs: p.offsetMs,
    beatsPerBar: p.beatsPerBar,
    gridDiv: p.gridDiv,
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
  const check = projectSchemasFor(
    currentNumberPolicy(),
  ).BeatProjectSchema.safeParse(doc);
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
  const payload = projectJson();
  const ok = await window.api.writeProjectFile(res.filePath, payload);
  if (ok) {
    markSavedIfUnchanged(payload);
    recordRecentNow();
    if (!p.dirty) clearRecoveryFile();
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
  const payload = projectJson();
  const ok = await window.api.writeProjectFile(path, payload);
  if (ok) {
    markSavedIfUnchanged(payload);
    recordRecentNow();
    if (!p.dirty) clearRecoveryFile();
  } else {
    toast.error(t("dialogs.saveFail"));
  }
}

export type ExportScope = "all" | "selection";

export interface ExportStats {
  total: number;
  exportable: number;
  hidden: number;
  typed: number;
  selected: number;
  selectedExportable: number;
}

export interface TimestampExportOptions {
  scope?: ExportScope;
  decimals?: number;
}

export interface EdlExportOptions {
  scope?: ExportScope;
  fps?: number;
}

function clampDecimals(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return 3;
  return Math.min(6, Math.max(0, Math.round(v)));
}

function clampFps(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return 25;
  return Math.min(60, Math.max(1, Math.round(v)));
}

function exportMarkerList(scope: ExportScope): Marker[] {
  const list = visibleMarkers();
  if (scope !== "selection") return list;
  const selected = new Set(markerSelectionIds());
  if (!selected.size) return [];
  return list.filter(
    (m) =>
      selected.has(m.id) || (m.parentId ? selected.has(m.parentId) : false),
  );
}

/** Counts shown by the export dialog; mirrors what the built-in writers use. */
export function exportStats(): ExportStats {
  const p = useProjectStore();
  let hidden = 0;
  let typed = 0;
  for (const marker of p.markers) {
    const track = p.tracksById.get(marker.trackId);
    if (track?.hidden) hidden++;
    else if (track?.type && track.type !== "beat") typed++;
  }
  return {
    total: p.markers.length,
    exportable: visibleMarkers().length,
    hidden,
    typed,
    selected: markerSelectionIds().length,
    selectedExportable: exportMarkerList("selection").length,
  };
}

export function exportLines(opts: TimestampExportOptions = {}): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  const decimals = clampDecimals(opts.decimals);
  const all = exportMarkerList(opts.scope ?? "all").map((m) => ({
    t: markerTime(m),
  }));
  all.sort((a, b) => a.t - b.t);
  for (const item of all) {
    const s = item.t.toFixed(decimals);
    if (seen.has(s)) continue;
    seen.add(s);
    lines.push(s);
  }
  return lines;
}

export async function exportTimestamps(
  opts: TimestampExportOptions = {},
): Promise<boolean> {
  const p = useProjectStore();
  const lines = exportLines(opts);
  if (lines.length === 0) {
    toast.info(t("dialogs.exportEmpty"));
    return false;
  }
  const res = await window.api.saveProjectFile(
    `${safeFileBase(p.name)}-timestamps.txt`,
    lines.join("\n"),
  );
  if (res.canceled) return false;
  toast.success(t("dialogs.exportOk", { n: lines.length }));
  return true;
}

// ---- CMX3600 EDL export ----

function tcFromMs(ms: number, fps: number): string {
  let frames = Math.round((Math.max(0, ms) / 1000) * fps);
  const h = Math.floor(frames / (3600 * fps));
  frames %= 3600 * fps;
  const m = Math.floor(frames / (60 * fps));
  frames %= 60 * fps;
  const s = Math.floor(frames / fps);
  const f = frames % fps;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

export function edlContent(opts: EdlExportOptions = {}): {
  text: string;
  count: number;
} {
  const p = useProjectStore();
  const fps = clampFps(opts.fps);
  const clip =
    (p.audioName ? baseName(p.audioName) : null) ||
    p.name ||
    "beat-data-generator";
  const out: string[] = [];
  const seen = new Set<string>();
  let n = 0;
  for (const m of exportMarkerList(opts.scope ?? "all")) {
    const tm = markerTime(m);
    const inTc = tcFromMs(tm, fps);
    if (seen.has(inTc)) continue;
    seen.add(inTc);
    const outTc = tcFromMs(tm + 1000 / fps, fps);
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

export async function exportEDL(opts: EdlExportOptions = {}): Promise<boolean> {
  const p = useProjectStore();
  const { text, count } = edlContent(opts);
  if (count === 0) {
    toast.info(t("dialogs.exportEmpty"));
    return false;
  }
  const res = await window.api.saveEDLFile(`${safeFileBase(p.name)}.edl`, text);
  if (res.canceled) return false;
  toast.success(t("dialogs.exportEdlOk", { n: count }));
  return true;
}

export async function autoSaveTick(): Promise<void> {
  const p = useProjectStore();
  const st = useSettingsStore().settings;
  if (!st.autoSave || !p.dirty) return;
  const path = p.projectPath;
  const intervalMs = Math.max(1, st.autoSaveMinutes || 5) * 60_000;
  const now = Date.now();
  if (now - lastRecoveryAt >= intervalMs) {
    lastRecoveryAt = now;
    if (typeof window.api.writeRecovery === "function") {
      void window.api.writeRecovery({
        savedAt: new Date(now).toISOString(),
        projectPath: p.projectPath,
        audioPath: p.audioPath,
        content: projectJson(),
      });
    }
  }
  if (!path || now - lastSavedAt < intervalMs) return;
  const payload = projectJson();
  const ok = await window.api.writeProjectFile(path, payload);
  if (ok) {
    markSavedIfUnchanged(payload);
    if (!p.dirty) clearRecoveryFile();
  }
}

export async function newProjectAt(filePath: string): Promise<void> {
  const p = useProjectStore();
  freshProject();
  p.projectPath = filePath;
  setAudioNameRelative();
  const payload = projectJson();
  const ok = await window.api.writeProjectFile(filePath, payload);
  if (ok) {
    markSavedIfUnchanged(payload);
    recordRecentNow();
    if (!p.dirty) clearRecoveryFile();
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
    } else if (payload.type === "open") {
      // main process already ran the file picker
      if (typeof payload.path === "string") void openProject(payload.path);
    } else if (payload.type === "recent") {
      void openProject(payload.path);
    }
  });
}
