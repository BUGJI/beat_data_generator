import { describe, it, expect } from "vitest";
import {
  APP_ID,
  PROJECT_VERSION,
  BeatProjectSchema,
  parseProjectDocument,
} from "./project";

const v2 = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  app: APP_ID,
  version: PROJECT_VERSION,
  name: "Song",
  baseBpm: 128,
  offsetMs: 12,
  audioName: "audio/song.mp3",
  audioMd5: "abc",
  bpmLocked: true,
  tracks: [{ id: "t1", name: "Track", color: "#fff" }],
  markers: [{ id: "m1", trackId: "t1", beat: 1.5 }],
  bpmPoints: [],
  notes: [],
  ...overrides,
});

describe("parseProjectDocument / rejection", () => {
  it("rejects input that is not a project", () => {
    expect(parseProjectDocument(null)).toBeNull();
    expect(parseProjectDocument(42)).toBeNull();
    expect(parseProjectDocument({})).toBeNull();
    expect(parseProjectDocument({ app: "other", markers: [] })).toBeNull();
    expect(parseProjectDocument({ app: APP_ID })).toBeNull();
  });
});

describe("parseProjectDocument / v2", () => {
  it("parses a valid v2 document", () => {
    const parsed = parseProjectDocument(v2());
    expect(parsed).not.toBeNull();
    expect(parsed!.doc.baseBpm).toBe(128);
    expect(parsed!.doc.offsetMs).toBe(12);
    expect(parsed!.doc.tracks).toHaveLength(1);
    expect(parsed!.doc.markers).toHaveLength(1);
    expect(parsed!.doc.markers[0]).toMatchObject({
      id: "m1",
      trackId: "t1",
      beat: 1.5,
    });
    expect(parsed!.doc.audioName).toBe("audio/song.mp3");
    expect(parsed!.doc.bpmLocked).toBe(true);
  });

  it("keeps base BPM positive and repairs missing optional fields", () => {
    const parsed = parseProjectDocument(
      v2({ baseBpm: 5000, audioName: undefined, audioMd5: undefined }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.doc.baseBpm).toBe(5000);
    expect(parsed!.doc.audioName).toBeNull();
    expect(parsed!.doc.audioMd5).toBeNull();
  });

  it("recovers valid items and drops malformed ones", () => {
    const parsed = parseProjectDocument(
      v2({
        markers: [
          { id: "ok", trackId: "t1", beat: 1 },
          { id: "bad", trackId: "t1", beat: "nope" },
          { id: "neg", trackId: "t1", beat: -5 },
          {
            id: "badloop",
            trackId: "t1",
            beat: 2,
            loop: { interval: 0, count: 5 },
          },
          null,
        ],
      }),
    );
    expect(parsed).not.toBeNull();
    const ids = parsed!.doc.markers.map((m) => m.id);
    // the marker is kept even when its loop config is invalid; only the loop is dropped
    expect(ids).toEqual(["ok", "neg", "badloop"]);
    expect(parsed!.doc.markers[1].beat).toBe(0);
    expect(parsed!.doc.markers.every((m) => m.loop === undefined)).toBe(true);
  });

  it("drops markers whose track does not exist", () => {
    const parsed = parseProjectDocument(
      v2({
        markers: [
          { id: "ok", trackId: "t1", beat: 1 },
          { id: "ghost", trackId: "missing", beat: 2 },
        ],
      }),
    );
    expect(parsed!.doc.markers.map((m) => m.id)).toEqual(["ok"]);
  });

  it("falls back to a name derived from the audio file", () => {
    const parsed = parseProjectDocument(
      v2({ name: "", audioName: "C:/music/song.wav" }),
    );
    expect(parsed!.doc.name).toBe("song.wav");
  });
});

describe("parseProjectDocument / v1 migration", () => {
  it("converts absolute times into beats and keeps the legacy audio path", () => {
    const parsed = parseProjectDocument({
      app: APP_ID,
      markers: [
        { id: "m1", timeMs: 1000 },
        { id: "m2", timeMs: 2000 },
      ],
      bpm: 120,
      offsetMs: 0,
      audioPath: "C:/music/song.mp3",
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.legacyAudioPath).toBe("C:/music/song.mp3");
    expect(parsed!.doc.version).toBe(PROJECT_VERSION);
    expect(parsed!.doc.tracks).toHaveLength(1);
    expect(parsed!.doc.markers.map((m) => m.beat)).toEqual([2, 4]);
    expect(parsed!.doc.audioName).toBe("song.mp3");
    expect(parsed!.doc.name).toBe("untitled");
  });

  it("keeps a provided v1 name", () => {
    const parsed = parseProjectDocument({
      app: APP_ID,
      name: "Legacy",
      markers: [{ id: "m1", timeMs: 500 }],
    });
    expect(parsed!.doc.name).toBe("Legacy");
  });
});

describe("BeatProjectSchema", () => {
  it("fills defaults for a minimal document", () => {
    const doc = BeatProjectSchema.parse({
      app: APP_ID,
      version: PROJECT_VERSION,
    });
    expect(doc.name).toBe("");
    expect(doc.baseBpm).toBe(120);
    expect(doc.offsetMs).toBe(0);
    expect(doc.audioName).toBeNull();
    expect(doc.tracks).toEqual([]);
    expect(doc.markers).toEqual([]);
    expect(doc.bpmPoints).toEqual([]);
    expect(doc.notes).toEqual([]);
  });
});
