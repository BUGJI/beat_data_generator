import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  addBpmPoint,
  addMarker,
  addTrack,
  moveMarker,
  removeSelectedMarkers,
  setTrackLocked,
  useProjectStore,
} from "./project";
import { selectSingleMarker } from "./selection";
import { canUndo, resetHistory } from "../services/history";

beforeEach(() => {
  setActivePinia(createPinia());
  resetHistory();
});

describe("removeSelectedMarkers", () => {
  it("returns false and records nothing when the selection is empty", () => {
    expect(removeSelectedMarkers()).toBe(false);
    expect(canUndo()).toBe(false);
  });

  it("records nothing when every selected marker is on a blocked track", () => {
    const track = addTrack("Locked", false);
    const marker = addMarker(track.id, 1);
    expect(marker).not.toBeNull();
    setTrackLocked(track.id, true);
    resetHistory();

    selectSingleMarker(marker!.id);
    expect(removeSelectedMarkers()).toBe(false);
    expect(canUndo()).toBe(false);
    expect(useProjectStore().markers).toHaveLength(1);
  });
});

describe("addBpmPoint", () => {
  it("refuses a tempo point at beat 0 so it cannot be lost on reload", () => {
    expect(addBpmPoint(0)).toBeNull();
    expect(useProjectStore().bpmPoints).toHaveLength(0);
    expect(canUndo()).toBe(false);
  });

  it("still creates points at positive beats", () => {
    expect(addBpmPoint(4)).not.toBeNull();
    expect(useProjectStore().bpmPoints).toHaveLength(1);
  });
});

describe("moveMarker", () => {
  it("does not record an undo step when the beat does not change", () => {
    const track = addTrack("T", false);
    const marker = addMarker(track.id, 1);
    resetHistory();

    expect(moveMarker(marker!.id, 1)).toBe(true);
    expect(canUndo()).toBe(false);
  });
});

describe("setTrackLocked", () => {
  it("does not record an undo step when the value is unchanged", () => {
    const track = addTrack("T", false);
    setTrackLocked(track.id, false);
    expect(canUndo()).toBe(false);
  });
});
