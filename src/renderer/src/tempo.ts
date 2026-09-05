import type { BpmPoint, Segment } from "./types";

export const BPM_MIN = 20;
export const BPM_MAX = 999;

export interface TempoMap {
  segments: Segment[];
  bpmAtBeat: (beat: number) => number;
  bpmAtTime: (timeMs: number) => number;
  timeOfBeat: (beat: number) => number;
  beatOfTime: (timeMs: number) => number;
}

export function clampBpm(v: number): number {
  return Math.min(BPM_MAX, Math.max(BPM_MIN, v));
}

/** Build ordered tempo segments from the base BPM (beat 0) and tempo-change points. */
export function buildTempoMap(
  baseBpm: number,
  offsetMs: number,
  points: BpmPoint[],
): TempoMap {
  const sorted = [...points]
    .filter((p) => Number.isFinite(p.beat) && p.beat > 0)
    .sort((a, b) => a.beat - b.beat);

  const seg: Segment[] = [];
  let curBpm = clampBpm(baseBpm);
  let curBeat = 0;
  let curTime = offsetMs;
  for (const p of sorted) {
    if (p.beat <= curBeat) continue;
    seg.push({
      beatStart: curBeat,
      beatEnd: p.beat,
      bpm: curBpm,
      timeStartMs: curTime,
      timeEndMs: null,
    });
    const durBeats = p.beat - curBeat;
    curTime += (durBeats * 60_000) / curBpm;
    curBpm = p.mode === "abs" ? clampBpm(p.value) : clampBpm(curBpm * p.value);
    curBeat = p.beat;
  }
  seg.push({
    beatStart: curBeat,
    beatEnd: null,
    bpm: curBpm,
    timeStartMs: curTime,
    timeEndMs: null,
  });

  seg.forEach((s, i) => {
    if (i + 1 < seg.length) s.timeEndMs = seg[i + 1].timeStartMs;
  });

  const msPerBeat = (bpm: number): number => 60_000 / bpm;

  function timeOfBeat(beat: number): number {
    if (seg.length === 0) return offsetMs;
    if (beat <= seg[0].beatStart) {
      const s = seg[0];
      return s.timeStartMs + (beat - s.beatStart) * msPerBeat(s.bpm);
    }
    for (let i = 0; i < seg.length; i++) {
      const s = seg[i];
      if (s.beatEnd === null || beat < s.beatEnd) {
        return s.timeStartMs + (beat - s.beatStart) * msPerBeat(s.bpm);
      }
    }
    const last = seg[seg.length - 1];
    return last.timeStartMs + (beat - last.beatStart) * msPerBeat(last.bpm);
  }

  function beatOfTime(timeMs: number): number {
    if (seg.length === 0) return 0;
    if (timeMs <= seg[0].timeStartMs) {
      const s = seg[0];
      return s.beatStart + (timeMs - s.timeStartMs) / msPerBeat(s.bpm);
    }
    for (let i = 0; i < seg.length; i++) {
      const s = seg[i];
      if (s.timeEndMs === null || timeMs < s.timeEndMs) {
        return s.beatStart + (timeMs - s.timeStartMs) / msPerBeat(s.bpm);
      }
    }
    const last = seg[seg.length - 1];
    return last.beatStart + (timeMs - last.timeStartMs) / msPerBeat(last.bpm);
  }

  function bpmAtBeat(beat: number): number {
    if (seg.length === 0) return clampBpm(baseBpm);
    if (beat <= seg[0].beatStart) return seg[0].bpm;
    for (let i = 0; i < seg.length; i++) {
      const s = seg[i];
      if (s.beatEnd === null || beat < s.beatEnd) return s.bpm;
    }
    return seg[seg.length - 1].bpm;
  }

  function bpmAtTime(timeMs: number): number {
    return bpmAtBeat(beatOfTime(timeMs));
  }

  return { segments: seg, bpmAtBeat, bpmAtTime, timeOfBeat, beatOfTime };
}

export function snapBeat(beat: number, div: number): number {
  if (div <= 1) return Math.round(beat);
  const step = 1 / div;
  return Math.round(beat / step) * step;
}

export function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 32nd-note-agnostic bar/beat display, e.g. beat 17.25 -> bar 5, beat 1.25 */
export function beatParts(beat: number): { bar: number; inBar: number } {
  const b = Math.max(0, beat);
  const barIndex = Math.floor(b / 4);
  return { bar: barIndex + 1, inBar: b - barIndex * 4 };
}

export function fmtBarBeat(beat: number): string {
  const { bar, inBar } = beatParts(beat);
  return `${bar}·${inBar.toFixed(2).replace(/\.?0+$/, "")}`;
}
