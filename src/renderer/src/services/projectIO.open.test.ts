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
import { useTransportStore } from "../stores/transport";
import { loadAudioResult } from "./audioIO";
import { openProject } from "./projectIO";

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

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

  it("drops an in-flight load when another project is opened mid-check", async () => {
    const p = useProjectStore();
    const tr = useTransportStore();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let audioCalls = 0;
    window.api = {
      readTextFile: async (path: string) => ({
        canceled: false,
        filePath: path,
        content: JSON.stringify(
          path.includes("first")
            ? projectDoc("first.mp3", "md5-first")
            : projectDoc("second.mp3", "md5-second"),
        ),
      }),
      readAudioFile: async () => {
        const first = audioCalls++ === 0;
        if (first) await firstGate;
        return {
          data: new Uint8Array([1]),
          filePath: first ? "C:/first.mp3" : "C:/second.mp3",
          name: first ? "first.mp3" : "second.mp3",
          md5: first ? "md5-first" : "md5-second",
        };
      },
      computeMd5: async () => null,
      recordRecent: async () => {},
    } as unknown as typeof window.api;

    const first = openProject("C:/first.bdg");
    await flush();
    const second = openProject("C:/second.bdg");
    await flush();
    releaseFirst();
    await Promise.all([first, second]);

    expect(p.audioName).toBe("second.mp3");
    expect(p.audioMd5).toBe("md5-second");
    expect(tr.audioConflict).toBe(false);
  });
});

describe("loadAudioResult", () => {
  it("marks the project dirty when the user adopts new audio", async () => {
    const p = useProjectStore();
    await loadAudioResult(audioResult("abc"));
    expect(p.dirty).toBe(true);
  });
});
