import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("../engine", () => ({
  engine: {
    decode: async () => ({
      duration: 1,
      sampleRate: 44100,
      length: 10,
      numberOfChannels: 1,
      getChannelData: () => new Float32Array(10),
    }),
    load: () => {},
    stop: () => {},
    setLoop: () => {},
  },
  computePeaks: () => ({
    blockSamples: 512,
    minMax: new Float32Array(0),
    durationMs: 1000,
    sampleRate: 44100,
  }),
}));

vi.mock("./playback", () => ({ stop: () => {} }));

import { analysis } from "../analysis";
import { addTrack, useProjectStore } from "../stores/project";
import { newProjectAt } from "./projectIO";

beforeEach(() => {
  setActivePinia(createPinia());
  window.api = {
    writeProjectFile: async () => true,
    recordRecent: async () => {},
    clearRecovery: async () => {},
  } as unknown as typeof window.api;
});

describe("newProjectAt", () => {
  it("clears analysis left over from the previous audio", async () => {
    addTrack("T", false);
    analysis.bpm = 174;
    analysis.beats = [0.1, 0.4, 0.8];
    analysis.loopStart = 1;
    analysis.loopEnd = 2;
    analysis.spectrum = [new Float32Array(8)];
    analysis.analyzing = true;

    await newProjectAt("C:/x/untitled.bdg");

    expect(analysis.bpm).toBeNull();
    expect(analysis.beats).toEqual([]);
    expect(analysis.loopStart).toBeNull();
    expect(analysis.loopEnd).toBeNull();
    expect(analysis.spectrum).toBeNull();
    expect(analysis.analyzing).toBe(false);
  });

  it("resets project state before writing the new document", async () => {
    const p = useProjectStore();
    addTrack("T", false);
    p.baseBpm = 90;
    p.markers = [{ id: "m1", trackId: "t1", beat: 1 }];
    p.name = "Old";

    await newProjectAt("C:/x/untitled.bdg");

    expect(p.baseBpm).toBe(120);
    expect(p.name).toBe("");
    expect(p.markers).toEqual([]);
    expect(p.projectPath).toBe("C:/x/untitled.bdg");
  });
});
