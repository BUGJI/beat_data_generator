import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useProjectStore } from "../stores/project";
import { resetTapTempo, tapTempo, tapTempoState } from "./tapTempo";

beforeEach(() => {
  setActivePinia(createPinia());
  resetTapTempo();
});

describe("tapTempo", () => {
  it("derives BPM from the median tap interval", () => {
    tapTempo(0);
    tapTempo(500);
    tapTempo(1000);
    tapTempo(1500);
    expect(tapTempoState.count).toBe(4);
    expect(tapTempoState.bpm).toBe(120);
    expect(useProjectStore().baseBpm).toBe(120);
  });

  it("starts over after a long pause", () => {
    tapTempo(0);
    tapTempo(500);
    tapTempo(3000);
    expect(tapTempoState.count).toBe(1);
    expect(tapTempoState.bpm).toBe(120);
  });

  it("ignores a single tap", () => {
    tapTempo(0);
    expect(tapTempoState.bpm).toBeNull();
    expect(useProjectStore().baseBpm).toBe(120);
  });
});
