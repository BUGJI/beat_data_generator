/**
 * Lookahead scheduling for marker beat clicks.
 *
 * Firing a click from the animation-frame tick that observes a marker is
 * quantised to the display refresh and jitters with JS work, while the music is
 * started on the audio clock with sample accuracy. This scheduler instead maps
 * upcoming marker times onto absolute AudioContext times and hands them to the
 * engine a short window ahead, so clicks stay aligned and a display stall does
 * not release a burst of overdue clicks.
 *
 * The class is pure: it never touches the DOM or the engine, which keeps the
 * cursor logic unit-testable.
 */

export interface BeatClickClock {
  /** Current AudioContext time in seconds. */
  ctxTime: number;
  /** AudioContext time at which the current run started. */
  startCtxTime: number;
  /** Project position (ms) at that run start. */
  startPosMs: number;
  /** Project milliseconds per AudioContext second. */
  speed: number;
  /** Restart counter; a change invalidates the cursor. */
  epoch: number;
}

export interface BeatClickEvent {
  /** Project time in ms. */
  t: number;
  /** Coincident marker count at this instant. */
  n: number;
  /** Whether the instant falls on a bar line. */
  accent: boolean;
}

export interface BeatClickTickOptions {
  /** How far ahead of `ctxTime` clicks may be scheduled, in seconds. */
  lookaheadSec: number;
  /** Do not schedule past the loop end; the engine resets on wrap. */
  loopEndMs: number | null;
  /** Hand one click to the audio engine at an absolute context time. */
  schedule: (whenSec: number, count: number, accent: boolean) => void;
}

/** A click this long overdue is treated as skipped, not played late. */
const PAST_TOLERANCE_SEC = 0.03;

function firstEventAtOrAfter(
  events: readonly BeatClickEvent[],
  posMs: number,
): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((events[mid] as BeatClickEvent).t < posMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class BeatClickScheduler {
  private idx = 0;
  private epoch = -1;

  /** Call when the event list is rebuilt (play / seek / stop). */
  invalidate(): void {
    this.idx = 0;
    this.epoch = -1;
  }

  /**
   * Schedule every event that falls inside the lookahead window. Safe to call
   * on every frame: each event is scheduled at most once per run.
   */
  tick(
    clock: BeatClickClock,
    events: readonly BeatClickEvent[],
    opts: BeatClickTickOptions,
  ): void {
    if (clock.epoch !== this.epoch) {
      this.epoch = clock.epoch;
      this.idx = firstEventAtOrAfter(events, clock.startPosMs);
    }
    if (this.idx >= events.length) return;
    const lookahead = Math.max(0, opts.lookaheadSec);
    const speed = clock.speed > 1e-6 ? clock.speed : 1;
    const horizon = clock.ctxTime + lookahead;
    while (this.idx < events.length) {
      const ev = events[this.idx] as BeatClickEvent;
      if (opts.loopEndMs !== null && ev.t >= opts.loopEndMs) break;
      const when =
        clock.startCtxTime + (ev.t - clock.startPosMs) / 1000 / speed;
      if (when > horizon) break;
      this.idx++;
      // A frame stall can leave several events in the past; dropping them is
      // what prevents the overlapping-click burst on resume.
      if (when < clock.ctxTime - PAST_TOLERANCE_SEC) continue;
      opts.schedule(when, ev.n, ev.accent);
    }
  }
}
