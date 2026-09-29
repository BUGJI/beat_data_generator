import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Remembers the last directory used per dialog kind so pickers reopen there. */

export type DirKind = "audio" | "project";

const lastDirs: Partial<Record<DirKind, string>> = {};

const lastDirsPath = (): string =>
  join(app.getPath("userData"), "last-dirs.json");

export function loadLastDirs(): void {
  try {
    const raw = JSON.parse(readFileSync(lastDirsPath(), "utf-8")) as {
      audio?: string;
      project?: string;
    };
    if (typeof raw.audio === "string") lastDirs.audio = raw.audio;
    if (typeof raw.project === "string") lastDirs.project = raw.project;
  } catch {
    /* no saved dirs yet */
  }
}

export function rememberDir(kind: DirKind, filePath: string): void {
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  if (slash <= 0) return;
  lastDirs[kind] = filePath.slice(0, slash);
  try {
    writeFileSync(lastDirsPath(), JSON.stringify(lastDirs, null, 2), "utf-8");
  } catch {
    /* ignore */
  }
}

export function lastDirDefault(kind: DirKind): string | undefined {
  return lastDirs[kind] ?? undefined;
}

export function joinDefaultDir(
  kind: DirKind,
  defaultPath: string,
  dirFromPath: string,
): string | undefined {
  const base = defaultPath.split(/[/]/).pop() || defaultPath;
  if (dirFromPath?.length) return join(dirFromPath, base);
  const dir = lastDirs[kind];
  return dir ? join(dir, base) : defaultPath;
}
