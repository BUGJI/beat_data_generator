import { app } from "electron";
import { join } from "node:path";
import { baseName, dirName } from "../shared/path";
import { readJson, writeJsonAtomic } from "./jsonStore";

/** Remembers the last directory used per dialog kind so pickers reopen there. */

export type DirKind = "audio" | "project";

const lastDirs: Partial<Record<DirKind, string>> = {};

const lastDirsPath = (): string =>
  join(app.getPath("userData"), "last-dirs.json");

export function loadLastDirs(): void {
  const raw = readJson<{ audio?: unknown; project?: unknown }>(
    lastDirsPath(),
    () => ({}),
  );
  if (typeof raw.audio === "string") lastDirs.audio = raw.audio;
  if (typeof raw.project === "string") lastDirs.project = raw.project;
}

export function rememberDir(kind: DirKind, filePath: string): void {
  const dir = dirName(filePath);
  if (!dir) return;
  lastDirs[kind] = dir;
  writeJsonAtomic(lastDirsPath(), lastDirs);
}

export function lastDirDefault(kind: DirKind): string | undefined {
  return lastDirs[kind] ?? undefined;
}

export function joinDefaultDir(
  kind: DirKind,
  defaultPath: string,
  dirFromPath: string,
): string | undefined {
  const base = baseName(defaultPath) || defaultPath;
  if (dirFromPath?.length) return join(dirFromPath, base);
  const dir = lastDirs[kind];
  return dir ? join(dir, base) : defaultPath;
}
