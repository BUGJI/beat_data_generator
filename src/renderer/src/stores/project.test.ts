import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  addBpmPoint,
  addMarker,
  addTrack,
  moveMarker,
  removeSelectedMarkers,
  setBpmGridDiv,
  setBpmLocked,
  setGridDiv,
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

describe("grid divisions", () => {
  it("records a global grid change once", () => {
    setGridDiv(8);
    expect(useProjectStore().gridDiv).toBe(8);
    expect(canUndo()).toBe(true);

    resetHistory();
    setGridDiv(8);
    expect(canUndo()).toBe(false);
  });

  it("sets and clears a BPM point override", () => {
    const point = addBpmPoint(4)!;
    resetHistory();

    setBpmGridDiv(point.id, 16);
    expect(point.gridDiv).toBe(16);
    expect(canUndo()).toBe(true);

    resetHistory();
    setBpmGridDiv(point.id, null);
    expect(point.gridDiv).toBeUndefined();
    expect(canUndo()).toBe(true);
  });

  it("ignores grid overrides while BPM is locked", () => {
    const point = addBpmPoint(4)!;
    setBpmLocked(true);
    resetHistory();

    setBpmGridDiv(point.id, 16);
    expect(point.gridDiv).toBeUndefined();
    expect(canUndo()).toBe(false);
  });
});
