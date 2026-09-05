export const RULER_H = 30;

export const SNAP_DIVISIONS = [1, 2, 4, 8, 16] as const;
export type SnapDivision = (typeof SNAP_DIVISIONS)[number];

export const BEATS_PER_BAR = 4;

export const MIN_PX_PER_SEC = 6;
export const MAX_PX_PER_SEC = 4000;

export const COLORS = {
  background: "#14171b",
  laneAudioBg: "#181c21",
  laneMarkerBg: "#1b1f25",
  gridBeat: "rgba(148,163,184,0.14)",
  gridBar: "rgba(148,163,184,0.30)",
  gridSub: "rgba(148,163,184,0.07)",
  rulerText: "rgba(148,163,184,0.75)",
  rulerTick: "rgba(148,163,184,0.45)",
  waveform: "#34d399",
  waveformBg: "rgba(52,211,153,0.15)",
  playhead: "#f43f5e",
  marker: "#38bdf8",
  markerSelected: "#fbbf24",
  markerGhost: "rgba(251,191,36,0.5)",
  barText: "rgba(52,211,153,0.9)",
  audioRegion: "#1f2937",
} as const;
