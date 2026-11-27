import { useSettingsStore } from "../stores/settings";
import { useViewStore, setScroll } from "../stores/view";

/**
 * Playhead follow math, hold window for manual pan/zoom, and startup
 * alignment. The decision functions are pure so they can be unit tested.
 */

export interface FollowInput {
  active: boolean;
  locked: boolean;
  enabled: boolean;
  playheadPx: number;
  viewX: number;
  viewportW: number;
  followPercent: number;
}

export interface FollowDecision {
  active: boolean;
  targetX: number | null;
}

export interface FollowBounds {
  left: number;
  right: number;
}

export const FOLLOW_TAU_MS = 90;
export const FOLLOW_SNAP_PX = 0.5;
export const FOLLOW_HOLD_MS = 1000;

export function followBounds(
  viewportW: number,
  followPercent: number,
): FollowBounds {
  const f = Math.min(1, Math.max(0, followPercent / 100));
  return {
    right: viewportW * f,
    left: viewportW * Math.min(f, 1 - f),
  };
}

export function followDecision(input: FollowInput): FollowDecision {
  if (input.viewportW <= 0) {
    return { active: input.active, targetX: null };
  }
  const { left, right } = followBounds(input.viewportW, input.followPercent);
  const s = input.playheadPx - input.viewX;
  if (!input.active) {
    if (!input.enabled || input.locked) {
      return { active: false, targetX: null };
    }
    if (s > right) {
      return { active: true, targetX: input.playheadPx - right };
    }
    return { active: false, targetX: null };
  }
  if (s > right) {
    return { active: true, targetX: input.playheadPx - right };
  }
  if (s < left) {
    return { active: true, targetX: input.playheadPx - left };
  }
  return { active: true, targetX: null };
}

export function smoothScrollX(
  currentX: number,
  targetX: number,
  dtMs: number,
  animEnabled: boolean,
  tauMs = FOLLOW_TAU_MS,
): number {
  if (!animEnabled || tauMs <= 0) return targetX;
  if (dtMs <= 0) return currentX;
  const dx = targetX - currentX;
  if (Math.abs(dx) <= FOLLOW_SNAP_PX) return targetX;
  const k = 1 - Math.exp(-dtMs / tauMs);
  return currentX + dx * k;
}

let holdUntil = 0;

export function holdFollow(ms = FOLLOW_HOLD_MS): void {
  holdUntil = performance.now() + Math.max(0, ms);
}

export function isFollowHeld(now = performance.now()): boolean {
  return now < holdUntil;
}

export function clearFollowHold(): void {
  holdUntil = 0;
}

/**
 * Bring the playhead into the safe zone before playback starts, but only when
 * it is off-screen. A playhead that is already visible must be left alone: the
 * smooth follow eases toward its anchor over the first frames, while snapping
 * it here would collapse the previous run's follow lag in a single frame and
 * read as the timeline jumping backwards on every pause/resume.
 */
export function alignViewForPlayback(playheadMs: number): void {
  const view = useViewStore();
  if (view.vw <= 0) return;
  const playheadPx = (playheadMs / 1000) * view.pxPerSec;
  const s = playheadPx - view.x;
  if (s >= 0 && s <= view.vw) return;
  const { left, right } = followBounds(
    view.vw,
    useSettingsStore().settings.followPercent,
  );
  setScroll(playheadPx - (s > right ? right : left), view.y);
}
