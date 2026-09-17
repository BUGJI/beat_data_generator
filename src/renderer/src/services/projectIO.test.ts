import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useProjectStore } from "../stores/project";
import { edlContent, exportLines, projectJson } from "./projectIO";

function setupProject() {
  const p = useProjectStore();
  p.name = "My Song";
  p.baseBpm = 120;
  p.offsetMs = 0;
  p.audioName = null;
  p.tracks = [
    { id: "t1", name: "Main", color: "#fff" },
    { id: "t2", name: "Alt", color: "#000" },
  ];
  p.markers = [];
  p.bpmPoints = [];
  p.notes = [];
  return p;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("exportLines", () => {
  it("exports sorted, de-duplicated millisecond timestamps", () => {
    const p = setupProject();
    p.markers = [
      { id: "m3", trackId: "t1", beat: 2 },
      { id: "m1", trackId: "t1", beat: 0 },
      { id: "m2", trackId: "t2", beat: 1 },
      { id: "dup", trackId: "t2", beat: 1 },
    ];
    expect(exportLines()).toEqual(["0.000", "500.000", "1000.000"]);
  });

  it("excludes hidden and plugin-typed tracks", () => {
    const p = setupProject();
    p.tracks = [
      { id: "t1", name: "Main", color: "#fff" },
      { id: "hidden", name: "H", color: "#fff", hidden: true },
      { id: "typed", name: "T", color: "#fff", type: "plug:x" },
    ];
    p.markers = [
      { id: "a", trackId: "t1", beat: 1 },
      { id: "b", trackId: "hidden", beat: 2 },
      { id: "c", trackId: "typed", beat: 3 },
    ];
    expect(exportLines()).toEqual(["500.000"]);
  });
});

describe("edlContent", () => {
  it("is empty when there are no visible markers", () => {
    setupProject();
    const { count, text } = edlContent();
    expect(count).toBe(0);
    expect(text).toContain("TITLE: My Song");
    expect(text).toContain("FCM: NON-DROP FRAME");
  });

  it("emits one 1-frame CMX3600 event per distinct marker time", () => {
    const p = setupProject();
    p.audioName = "C:/music/song.mp3";
    p.markers = [
      { id: "a", trackId: "t1", beat: 0 },
      { id: "b", trackId: "t2", beat: 0 },
    ];
    const { count, text } = edlContent();
    expect(count).toBe(1);
    expect(text).toContain(
      "001  AX       V     C        00:00:00:00 00:00:00:01 00:00:00:00 00:00:00:01",
    );
    expect(text).toContain("* FROM CLIP NAME: song.mp3");
  });
});

describe("projectJson", () => {
  it("round-trips through the project schema", () => {
    const p = setupProject();
    p.markers = [{ id: "m1", trackId: "t1", beat: 1.5 }];
    p.bpmPoints = [{ id: "b1", beat: 4, mode: "abs", value: 130 }];
    p.notes = [{ id: "n1", timeMs: 10, y: 5, text: "note" }];

    const raw = JSON.parse(projectJson()) as {
      version: number;
      markers: unknown[];
      bpmPoints: { value: number }[];
    };
    expect(raw.version).toBe(2);
    expect(raw.markers).toHaveLength(1);
    expect(raw.bpmPoints[0].value).toBe(130);
  });
});
