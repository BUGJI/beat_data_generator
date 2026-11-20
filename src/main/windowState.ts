import type { BrowserWindow } from "electron";
import { app } from "electron";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "./jsonStore";

/** Persisted main-window geometry (only used when "remember window" is on). */

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

const windowStatePath = (): string =>
  join(app.getPath("userData"), "window-state.json");

export function loadWindowState(remember: boolean): WindowState | null {
  if (!remember) return null;
  const raw = readJson<Partial<WindowState>>(windowStatePath(), () => ({}));
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : undefined,
    y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : undefined,
    width,
    height,
    maximized: raw.maximized === true,
  };
}

export function saveWindowState(
  win: BrowserWindow | null,
  remember: boolean,
): void {
  if (!win || win.isDestroyed() || !remember) return;
  const bounds = win.getNormalBounds();
  writeJsonAtomic(windowStatePath(), {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized: win.isMaximized(),
  });
}
