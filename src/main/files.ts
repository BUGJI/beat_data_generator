import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, posix, win32 } from "node:path";
import type { AudioFileResult, IpcFileFilter } from "../shared/ipc";

/** File filters and helpers shared by the native-dialog IPC handlers. */

/** Extensions the editor can decode as audio (lowercase, no dot). */
export const AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "ogg",
  "flac",
  "m4a",
  "aac",
  "opus",
] as const;

export const AUDIO_FILTERS = [
  {
    name: "Audio",
    extensions: [...AUDIO_EXTENSIONS],
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

/**
 * True when a renderer-supplied path is a non-empty absolute string.
 *
 * Both path flavours are accepted regardless of host OS: the renderer may send
 * Windows paths to a Linux build or vice versa, and accepting a well-formed
 * absolute path only gates the dialog/IPC call, not any filesystem access.
 */
export function isAbsoluteFileArg(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    (posix.isAbsolute(value) || win32.isAbsolute(value))
  );
}

/**
 * Check the on-disk size before reading, so an oversized file is refused
 * instead of being allocated in full first. Missing/unreadable files fail.
 */
export async function fileSizeWithin(
  filePath: string,
  maxBytes: number,
): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size <= maxBytes;
  } catch {
    return false;
  }
}

/** UTF-8 byte length without allocating a Buffer for the common ASCII case. */
export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

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
