import { app, crashReporter } from "electron";
import { type Dirent, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import log from "./logger";

/** How deep to search Crashpad's nested report folders for a dump file. */
const MAX_DUMP_DEPTH = 4;

/**
 * Start Crashpad locally (no upload). It must run before any window exists so
 * renderer crashes are captured, so this is called at main-process load time.
 */
export function installCrashReporter(): void {
  try {
    crashReporter.start({ uploadToServer: false });
  } catch (err) {
    log.error("[crash] failed to start crash reporter", err);
  }
}

export function crashDumpsDir(): string {
  return app.getPath("crashDumps");
}

/** Newest `.dmp` under `dir`, or null when there is none (incl. unreadable). */
export function newestCrashDump(dir: string): string | null {
  const found: { path: string | null; time: number } = {
    path: null,
    time: 0,
  };
  const walk = (current: string, depth: number): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (depth < MAX_DUMP_DEPTH) walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".dmp"))
        continue;
      try {
        const time = statSync(full).mtimeMs;
        if (time > found.time) {
          found.time = time;
          found.path = full;
        }
      } catch {
        /* unreadable dump: keep the previous best */
      }
    }
  };
  walk(dir, 0);
  return found.path;
}

/**
 * Log where the dump landed. Crashpad writes it asynchronously after the
 * process is gone, so call this a moment after `render-process-gone`.
 */
export function logCrashDump(): void {
  const dir = crashDumpsDir();
  const dump = newestCrashDump(dir);
  if (dump) log.error(`[crash] dump written: ${dump}`);
  else log.error(`[crash] no .dmp found under ${dir}`);
}
