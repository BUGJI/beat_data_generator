export const TIME_RULER_H = 20;
export const BEAT_RULER_H = 28;
export const RULER_H = TIME_RULER_H + BEAT_RULER_H;

export const BPM_LANE_H = 108;
export const MARKER_LANE_H = 36;
export const HEADER_W = 236;
export const TRACK_COLOR_ROW = 16;

export const SNAP_DIVISIONS = [1, 2, 4, 8, 16, 32] as const;
export const DEFAULT_DIV = 4;

export const BEATS_PER_BAR = 4;

export const MIN_PX_PER_SEC = 6;
export const MAX_PX_PER_SEC = 4000;

export const COLORS = {
  background: "#14171b",
  rulerTimeBg: "rgba(148,163,184,0.05)",
  rulerBeatBg: "rgba(56,189,248,0.05)",
  laneBpmBg: "#151a20",
  laneMarkerBg: "#181c22",
  laneMarkerAlt: "#1a1f26",
  gridBeat: "rgba(148,163,184,0.14)",
  gridBar: "rgba(52,211,153,0.30)",
  gridSub: "rgba(148,163,184,0.07)",
  rulerText: "rgba(148,163,184,0.75)",
  rulerTick: "rgba(148,163,184,0.45)",
  waveform: "rgba(52,211,153,0.5)",
  playhead: "#f43f5e",
  marker: "#38bdf8",
  markerDim: "#5c6470",
  markerSelected: "#fbbf24",
  markerGhostOk: "rgba(251,191,36,0.5)",
  markerGhostBad: "rgba(244,63,94,0.75)",
  bpmPoint: "#f59e0b",
  bpmPointSelected: "#fff",
  bpmSegmentText: "rgba(245,158,11,0.85)",
  barText: "rgba(52,211,153,0.9)",
  rowLine: "rgba(148,163,184,0.08)",
  laneLockedBg: "rgba(148,163,184,0.10)",
} as const;

export const LANE_COLORS = [
  "#38bdf8",
  "#34d399",
  "#f472b6",
  "#a78bfa",
  "#fb923c",
  "#fbbf24",
  "#4ade80",
  "#22d3ee",
  "#e879f9",
  "#f87171",
];

export function nextColor(used: Iterable<string>): string {
  const set = new Set(used);
  return LANE_COLORS.find((c) => !set.has(c)) ?? "#94a3b8";
}
