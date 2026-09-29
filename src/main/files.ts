import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { AudioFileResult, IpcFileFilter } from "../shared/ipc";

/** File filters and helpers shared by the native-dialog IPC handlers. */

export const AUDIO_FILTERS = [
  {
    name: "Audio",
    extensions: ["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus"],
  },
];

export const PROJECT_FILTERS = [
  { name: "Beat Project", extensions: ["bdg", "json"] },
];
export const TEXT_FILTERS = [{ name: "Text", extensions: ["txt", "csv"] }];
export const EDL_FILTERS = [{ name: "EDL", extensions: ["edl"] }];

export const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

/** Upper bound for a background image read over IPC (~16 MB). */
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

export async function bytesToAudioResult(
  filePath: string,
  withMd5 = false,
): Promise<AudioFileResult> {
  const buf = await readFile(filePath);
  return {
    filePath,
    name: basename(filePath),
    size: buf.byteLength,
    data: new Uint8Array(buf),
    // Hash the bytes we already read so callers needing the MD5 (project audio
    // matching) never trigger a second full read of the file.
    md5: withMd5 ? createHash("md5").update(buf).digest("hex") : null,
  };
}

/** Coerce renderer-supplied filters into safe Electron file filters. */
export function sanitizeFilters(filters: unknown): Electron.FileFilter[] {
  if (!Array.isArray(filters)) return [];
  const out: Electron.FileFilter[] = [];
  for (const f of filters) {
    if (!f || typeof f !== "object") continue;
    const cand = f as Partial<IpcFileFilter>;
    if (typeof cand.name !== "string" || !cand.name) continue;
    const extensions = Array.isArray(cand.extensions)
      ? cand.extensions.filter(
          (x): x is string =>
            typeof x === "string" && /^[A-Za-z0-9]{1,8}$/.test(x),
        )
      : [];
    if (extensions.length) {
      out.push({
        name: cand.name,
        extensions: extensions.map((x) => x.toLowerCase()),
      });
    }
  }
  return out;
}
