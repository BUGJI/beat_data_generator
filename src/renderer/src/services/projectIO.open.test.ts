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
  },
  computePeaks: () => ({
    blockSamples: 512,
    minMax: new Float32Array(0),
    durationMs: 1000,
    sampleRate: 44100,
  }),
}));

vi.mock("../analysis", () => ({
  onAudioLoaded: async () => {},
}));

vi.mock("./playback", () => ({ stop: () => {} }));

import { ensureDefaultTrack, useProjectStore } from "../stores/project";
import { loadAudioResult } from "./audioIO";
import { openProject } from "./projectIO";

function projectDoc(audioName: string | null, audioMd5: string | null) {
  return {
    app: "beat-data-generator",
    version: 2,
    name: "Song",
    baseBpm: 120,
    offsetMs: 0,
    audioName,
    audioMd5,
    bpmLocked: false,
    tracks: [{ id: "t1", name: "Marker 1", color: "#38bdf8" }],
    markers: [],
    bpmPoints: [],
    notes: [],
  };
}

function audioResult(md5: string) {
  return {
    data: new Uint8Array([1]),
    filePath: "C:/x/song.mp3",
    name: "song.mp3",
    md5,
  };
}

function mockOpenApi(doc: unknown, audio: unknown) {
  window.api = {
    readTextFile: async () => ({
      canceled: false,
      filePath: "C:/x/song.bdg",
      content: JSON.stringify(doc),
    }),
    readAudioFile: async () => audio,
    computeMd5: async () => "abc",
    recordRecent: async () => {},
  } as unknown as typeof window.api;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("startup blank project", () => {
  it("does not mark the default track as an unsaved edit", () => {
    ensureDefaultTrack();
    expect(useProjectStore().tracks).toHaveLength(1);
    expect(useProjectStore().dirty).toBe(false);
  });
});

describe("openProject", () => {
  it("stays clean while silently loading matching audio", async () => {
    mockOpenApi(projectDoc("song.mp3", "abc"), audioResult("abc"));
    const p = useProjectStore();
    await openProject("C:/x/song.bdg");
    expect(p.audioName).toBe("song.mp3");
    expect(p.audioMd5).toBe("abc");
    expect(p.dirty).toBe(false);
  });

  it("stays clean when the audio MD5 does not match", async () => {
    mockOpenApi(projectDoc("song.mp3", "expected"), audioResult("different"));
    const p = useProjectStore();
    await openProject("C:/x/song.bdg");
    expect(p.dirty).toBe(false);
    expect(p.audioMd5).toBe("expected");
  });

  it("stays clean when the project has no audio", async () => {
    mockOpenApi(projectDoc(null, null), null);
    const p = useProjectStore();
    await openProject("C:/x/song.bdg");
    expect(p.dirty).toBe(false);
  });
});

describe("loadAudioResult", () => {
  it("marks the project dirty when the user adopts new audio", async () => {
    const p = useProjectStore();
    await loadAudioResult(audioResult("abc"));
    expect(p.dirty).toBe(true);
  });
});
