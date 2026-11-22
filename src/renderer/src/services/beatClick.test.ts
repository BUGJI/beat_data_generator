import { describe, expect, it } from "vitest";
import {
  BeatClickScheduler,
  type BeatClickClock,
  type BeatClickEvent,
} from "./beatClick";

function clock(over: Partial<BeatClickClock> = {}): BeatClickClock {
  return {
    ctxTime: 10,
    startCtxTime: 10,
    startPosMs: 0,
    speed: 1,
    epoch: 1,
    ...over,
  };
}

function events(...times: number[]): BeatClickEvent[] {
  return times.map((t, i) => ({ t, n: i + 1, accent: false }));
}

function recorder(): {
  calls: Array<{ when: number; count: number; accent: boolean }>;
  sink: (when: number, count: number, accent: boolean) => void;
} {
  const calls: Array<{ when: number; count: number; accent: boolean }> = [];
  return {
    calls,
    sink: (when, count, accent) => calls.push({ when, count, accent }),
  };
}

describe("BeatClickScheduler", () => {
  it("schedules only the lookahead window and each event once", () => {
    const scheduler = new BeatClickScheduler();
    const ev = events(0, 100, 300, 700);
    const { calls, sink } = recorder();
    const opts = { lookaheadSec: 0.2, loopEndMs: null, schedule: sink };

    scheduler.tick(clock(), ev, opts);
    expect(calls.map((c) => c.when)).toEqual([10, 10.1]);

    scheduler.tick(clock(), ev, opts);
    expect(calls).toHaveLength(2);

    scheduler.tick(clock({ ctxTime: 10.3 }), ev, opts);
    expect(calls.map((c) => c.when)).toEqual([10, 10.1, 10.3]);
  });

  it("maps project time through the playback speed", () => {
    const scheduler = new BeatClickScheduler();
    const { calls, sink } = recorder();
    scheduler.tick(clock({ ctxTime: 10, speed: 2 }), events(0, 200), {
      lookaheadSec: 0.2,
      loopEndMs: null,
      schedule: sink,
    });
    // 200 ms of project time at 2× is 100 ms of audio time.
    expect(calls.map((c) => c.when)).toEqual([10, 10.1]);
  });

  it("drops events that a frame stall left in the past", () => {
    const scheduler = new BeatClickScheduler();
    const { calls, sink } = recorder();
    scheduler.tick(clock({ ctxTime: 10.5 }), events(0, 100, 300), {
      lookaheadSec: 0.2,
      loopEndMs: null,
      schedule: sink,
    });
    expect(calls).toEqual([]);
  });

  it("resets the cursor when the audio clock restarts", () => {
    const scheduler = new BeatClickScheduler();
    const ev = events(0, 100, 1000, 1100);
    const { calls, sink } = recorder();
    const opts = { lookaheadSec: 0.2, loopEndMs: null, schedule: sink };

    scheduler.tick(clock(), ev, opts);
    expect(calls.map((c) => c.when)).toEqual([10, 10.1]);

    // A seek/loop moved the run start to 1000 ms at ctx time 20.
    scheduler.tick(
      clock({
        ctxTime: 20,
        startCtxTime: 20,
        startPosMs: 1000,
        epoch: 2,
      }),
      ev,
      opts,
    );
    expect(calls.map((c) => c.when)).toEqual([10, 10.1, 20, 20.1]);
  });

  it("stops scheduling at the loop end until the clock wraps", () => {
    const scheduler = new BeatClickScheduler();
    const ev = events(0, 100, 300, 400);
    const { calls, sink } = recorder();
    scheduler.tick(clock(), ev, {
      lookaheadSec: 10,
      loopEndMs: 300,
      schedule: sink,
    });
    expect(calls.map((c) => c.when)).toEqual([10, 10.1]);

    scheduler.tick(
      clock({ ctxTime: 10.1, startCtxTime: 10.1, startPosMs: 0, epoch: 2 }),
      ev,
      { lookaheadSec: 10, loopEndMs: 300, schedule: sink },
    );
    expect(calls.map((c) => c.when)).toEqual([10, 10.1, 10.1, 10.2]);
  });
});
