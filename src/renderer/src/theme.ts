import { COLORS, type CanvasColors } from "./metrics";

/**
 * Theme system.
 *
 * A theme is a small set of semantic tokens (`ThemeSpec`). Presets are complete
 * token sets; the user's custom edits are stored as a partial override on top of
 * the chosen preset. From the resolved spec we derive two things at once:
 *   - CSS custom properties on :root (DOM / scoped styles / Element Plus)
 *   - the canvas `COLORS` palette used by the timeline renderer
 *
 * All the translucent greys/accent tints used across the UI are expressed in CSS
 * as `rgb(var(--bdg-*-rgb) / <alpha>)`, so a preset only has to change the base
 * tokens and every derived shade follows automatically.
 */

export interface ThemeSpec {
  // surfaces
  bg: string;
  panel: string;
  raised: string;
  sunken: string;
  menu: string;
  // text
  text: string;
  textDim: string;
  /** neutral overlay base (borders, grid, faint tints). */
  neutral: string;
  // brand / semantic
  accent: string;
  accent2: string;
  danger: string;
  amber: string;
  bpm: string;
  // canvas specifics
  laneBpmBg: string;
  laneMarkerBg: string;
  laneMarkerAlt: string;
  markerDim: string;
  bpmPointSelected: string;
}

export type ThemeOverrides = Partial<ThemeSpec>;

export interface ThemePreset {
  id: string;
  /** i18n key suffix under `settings.theme.presets`. */
  name: string;
  spec: ThemeSpec;
}

const DEFAULT_SPEC: ThemeSpec = {
  bg: "#0e1116",
  panel: "#161a21",
  raised: "#1b2028",
  sunken: "#10131a",
  menu: "#1c222b",
  text: "#e6ebf2",
  textDim: "#8b97a8",
  neutral: "#94a3b8",
  accent: "#38bdf8",
  accent2: "#34d399",
  danger: "#f43f5e",
  amber: "#fbbf24",
  bpm: "#f59e0b",
  laneBpmBg: "#151a20",
  laneMarkerBg: "#181c22",
  laneMarkerAlt: "#1a1f26",
  markerDim: "#5c6470",
  bpmPointSelected: "#ffffff",
};

export const THEME_PRESETS: ThemePreset[] = [
  { id: "default", name: "default", spec: DEFAULT_SPEC },
  {
    id: "midnight",
    name: "midnight",
    spec: {
      bg: "#0d0b14",
      panel: "#171325",
      raised: "#1d1830",
      sunken: "#100c1c",
      menu: "#201a36",
      text: "#ece8f5",
      textDim: "#9a93ad",
      neutral: "#a99fc0",
      accent: "#a78bfa",
      accent2: "#f472b6",
      danger: "#fb7185",
      amber: "#fbbf24",
      bpm: "#f59e0b",
      laneBpmBg: "#171327",
      laneMarkerBg: "#191428",
      laneMarkerAlt: "#1c1730",
      markerDim: "#6b6480",
      bpmPointSelected: "#ffffff",
    },
  },
  {
    id: "forest",
    name: "forest",
    spec: {
      bg: "#0b1210",
      panel: "#121b18",
      raised: "#17211d",
      sunken: "#0e1512",
      menu: "#182420",
      text: "#e4efe9",
      textDim: "#8aa398",
      neutral: "#8fb3a3",
      accent: "#34d399",
      accent2: "#22d3ee",
      danger: "#f87171",
      amber: "#fbbf24",
      bpm: "#f59e0b",
      laneBpmBg: "#111a17",
      laneMarkerBg: "#141d1a",
      laneMarkerAlt: "#17211d",
      markerDim: "#5c6f67",
      bpmPointSelected: "#ffffff",
    },
  },
  {
    id: "amber",
    name: "amber",
    spec: {
      bg: "#14100b",
      panel: "#1e1811",
      raised: "#262017",
      sunken: "#17120c",
      menu: "#282018",
      text: "#f3ece1",
      textDim: "#b09a80",
      neutral: "#c0a98c",
      accent: "#fb923c",
      accent2: "#fbbf24",
      danger: "#f87171",
      amber: "#fbbf24",
      bpm: "#f59e0b",
      laneBpmBg: "#1c1610",
      laneMarkerBg: "#201a12",
      laneMarkerAlt: "#241d14",
      markerDim: "#7a6a55",
      bpmPointSelected: "#ffffff",
    },
  },
  {
    id: "graphite",
    name: "graphite",
    spec: {
      bg: "#101112",
      panel: "#191b1d",
      raised: "#202326",
      sunken: "#131415",
      menu: "#232629",
      text: "#e8eaec",
      textDim: "#9aa1a8",
      neutral: "#a3abb3",
      accent: "#9ca3af",
      accent2: "#60a5fa",
      danger: "#f87171",
      amber: "#fbbf24",
      bpm: "#f59e0b",
      laneBpmBg: "#17191b",
      laneMarkerBg: "#1b1e20",
      laneMarkerAlt: "#1f2225",
      markerDim: "#6b7178",
      bpmPointSelected: "#ffffff",
    },
  },
  {
    id: "light",
    name: "light",
    spec: {
      bg: "#f4f6f9",
      panel: "#ffffff",
      raised: "#eef1f6",
      sunken: "#e6eaf1",
      menu: "#ffffff",
      text: "#1f2733",
      textDim: "#5b6675",
      neutral: "#64748b",
      accent: "#2563eb",
      accent2: "#059669",
      danger: "#dc2626",
      amber: "#d97706",
      bpm: "#d97706",
      laneBpmBg: "#eef2f8",
      laneMarkerBg: "#f5f7fa",
      laneMarkerAlt: "#eef1f6",
      markerDim: "#94a3b8",
      bpmPointSelected: "#1f2733",
    },
  },
];

export const THEME_TOKEN_ORDER: (keyof ThemeSpec)[] = [
  "bg",
  "panel",
  "raised",
  "sunken",
  "menu",
  "text",
  "textDim",
  "neutral",
  "accent",
  "accent2",
  "danger",
  "amber",
  "bpm",
  "laneBpmBg",
  "laneMarkerBg",
  "laneMarkerAlt",
  "markerDim",
  "bpmPointSelected",
];

function normalizeHex(hex: string): string | null {
  const m = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  let h = m[1] as string;
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  return `#${h.toLowerCase()}`;
}

/** "148 163 184" — space separated RGB, for `rgb(var(--x) / a)`. */
export function rgbTriple(hex: string): string {
  const h = normalizeHex(hex);
  if (!h) return "148 163 184";
  const n = parseInt(h.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function rgba(hex: string, alpha: number): string {
  return `rgba(${rgbTriple(hex).replace(/ /g, ",")}, ${alpha})`;
}

/** Rough relative luminance test used to flip the Element Plus light/dark base. */
function isLightColor(hex: string): boolean {
  const h = normalizeHex(hex);
  if (!h) return false;
  const n = parseInt(h.slice(1), 16);
  const lum =
    (0.2126 * ((n >> 16) & 255) +
      0.7152 * ((n >> 8) & 255) +
      0.0722 * (n & 255)) /
    255;
  return lum > 0.5;
}

export function presetById(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}

/** Resolve a preset + user overrides into a complete spec (overrides win). */
export function resolveTheme(
  presetId: string,
  overrides: ThemeOverrides | undefined,
): ThemeSpec {
  const preset = presetById(presetId) ?? THEME_PRESETS[0]!;
  const spec: ThemeSpec = { ...preset.spec };
  if (overrides) {
    for (const key of THEME_TOKEN_ORDER) {
      const v = overrides[key];
      if (typeof v === "string" && normalizeHex(v)) spec[key] = v;
    }
  }
  return spec;
}

/** The canvas palette derived from a resolved spec. */
export function buildCanvasColors(spec: ThemeSpec): CanvasColors {
  return {
    background: spec.bg,
    rulerTimeBg: rgba(spec.neutral, 0.05),
    rulerBeatBg: rgba(spec.accent, 0.05),
    laneBpmBg: spec.laneBpmBg,
    laneMarkerBg: spec.laneMarkerBg,
    laneMarkerAlt: spec.laneMarkerAlt,
    gridBeat: rgba(spec.neutral, 0.14),
    gridBar: rgba(spec.accent2, 0.3),
    gridSub: rgba(spec.neutral, 0.07),
    rulerText: rgba(spec.neutral, 0.75),
    rulerTick: rgba(spec.neutral, 0.45),
    waveform: rgba(spec.accent2, 0.5),
    playhead: spec.danger,
    marker: spec.accent,
    markerDim: spec.markerDim,
    markerSelected: spec.amber,
    markerGhostOk: rgba(spec.amber, 0.5),
    markerGhostBad: rgba(spec.danger, 0.75),
    bpmPoint: spec.bpm,
    bpmPointSelected: spec.bpmPointSelected,
    bpmSegmentText: rgba(spec.bpm, 0.85),
    bpmFaint: rgba(spec.bpm, 0.35),
    labelBg: rgba(spec.sunken, 0.92),
    barText: rgba(spec.accent2, 0.9),
    rowLine: rgba(spec.neutral, 0.08),
    laneLockedBg: rgba(spec.neutral, 0.1),
  };
}

/** CSS custom properties for a resolved spec (DOM + Element Plus). */
export function buildCssVars(spec: ThemeSpec): Record<string, string> {
  const elTextRegular = spec.textDim;
  return {
    "--bdg-bg": spec.bg,
    "--bdg-bg-panel": spec.panel,
    "--bdg-bg-raised": spec.raised,
    "--bdg-bg-sunken": spec.sunken,
    "--bdg-menu": spec.menu,
    "--bdg-border": rgba(spec.neutral, 0.14),
    "--bdg-border-strong": rgba(spec.neutral, 0.28),
    "--bdg-text": spec.text,
    "--bdg-text-dim": spec.textDim,
    "--bdg-text-faint": rgba(spec.neutral, 0.35),
    "--bdg-accent": spec.accent,
    "--bdg-accent-2": spec.accent2,
    "--bdg-danger": spec.danger,
    "--bdg-amber": spec.amber,
    "--bdg-bpm": spec.bpm,
    "--bdg-marker": spec.accent,
    "--bdg-marker-selected": spec.amber,
    "--bdg-playhead": spec.danger,
    "--bdg-bg-rgb": rgbTriple(spec.bg),
    "--bdg-panel-rgb": rgbTriple(spec.panel),
    "--bdg-neutral": rgbTriple(spec.neutral),
    "--bdg-accent-rgb": rgbTriple(spec.accent),
    "--bdg-accent2-rgb": rgbTriple(spec.accent2),
    "--bdg-danger-rgb": rgbTriple(spec.danger),
    "--bdg-amber-rgb": rgbTriple(spec.amber),
    "--bdg-bpm-rgb": rgbTriple(spec.bpm),
    "--bdg-mask": rgba(spec.bg, 0.7),
    "--bdg-shadow": "rgba(0, 0, 0, 0.5)",
    // Element Plus
    "--el-color-primary": spec.accent,
    "--el-color-danger": spec.danger,
    "--el-color-warning": spec.amber,
    "--el-color-success": spec.accent2,
    "--el-bg-color": spec.panel,
    "--el-bg-color-overlay": spec.menu,
    "--el-fill-color-blank": spec.panel,
    "--el-fill-color": spec.raised,
    "--el-fill-color-light": spec.raised,
    "--el-fill-color-lighter": spec.panel,
    "--el-border-color": rgba(spec.neutral, 0.2),
    "--el-border-color-light": rgba(spec.neutral, 0.14),
    "--el-border-color-lighter": rgba(spec.neutral, 0.1),
    "--el-text-color-primary": spec.text,
    "--el-text-color-regular": elTextRegular,
    "--el-text-color-secondary": spec.textDim,
    "--el-mask-color": rgba(spec.bg, 0.7),
  };
}

/** Apply a resolved spec to the document + canvas palette. Session-persistent
 *  overrides are NOT stored here; this only paints the current theme. */
export function applyTheme(spec: ThemeSpec): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(buildCssVars(spec))) {
    root.style.setProperty(name, value);
  }
  // Light themes use Element Plus's light base; dark themes keep the dark base.
  root.classList.toggle("dark", !isLightColor(spec.bg));
  Object.assign(COLORS, buildCanvasColors(spec));
}
