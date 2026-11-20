import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import log from "./logger";

/**
 * Small, atomic JSON persistence used by the main-process stores
 * (recent projects, window state, last dirs, plugin state, market cache).
 *
 * Writes go through a sibling temp file and a rename, so a crash or full disk
 * can leave the previous file intact instead of truncated JSON. Failures are
 * reported to callers (`false`) and logged, never silently swallowed.
 */

/** Parse `path`, or return a freshly built fallback when it is missing/broken. */
export function readJson<T>(path: string, fallback: () => T): T {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback();
  }
}

let tempSeq = 0;

/** Write `value` as JSON via a temp file + rename. Returns success. */
export function writeJsonAtomic(
  path: string,
  value: unknown,
  indent: number | undefined = 2,
): boolean {
  const tmp = `${path}.tmp-${process.pid}-${++tempSeq}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, JSON.stringify(value, null, indent), "utf-8");
    renameSync(tmp, path);
    return true;
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* already gone */
    }
    log.error(`[json-store] write failed: ${path}`, err);
    return false;
  }
}
