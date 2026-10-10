import { toast } from "../ui/toast";
import { engine, computePeaks } from "../engine";
import { t } from "../utils/text";
import { useProjectStore } from "../stores/project";
import { useTransportStore } from "../stores/transport";
import {
  baseName,
  dirName,
  isAbsolutePath,
  joinPath,
  relativeToDir,
} from "@shared/path";
import type { AudioFileResultLike } from "../types";

/** Audio loading / relinking and the renderer-side path helpers. */

/**
 * Monotonic id for the active project's audio load. Bumped whenever the project
 * document is reset (new / open) so a silent load started for a previous project
 * cannot apply its audio, or its MD5 comparison, to the project that was opened
 * while that load was still in flight.
 */
let loadEpoch = 0;

/** Abandon any in-flight audio load. Call when the project document is reset. */
export function invalidateAudioLoad(): void {
  loadEpoch++;
}

/** Current audio-load epoch; async callers compare against it to detect a reset. */
export function audioLoadEpoch(): number {
  return loadEpoch;
}

/** The actual audio location for a persisted audioName (same folder as the project by default). */
export function resolveAudioFullPath(name: string | null): string | null {
  if (!name) return null;
  const p = useProjectStore();
  if (isAbsolutePath(name)) return name;
  const dir = dirName(p.projectPath ?? "");
  return joinPath(dir, name);
}

/** Recompute persisted audioName relative to the current project folder. */
export function setAudioNameRelative(): void {
  const p = useProjectStore();
  const ap = p.audioPath;
  if (!ap) return;
  const rel = relativeToDir(dirName(p.projectPath ?? ""), ap);
  p.audioName = rel ?? baseName(ap);
}

async function decodeAndApply(
  bytes: Uint8Array,
  path: string,
  name: string,
  autoApply: boolean,
  markDirty: boolean,
): Promise<boolean> {
  const epoch = loadEpoch;
  const p = useProjectStore();
  const tr = useTransportStore();
  const buffer = await engine.decode(bytes);
  // A new project was opened while decoding: drop this load entirely.
  if (epoch !== loadEpoch) return false;
  if (!buffer) return false;
  engine.load(buffer);
  tr.wave = computePeaks(buffer);
  tr.hasAudio = true;
  tr.audioMissing = false;
  p.audioPath = path;
  p.audioName = name;
  // persist a portable name (relative to the project folder) once it is known
  setAudioNameRelative();
  if (!p.name || p.name === "untitled") {
    p.name = name.replace(/\.[^.]+$/, "");
  }
  // Loading a project's own audio during open is not a user edit: marking dirty
  // here would show the unsaved dot for the whole (silent) MD5 check + analysis.
  if (markDirty) p.dirty = true;
  // Run pleco-xa analysis (BPM / beats / loop / spectrum) against the new
  // audio, honoring each independent audio-analysis setting toggle. Awaited so
  // callers that then mark the project clean (e.g. openProject) observe the
  // final document state; passed autoApply=false to keep an opened project
  // from being rewritten by auto-BPM / auto-beats.
  const { onAudioLoaded } = await import("../analysis");
  await onAudioLoaded(autoApply);
  if (epoch !== loadEpoch) return false;
  return true;
}

export interface ReplaceAudioOptions {
  /** Absolute path written to `audioPath`. */
  path: string;
  /** Display/file name written to `audioName` (usually the basename). */
  name: string;
  /** True for user-initiated loads (choose / relink / crop); false when a
   *  project opens its already-recorded audio. Only the former is an edit. */
  adopt?: boolean;
  /** Whether pleco-auto analysis may auto-apply BPM/beats (default true). */
  autoApply?: boolean;
  /** MD5 already computed by the caller, to skip a full re-read of the file. */
  md5?: string | null;
}

/**
 * Decode `bytes` and make them the current audio: swap the wave, relink the
 * path, refresh peaks/MD5 and run analysis. Shared by user audio loads and the
 * plugin `audio.replaceFromBytes` API. Resolves true on success, false when the
 * bytes fail to decode or a newer load (project switch / another load) superseded
 * this one.
 */
export async function replaceAudioFromBytes(
  bytes: Uint8Array,
  opts: ReplaceAudioOptions,
): Promise<boolean> {
  const epoch = loadEpoch;
  const p = useProjectStore();
  const tr = useTransportStore();
  const adopt = opts.adopt ?? true;
  const autoApply = opts.autoApply ?? true;
  const ok = await decodeAndApply(
    bytes,
    opts.path,
    opts.name,
    autoApply,
    adopt,
  );
  // The project was switched while loading: the epoch captured above no longer
  // describes the current document, so do not touch it (this is what previously
  // produced a bogus MD5-mismatch banner after opening another project).
  if (epoch !== loadEpoch) return false;
  if (!ok) return false;
  tr.audioMissing = false;
  // Prefer a caller-supplied MD5; only fall back to a separate hash call when the
  // bytes arrived without one.
  const md5 = opts.md5 ?? (await window.api.computeMd5(opts.path));
  if (epoch !== loadEpoch) return false;
  const stored = p.audioMd5;
  if (!stored || adopt) {
    p.audioMd5 = md5 ?? stored;
    // Silent when the user deliberately adopts/relinks audio (or there is no
    // recorded hash yet): no conflict banner or prompt is shown.
    tr.audioConflict = false;
  } else {
    // Only surface a mismatch when we actually have a hash to compare. A
    // matching MD5 leaves the editor completely quiet.
    tr.audioConflict = !!md5 && md5 !== stored;
  }
  return true;
}

export async function loadAudioResult(
  res: AudioFileResultLike,
  adopt = true,
  autoApply = true,
): Promise<void> {
  const epoch = loadEpoch;
  // `adopt` is true for user-initiated loads (choose / relink) and false when a
  // project opens its already-recorded audio; only the former is an edit.
  const ok = await replaceAudioFromBytes(res.data, {
    path: res.filePath,
    name: res.name,
    adopt,
    autoApply,
    md5: res.md5,
  });
  if (epoch !== loadEpoch) return;
  if (!ok) {
    toast.error(t("dialogs.audioDecodeFail"));
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
    toast.error(t("dialogs.audioDecodeFail"));
    return;
  }
  await loadAudioResult(res);
}

/** Load and cache the metronome sound (empty value clears it).
 *  `file` is a file name inside the app's metronome folder, or an absolute
 *  path from older settings. */
export async function loadMetronome(file: string): Promise<void> {
  if (!file) {
    engine.setMetronome(null);
    return;
  }
  try {
    const res = await window.api.readMetronome(file);
    if (!res?.data) {
      engine.setMetronome(null);
      return;
    }
    const buf = await engine.decode(res.data);
    engine.setMetronome(buf);
  } catch {
    engine.setMetronome(null);
  }
}

/** Play the currently-loaded metronome sound once (used as a picker preview). */
export function previewMetronome(): void {
  engine.playMetronome(1);
}
