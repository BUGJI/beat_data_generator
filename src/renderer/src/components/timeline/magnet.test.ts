import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useProjectStore } from "../../stores/project";
import { useTransportStore } from "../../stores/transport";
import { useViewStore } from "../../stores/view";
import { magnetBeat } from "./magnet";

beforeEach(() => {
  setActivePinia(createPinia());
  const project = useProjectStore();
  project.baseBpm = 120;
  project.offsetMs = 0;
  project.tracks = [{ id: "t1", name: "Main", color: "#fff" }];
  project.markers = [{ id: "m1", trackId: "t1", beat: 4 }];
  project.notes = [];
  const view = useViewStore();
  view.pxPerSec = 100;
  view.snapEnabled = true;
  view.magnetEnabled = true;
  useTransportStore().positionMs = 0;
});

describe("magnetBeat", () => {
  it("snaps to a marker inside the pixel threshold", () => {
    expect(magnetBeat(205)).toBe(4);
    expect(magnetBeat(400)).toBeNull();
  });

  it("ignores excluded markers", () => {
    expect(magnetBeat(205, new Set(["m1"]))).toBeNull();
  });

  it("snaps to the playhead", () => {
    useTransportStore().positionMs = 2000;
    expect(magnetBeat(202)).toBe(4);
  });
});
