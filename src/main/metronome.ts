import { app } from "electron";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { MetronomeFile } from "../shared/ipc";
import log from "./logger";

/** The user's metronome-sounds folder and its bundled preset seeding. */

const METRONOME_EXTS = new Set([
  "mp3",
  "wav",
  "ogg",
  "flac",
  "m4a",
  "aac",
  "opus",
  "webm",
]);

export const metronomeDir = (): string =>
  join(app.getPath("userData"), "metronomes");

/** Audio files in the metronome folder, sorted and labelled without extension. */
export function listMetronomeFiles(): MetronomeFile[] {
  try {
    const out: MetronomeFile[] = [];
    for (const e of readdirSync(metronomeDir(), { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const dot = e.name.lastIndexOf(".");
      if (dot <= 0) continue;
      if (!METRONOME_EXTS.has(e.name.slice(dot + 1).toLowerCase())) continue;
      out.push({ name: e.name.slice(0, dot), file: e.name });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  } catch {
    return [];
  }
}

/** Locate the metronome presets that ship with the app (dev or packaged). */
function bundledMetronomeDir(): string {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "metronomes")]
    : [
        join(app.getAppPath(), "resources", "metronomes"),
        join(process.cwd(), "resources", "metronomes"),
      ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0]!;
}

/** Copy bundled presets into the user's metronome folder (never overwriting). */
export function seedMetronomePresets(): void {
  const dest = metronomeDir();
  try {
    mkdirSync(dest, { recursive: true });
    const src = bundledMetronomeDir();
    if (!existsSync(src)) return;
    for (const e of readdirSync(src, { withFileTypes: true })) {
      if (!e.isFile()) continue;
      const to = join(dest, e.name);
      if (existsSync(to)) continue;
      copyFileSync(join(src, e.name), to);
    }
  } catch (err) {
    log.error("[metronome] seed presets failed", err);
  }
}
