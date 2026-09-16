import { toast } from "../ui/toast";
import { engine, computePeaks } from "../engine";
import { t } from "../utils/text";
import { useProjectStore } from "../stores/project";
import { useTransportStore } from "../stores/transport";
import type { AudioFileResultLike } from "../types";

/**
 * Audio loading / relinking and the renderer-side path helpers. The renderer
 * has no node `path` module, so the small helper set below mirrors the parts we
 * need (normalize, dirname, basename, join, relative).
 */

function normSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}
function dirOf(p: string): string {
  const n = normSlashes(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(0, i) : "";
}
export function baseName(p: string): string {
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
export function resolveAudioFullPath(name: string | null): string | null {
  if (!name) return null;
  const p = useProjectStore();
  const n = normSlashes(name);
  if (isAbsolutePath(n)) return n;
  const dir = dirOf(p.projectPath ?? "");
  return joinDir(dir, n);
}

/** Recompute persisted audioName relative to the current project folder. */
export function setAudioNameRelative(): void {
  const p = useProjectStore();
  const ap = p.audioPath;
  if (!ap) return;
  const rel = relativeToDir(dirOf(p.projectPath ?? ""), ap);
  p.audioName = rel ?? baseName(ap);
}

async function decodeAndApply(
  bytes: Uint8Array,
  path: string,
  name: string,
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
  // audio, honoring each independent audio-analysis setting toggle.
  void import("../analysis").then((m) => m.onAudioLoaded());
  return true;
}

export async function loadAudioResult(
  res: AudioFileResultLike,
  adopt = true,
): Promise<void> {
  const p = useProjectStore();
  const tr = useTransportStore();
  const ok = await decodeAndApply(res.data, res.filePath, res.name);
  if (!ok) {
    toast.error(t("dialogs.audioDecodeFail"));
    return;
  }
  tr.audioMissing = false;
  const md5 = await window.api.computeMd5(res.filePath);
  const stored = p.audioMd5;
  if (!stored || adopt) {
    p.audioMd5 = md5 ?? stored;
    tr.audioConflict = false;
  } else {
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

/** Load and cache the metronome click audio (empty path clears it). */
export async function loadMetronome(path: string): Promise<void> {
  if (!path) {
    engine.setMetronome(null);
    return;
  }
  try {
    const res = await window.api.readAudioFile(path);
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
