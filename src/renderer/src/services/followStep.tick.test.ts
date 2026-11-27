import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stateful regression tests for the step-follow cursor: activation, boundary
 * jumps, hold priority, live setting changes and backward jumps. The pure math
 * is covered in followStep.test.ts; here the stores and the audio clock are
 * replaced with plain objects so every tick is deterministic.
 */

const h = vi.hoisted(() => ({
  engine: { playing: true },
  transport: {
    playing: true,
    countingIn: false,
    followActive: true,
    followLocked: false,
  },
  settings: {
    settings: {
      followMode: "step",
      followScroll: true,
      followStepBeats: 1,
      followPercent: 90,
    },
  },
  view: { vw: 1000, vh: 200, x: 0, y: 0, pxPerSec: 400 },
  held: false,
  scrolls: [] as Array<{ x: number; y: number }>,
}));

vi.mock("../engine", () => ({ engine: h.engine }));
vi.mock("../stores/settings", () => ({ useSettingsStore: () => h.settings }));
vi.mock("../stores/transport", () => ({
  useTransportStore: () => h.transport,
}));
vi.mock("../stores/view", () => ({
  useViewStore: () => h.view,
  setScroll: (x: number, y: number) => {
    // Mirror the real store's non-negative clamp so tests see the same values.
    h.view.x = Math.max(0, x);
    h.view.y = y;
    h.scrolls.push({ x: h.view.x, y });
  },
}));
vi.mock("./timeline", () => ({
  // 120 BPM: one beat is 500 ms.
  beatOfTime: (ms: number) => ms / 500,
  timeOfBeat: (beat: number) => beat * 500,
}));
vi.mock("./follow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./follow")>()),
  isFollowHeld: () => h.held,
}));

import {
  armStepFollow,
  resetStepFollow,
  startStepFollow,
  tickDiscreteFollow,
  tickPageFollow,
  tickStepFollow,
} from "./followStep";

beforeEach(() => {
  Object.assign(h.transport, {
    playing: true,
    countingIn: false,
    followActive: true,
    followLocked: false,
  });
  Object.assign(h.settings.settings, {
    followMode: "step",
    followScroll: true,
    followStepBeats: 1,
    followPercent: 90,
  });
  h.engine.playing = true;
  h.held = false;
  h.view.x = 0;
  h.view.y = 0;
  h.view.vw = 1000;
  h.view.pxPerSec = 400;
  h.scrolls.length = 0;
  resetStepFollow(0);
});

describe("tickStepFollow", () => {
  it("jumps once per step and pins the boundary at the left anchor", () => {
    tickStepFollow(499);
    expect(h.view.x).toBeCloseTo(0, 6);

    tickStepFollow(501);
    expect(h.view.x).toBeCloseTo(100, 6);

    tickStepFollow(1001);
    expect(h.view.x).toBeCloseTo(300, 6);
    expect(h.scrolls).toHaveLength(2);
    expect(h.scrolls[0]?.x).toBeCloseTo(100, 6);
    expect(h.scrolls[1]?.x).toBeCloseTo(300, 6);
  });

  it("engages auto-scroll switched on during playback", () => {
    h.transport.followActive = false;
    // The activation tick re-seeds the cursor at the current beat.
    tickStepFollow(501);
    expect(h.transport.followActive).toBe(true);
    expect(h.view.x).toBeCloseTo(0, 6);

    tickStepFollow(1001);
    expect(h.view.x).toBeCloseTo(300, 6);
  });

  it("keeps a locked follow off even when auto-scroll is on", () => {
    h.transport.followActive = false;
    h.transport.followLocked = true;
    tickStepFollow(1001);
    expect(h.transport.followActive).toBe(false);
    expect(h.view.x).toBeCloseTo(0, 6);
  });

  it("does nothing in smooth mode, while counting in or when paused", () => {
    h.settings.settings.followMode = "smooth";
    tickStepFollow(1001);
    expect(h.view.x).toBeCloseTo(0, 6);

    h.settings.settings.followMode = "step";
    h.transport.countingIn = true;
    tickStepFollow(1001);
    expect(h.view.x).toBeCloseTo(0, 6);

    h.transport.countingIn = false;
    h.engine.playing = false;
    tickStepFollow(1001);
    expect(h.view.x).toBeCloseTo(0, 6);
  });

  it("defers jumps while a manual pan/zoom hold is active", () => {
    h.held = true;
    tickStepFollow(501);
    expect(h.view.x).toBeCloseTo(0, 6);

    h.held = false;
    // Activation is deferred to the first tick after the hold ends.
    tickStepFollow(502);
    expect(h.view.x).toBeCloseTo(0, 6);

    tickStepFollow(1001);
    expect(h.view.x).toBeCloseTo(300, 6);
  });

  it("re-anchors after the playhead jumps backwards (loop / seek)", () => {
    tickStepFollow(499);
    tickStepFollow(501);
    expect(h.view.x).toBeCloseTo(100, 6);

    tickStepFollow(400);
    expect(h.view.x).toBeCloseTo(60, 6);
  });

  it("restarts the boundary cursor when the step size changes live", () => {
    tickStepFollow(499);
    tickStepFollow(501);
    expect(h.view.x).toBeCloseTo(100, 6);

    h.settings.settings.followStepBeats = 2;
    tickStepFollow(1050);
    expect(h.view.x).toBeCloseTo(100, 6);

    tickStepFollow(2001);
    expect(h.view.x).toBeCloseTo(700, 6);
  });

  it("never scrolls backwards when the target is left of the current offset", () => {
    tickStepFollow(499);
    tickStepFollow(501);
    h.view.x = 600;

    tickStepFollow(1001);
    expect(h.view.x).toBeCloseTo(600, 6);
  });
});

describe("tickPageFollow", () => {
  const usePageMode = (): void => {
    h.settings.settings.followMode = "page";
  };

  it("waits for the right edge, then shifts exactly one page", () => {
    usePageMode();
    // Playhead at 500px (right anchor is 900px): nothing yet.
    tickPageFollow(1250);
    expect(h.view.x).toBeCloseTo(0, 6);

    // 1000px: crosses the right edge, lands on the left anchor (100px).
    tickPageFollow(2500);
    expect(h.view.x).toBeCloseTo(900, 6);

    // 1200px is back inside the new page: no further jump.
    tickPageFollow(3000);
    expect(h.view.x).toBeCloseTo(900, 6);
  });

  it("engages auto-scroll switched on during playback", () => {
    usePageMode();
    h.transport.followActive = false;
    tickPageFollow(2500);
    expect(h.transport.followActive).toBe(true);
    expect(h.view.x).toBeCloseTo(900, 6);
  });

  it("respects lock, hold and paused states", () => {
    usePageMode();
    h.transport.followActive = false;
    h.transport.followLocked = true;
    tickPageFollow(2500);
    expect(h.view.x).toBeCloseTo(0, 6);

    h.transport.followLocked = false;
    h.held = true;
    tickPageFollow(2500);
    expect(h.view.x).toBeCloseTo(0, 6);

    h.held = false;
    h.engine.playing = false;
    tickPageFollow(2500);
    expect(h.view.x).toBeCloseTo(0, 6);
  });

  it("pulls an off-screen-left playhead back into view", () => {
    usePageMode();
    h.view.x = 900;
    tickPageFollow(0);
    expect(h.view.x).toBeCloseTo(0, 6);
  });

  it("is dispatched from the engine tick", () => {
    usePageMode();
    tickDiscreteFollow(2500);
    expect(h.view.x).toBeCloseTo(900, 6);
  });
});

describe("startStepFollow / armStepFollow", () => {
  it("keeps an on-screen view still and recentres an off-screen playhead", () => {
    h.view.x = 300;
    startStepFollow(1000);
    expect(h.view.x).toBeCloseTo(300, 6);

    h.view.x = 0;
    startStepFollow(4000);
    expect(h.view.x).toBeCloseTo(1500, 6);
  });

  it("snaps to the left anchor when re-arming after a backward jump", () => {
    armStepFollow(1000);
    expect(h.view.x).toBeCloseTo(300, 6);
  });
});
