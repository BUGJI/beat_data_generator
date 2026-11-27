import { engine } from "../engine";
import { useSettingsStore } from "../stores/settings";
import { useTransportStore } from "../stores/transport";
import { setScroll, useViewStore } from "../stores/view";
import { followBounds, isFollowHeld } from "./follow";
import { beatOfTime, timeOfBeat } from "./timeline";

/**
 * Discrete follow modes:
 * - "step" jumps forward at fixed beat boundaries, pinning the playhead to the
 *   left safe-zone anchor with no animation;
 * - "page" leaves the view alone until the playhead reaches the right edge,
 *   then shifts one page so the playhead lands on the left edge.
 *
 * Both are driven from the engine tick, so the smooth easing loop in the
 * timeline canvas never runs for them.
 */

/** How far the playhead may move backwards before it counts as a wrap/seek. */
const BACKWARD_EPSILON_MS = 30;
/** Defensive ceiling for free-input builds; the normal UI caps the value at 16. */
const MAX_STEP_BEATS = 1024;

function normalizeStep(stepBeats: number): number {
  const n = Math.floor(stepBeats);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_STEP_BEATS, Math.max(1, n));
}

/** First trigger boundary strictly after `beat`; boundaries are multiples of `stepBeats`. */
export function nextStepBoundary(beat: number, stepBeats: number): number {
  const n = normalizeStep(stepBeats);
  return (Math.floor(beat / n) + 1) * n;
}

export interface StepAdvance {
  /** Latest boundary crossed since the cursor, or null when nothing crossed. */
  crossed: number | null;
  /** Boundary to watch next. */
  nextBeat: number;
}

/** Advance the boundary cursor to the latest crossed multiple (handles stalls). */
export function advanceStepBoundary(
  beat: number,
  nextBeat: number,
  stepBeats: number,
): StepAdvance {
  const n = normalizeStep(stepBeats);
  if (!Number.isFinite(nextBeat)) {
    return { crossed: null, nextBeat: nextStepBoundary(beat, n) };
  }
  if (beat < nextBeat) return { crossed: null, nextBeat };
  const lastCrossed = nextBeat + n * Math.floor((beat - nextBeat) / n);
  return { crossed: lastCrossed, nextBeat: lastCrossed + n };
}

/** Content-space x that places `boundaryMs` at the left anchor. */
export function stepTargetX(
  boundaryMs: number,
  pxPerSec: number,
  anchorX: number,
): number {
  return (boundaryMs / 1000) * pxPerSec - anchorX;
}

let nextBeat = Number.NaN;
let armedStepBeats = 1;
let lastSeenMs = Number.NaN;
let wasActive = false;

function stepBeatsSetting(): number {
  return normalizeStep(useSettingsStore().settings.followStepBeats);
}

function leftAnchorX(): number {
  const view = useViewStore();
  return followBounds(view.vw, useSettingsStore().settings.followPercent).left;
}

/** Recentre only when the playhead has left the viewport entirely. */
function alignStepIfOffscreen(posMs: number): void {
  const view = useViewStore();
  if (view.vw <= 0) return;
  const px = (posMs / 1000) * view.pxPerSec - view.x;
  if (px >= 0 && px <= view.vw) return;
  setScroll(stepTargetX(posMs, view.pxPerSec, leftAnchorX()), view.y);
}

/** Reset the boundary cursor without moving the viewport. */
export function resetStepFollow(posMs: number): void {
  const beat = beatOfTime(posMs);
  armedStepBeats = stepBeatsSetting();
  nextBeat = nextStepBoundary(beat, armedStepBeats);
  lastSeenMs = posMs;
  wasActive = false;
}

/**
 * Start a playback run: reset the cursor, keep an on-screen view where it is
 * and only recentre when the playhead is off-screen. The first jump (on the
 * next boundary) performs the alignment, so pressing play never snaps the view
 * by itself.
 */
export function startStepFollow(posMs: number): void {
  resetStepFollow(posMs);
  wasActive = true;
  alignStepIfOffscreen(posMs);
}

/** Reset the cursor and snap the playhead to the left anchor (loop wrap / seek). */
export function armStepFollow(posMs: number): void {
  resetStepFollow(posMs);
  wasActive = true;
  const view = useViewStore();
  if (view.vw > 0) {
    setScroll(stepTargetX(posMs, view.pxPerSec, leftAnchorX()), view.y);
  }
}

/** Per-frame tick: jump the viewport once per configured beat interval. */
export function tickStepFollow(posMs: number): void {
  const tr = useTransportStore();
  const settings = useSettingsStore();
  if (settings.settings.followMode !== "step" || !tr.playing || tr.countingIn) {
    wasActive = false;
    lastSeenMs = Number.NaN;
    return;
  }
  // `pause()` fires one final tick after the audio clock stops; ignore it so the
  // view does not jump a last time while pausing.
  if (!engine.playing) return;
  if (tr.followLocked) {
    wasActive = false;
    return;
  }
  if (!tr.followActive) {
    // Auto-scroll can be switched on mid-playback; engage it here (like the
    // smooth loop does) instead of waiting for the next playback run.
    if (!settings.settings.followScroll) {
      wasActive = false;
      return;
    }
    tr.followActive = true;
  }
  const view = useViewStore();
  if (view.vw <= 0) return;
  // Manual pan/zoom takes priority; the cursor catches up once the hold ends.
  if (isFollowHeld()) return;
  const n = stepBeatsSetting();
  const beat = beatOfTime(posMs);
  if (!wasActive) {
    // Entering step mode (play start, follow toggled on or a mode switch):
    // re-seed from the current position instead of replaying boundaries that
    // were crossed while another mode was active.
    wasActive = true;
    armedStepBeats = n;
    nextBeat = nextStepBoundary(beat, n);
    lastSeenMs = posMs;
    alignStepIfOffscreen(posMs);
    return;
  }
  // A live change of the step size restarts the boundary cursor without moving
  // the viewport, so the next jump uses the new interval.
  if (n !== armedStepBeats) {
    armedStepBeats = n;
    nextBeat = nextStepBoundary(beat, n);
  }
  if (Number.isFinite(lastSeenMs) && posMs + BACKWARD_EPSILON_MS < lastSeenMs) {
    // Loop wrap or a backward seek: re-anchor instead of jumping backwards.
    armStepFollow(posMs);
    return;
  }
  lastSeenMs = posMs;
  const step = advanceStepBoundary(beat, nextBeat, armedStepBeats);
  nextBeat = step.nextBeat;
  if (step.crossed === null) return;
  const target = stepTargetX(
    timeOfBeat(step.crossed),
    view.pxPerSec,
    leftAnchorX(),
  );
  // Never scroll backwards: after a manual pan the target can sit left of the
  // current offset, and rewinding there would undo the user's navigation.
  setScroll(Math.max(view.x, target), view.y);
}

/**
 * Page follow: the view stays put until the playhead reaches the right safe
 * zone, then shifts one page so the playhead lands on the left edge. A playhead
 * that lands off-screen to the left (backward seek / loop wrap) is pulled back
 * in the same way. No beat cursor or animation is involved.
 */
export function tickPageFollow(posMs: number): void {
  const tr = useTransportStore();
  const settings = useSettingsStore();
  if (settings.settings.followMode !== "page" || !tr.playing || tr.countingIn) {
    return;
  }
  if (!engine.playing) return;
  if (tr.followLocked) return;
  if (!tr.followActive) {
    if (!settings.settings.followScroll) return;
    tr.followActive = true;
  }
  const view = useViewStore();
  if (view.vw <= 0 || isFollowHeld()) return;
  const { left, right } = followBounds(
    view.vw,
    settings.settings.followPercent,
  );
  const playheadPx = (posMs / 1000) * view.pxPerSec;
  const screenPx = playheadPx - view.x;
  if (screenPx > right || screenPx < 0) {
    setScroll(playheadPx - left, view.y);
  }
}

/** Dispatch the discrete (non-animated) follow modes from the engine tick. */
export function tickDiscreteFollow(posMs: number): void {
  // Always tick the step state so it resets itself while another mode runs.
  tickStepFollow(posMs);
  if (useSettingsStore().settings.followMode === "page") {
    tickPageFollow(posMs);
  }
}
