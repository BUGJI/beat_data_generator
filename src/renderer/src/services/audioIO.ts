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
): Promise<boolean> {
  const p = useProjectStore();
  const tr = useTransportStore();
  const buffer = await engine.decode(bytes);
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
  p.dirty = true;
  // Run pleco-xa analysis (BPM / beats / loop / spectrum) against the new
  // audio, honoring each independent audio-analysis setting toggle. Awaited so
  // callers that then mark the project clean (e.g. openProject) observe the
  // final document state; passed autoApply=false to keep an opened project
  // from being rewritten by auto-BPM / auto-beats.
  const { onAudioLoaded } = await import("../analysis");
  await onAudioLoaded(autoApply);
  return true;
}

export async function loadAudioResult(
  res: AudioFileResultLike,
  adopt = true,
  autoApply = true,
): Promise<void> {
  const p = useProjectStore();
  const tr = useTransportStore();
  const ok = await decodeAndApply(res.data, res.filePath, res.name, autoApply);
  if (!ok) {
    toast.error(t("dialogs.audioDecodeFail"));
    return;
  }
  tr.audioMissing = false;
  // Prefer the MD5 main computed alongside the read; only fall back to a
  // separate hash call when a caller passed bytes without one.
  const md5 = res.md5 ?? (await window.api.computeMd5(res.filePath));
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
