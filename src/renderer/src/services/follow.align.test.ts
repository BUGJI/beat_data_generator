import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Startup alignment for manual follow. The regression under test: a playhead
 * that is already on screen — including the smooth-follow lag left over from
 * the previous run, which parks it past the right anchor — must not be snapped
 * to the anchor on play, or the timeline visibly jumps backwards on every
 * pause/resume.
 */

const h = vi.hoisted(() => ({
  settings: { settings: { followPercent: 90 } },
  view: { vw: 1000, x: 0, y: 0, pxPerSec: 100 },
  scrolls: [] as Array<{ x: number; y: number }>,
}));

vi.mock("../stores/settings", () => ({ useSettingsStore: () => h.settings }));
vi.mock("../stores/view", () => ({
  useViewStore: () => h.view,
  setScroll: (x: number, y: number) => {
    // Mirror the real store's non-negative clamp so tests see the same values.
    h.view.x = Math.max(0, x);
    h.view.y = y;
    h.scrolls.push({ x: h.view.x, y });
  },
}));

import { alignViewForPlayback } from "./follow";

/** playhead at `sec` seconds with the right anchor at 900px. */
const playheadMs = (sec: number): number => sec * 1000;

beforeEach(() => {
  h.settings.settings.followPercent = 90;
  Object.assign(h.view, { vw: 1000, x: 0, y: 0, pxPerSec: 100 });
  h.scrolls.length = 0;
});

describe("alignViewForPlayback", () => {
  it("leaves a playhead inside the safe zone alone", () => {
    h.view.x = 500;
    alignViewForPlayback(playheadMs(6)); // 600px on screen
    expect(h.scrolls).toEqual([]);
  });

  it("does not snap a visible playhead past the right anchor (follow lag)", () => {
    // 950px content with the view at 40px: on screen at 910px, i.e. the 10px
    // lag the smooth follow leaves behind — previously snapped to 900px.
    h.view.x = 40;
    alignViewForPlayback(playheadMs(9.5));
    expect(h.scrolls).toEqual([]);
  });

  it("does not snap a visible playhead before the left anchor", () => {
    h.view.x = 500;
    alignViewForPlayback(playheadMs(5.2)); // 520px on screen
    expect(h.scrolls).toEqual([]);
  });

  it("recentres a playhead that is off-screen to the right", () => {
    h.view.x = 0;
    alignViewForPlayback(playheadMs(12)); // 1200px, viewport ends at 1000
    expect(h.scrolls).toEqual([{ x: 300, y: 0 }]);
  });

  it("recentres a playhead that is off-screen to the left", () => {
    h.view.x = 600;
    alignViewForPlayback(playheadMs(5)); // 500px content, on screen at -100
    expect(h.scrolls).toEqual([{ x: 400, y: 0 }]);
  });

  it("ignores a zero-width viewport", () => {
    h.view.vw = 0;
    alignViewForPlayback(playheadMs(12));
    expect(h.scrolls).toEqual([]);
  });
});
