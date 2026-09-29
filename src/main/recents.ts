import { app } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { RecentProject } from "../shared/ipc";
import log from "./logger";

/** The most-recently-opened project list (persisted, newest first). */

const MAX_RECENTS = 9;
const recents: RecentProject[] = [];

const recentsPath = (): string => join(app.getPath("userData"), "recents.json");

export function defaultRecentTitle(filePath: string): string {
  const b = basename(filePath);
  const dot = b.lastIndexOf(".");
  return dot > 0 ? b.slice(0, dot) : b;
}

export function loadRecents(): void {
  try {
    const raw = JSON.parse(readFileSync(recentsPath(), "utf-8")) as unknown;
    if (!Array.isArray(raw)) return;
    recents.length = 0;
    for (const it of raw) {
      if (!it || typeof it !== "object") continue;
      const p = (it as RecentProject).path;
      const t = (it as RecentProject).title;
      if (typeof p === "string" && p) {
        recents.push({
          path: p,
          title: typeof t === "string" && t ? t : defaultRecentTitle(p),
        });
      }
    }
    recents.length = Math.min(recents.length, MAX_RECENTS);
  } catch {
    /* no saved recents yet */
  }
}

/** Insert/refresh a recent entry (newest first) and persist. */
export function addRecent(filePath: string, title?: string): void {
  if (typeof filePath !== "string" || !filePath) return;
  const i = recents.findIndex((r) => r.path === filePath);
  if (i >= 0) recents.splice(i, 1);
  recents.unshift({
    path: filePath,
    title:
      typeof title === "string" && title.trim()
        ? title.trim()
        : defaultRecentTitle(filePath),
  });
  recents.length = Math.min(recents.length, MAX_RECENTS);
  persistRecents();
}

export function getRecents(): RecentProject[] {
  return recents.map((r) => ({ ...r }));
}

function persistRecents(): void {
  try {
    writeFileSync(recentsPath(), JSON.stringify(recents, null, 2), "utf-8");
  } catch (err) {
    log.error("persist recents failed", err);
  }
}
