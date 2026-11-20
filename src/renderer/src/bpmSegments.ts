import { hexToRgb } from "./theme";
import { clamp } from "./utils/clamp";

/**
 * Theme-derived colors for BPM lane segments.
 *
 * Adjacent segments alternate between two theme anchors (the BPM color and the
 * accent color) in segment order. Alternation uses the ordinal, not a hash of
 * the start: a hash makes neighbouring segments randomly collide, which makes
 * the two colors look like they stopped alternating. Appending a segment keeps
 * earlier colors; inserting one before a segment shifts the later phase.
 *
 * When the two theme anchors are too close in hue (warm themes such as amber),
 * they are spread to opposite ends of the readable lightness band so the
 * alternation still reads.
 *
 * A quantized tempo bucket nudges the hue by ±4° so faster/slower sections are
 * subtly distinguishable while the overall look stays calm. All strings are
 * memoized: a segment maps to one of a handful of theme colors, so drawing does
 * not allocate per segment each frame.
 */

export interface BpmSegmentInput {
  /** First beat of the segment (a BPM point, or 0 for the base segment). */
  beatStart: number;
  /** Zero-based segment ordinal; drives the two-color alternation. */
  index: number;
  /** Effective BPM inside the segment. */
  bpm: number;
  /** Project base BPM, used as the neutral reference for the tempo bucket. */
  baseBpm: number;
  /** True when the grid division comes from an explicit BPM-point override. */
  gridOverride: boolean;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export interface BpmSegmentTheme {
  /** Theme BPM color: even segments and every boundary. */
  primary: Hsl;
  /** Theme accent color: odd segments. */
  secondary: Hsl;
  /** True when the editor theme has a light background. */
  light: boolean;
}

/** Body tint alpha at intensity 0 and 100. */
export const BPM_SEGMENT_FILL_MIN_ALPHA = 0.02;
export const BPM_SEGMENT_FILL_ALPHA = 0.12;
/** Top structural bar alpha at intensity 0 and 100. */
export const BPM_SEGMENT_BAR_MIN_ALPHA = 0.14;
export const BPM_SEGMENT_BAR_ALPHA = 0.42;
/** Segment-start boundary; fixed so structure survives intensity 0. */
export const BPM_SEGMENT_BOUNDARY_ALPHA = 0.5;

/** Readable lightness bands for dark and light editor themes. */
const DARK_L_BAND = { lo: 46, hi: 64 } as const;
const LIGHT_L_BAND = { lo: 34, hi: 48 } as const;
/** Below this hue gap the anchors are also separated by lightness. */
const MIN_ANCHOR_HUE_GAP = 24;

function rgbToHsl(rgb: { r: number; g: number; b: number }): Hsl {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h / 6) * 360, s: s * 100, l: l * 100 };
}

function wrapHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

/** Shortest distance between two hues on the color wheel, in degrees. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(wrapHue(a) - wrapHue(b));
  return Math.min(d, 360 - d);
}

/** Dim the theme color and pin its lightness to the readable band. */
function anchorHsl(base: Hsl, light: boolean): Hsl {
  const band = light ? LIGHT_L_BAND : DARK_L_BAND;
  return {
    h: base.h,
    s: clamp(base.s * 0.5 + 18, 28, 72),
    l: light
      ? clamp(base.l * 0.55 + 12, band.lo, band.hi)
      : clamp(base.l * 0.85 + 8, band.lo, band.hi),
  };
}

/** Build the two theme anchors from the BPM, accent and background colors. */
export function bpmSegmentTheme(
  bpmHex: string,
  accentHex: string,
  backgroundHex: string,
): BpmSegmentTheme {
  const bg = rgbToHsl(hexToRgb(backgroundHex));
  const light = bg.l > 50;
  const primary = anchorHsl(rgbToHsl(hexToRgb(bpmHex)), light);
  const secondary = anchorHsl(rgbToHsl(hexToRgb(accentHex)), light);
  if (hueGap(primary.h, secondary.h) < MIN_ANCHOR_HUE_GAP) {
    const band = light ? LIGHT_L_BAND : DARK_L_BAND;
    primary.l = band.lo;
    secondary.l = band.hi;
  }
  return { primary, secondary, light };
}

/** Quantized tempo bucket (-1 slower, 0 same, 1 faster) for the hue nudge. */
function tempoBucket(input: BpmSegmentInput): number {
  if (input.baseBpm <= 0 || input.bpm <= 0) return 0;
  const ratio = input.bpm / input.baseBpm;
  return clamp(Math.round(Math.log2(ratio)), -1, 1);
}

/** Effective HSL for one segment, before alpha is applied. */
export function bpmSegmentHsl(
  input: BpmSegmentInput,
  theme: BpmSegmentTheme,
): Hsl {
  const anchor = input.index % 2 ? theme.secondary : theme.primary;
  return {
    h: wrapHue(anchor.h + tempoBucket(input) * 4),
    s: anchor.s,
    l: anchor.l,
  };
}

/** Alpha at the given intensity, linearly between the min and max anchors. */
export function bpmSegmentAlpha(
  intensity: number,
  min: number,
  max: number,
): number {
  return min + (max - min) * (clamp(intensity, 0, 100) / 100);
}

function hsla(c: Hsl, alpha: number): string {
  return `hsla(${c.h.toFixed(1)}, ${c.s.toFixed(1)}%, ${c.l.toFixed(1)}%, ${alpha.toFixed(2)})`;
}

const colorCache = new Map<string, string>();

function cachedColor(c: Hsl, alpha: number): string {
  const key = `${c.h.toFixed(1)}|${c.s.toFixed(1)}|${c.l.toFixed(1)}|${alpha.toFixed(2)}`;
  const hit = colorCache.get(key);
  if (hit) return hit;
  if (colorCache.size > 256) colorCache.clear();
  const value = hsla(c, alpha);
  colorCache.set(key, value);
  return value;
}

/** Subtle full-lane tint for a segment. */
export function bpmSegmentFill(
  input: BpmSegmentInput,
  theme: BpmSegmentTheme,
  intensity: number,
): string {
  return cachedColor(
    bpmSegmentHsl(input, theme),
    bpmSegmentAlpha(
      intensity,
      BPM_SEGMENT_FILL_MIN_ALPHA,
      BPM_SEGMENT_FILL_ALPHA,
    ),
  );
}

/** Stronger same-anchor color for the 2px top structural bar. */
export function bpmSegmentBar(
  input: BpmSegmentInput,
  theme: BpmSegmentTheme,
  intensity: number,
): string {
  const alpha = bpmSegmentAlpha(
    intensity,
    BPM_SEGMENT_BAR_MIN_ALPHA,
    BPM_SEGMENT_BAR_ALPHA,
  );
  return cachedColor(
    bpmSegmentHsl(input, theme),
    input.gridOverride ? alpha : alpha * 0.85,
  );
}

/** Fixed theme-BPM color for the 1px segment-start boundary. */
export function bpmSegmentBoundary(theme: BpmSegmentTheme): string {
  return cachedColor(theme.primary, BPM_SEGMENT_BOUNDARY_ALPHA);
}
