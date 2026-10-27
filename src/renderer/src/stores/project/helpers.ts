import { isFreeInput } from "@shared/limits";
import { gridDivAt } from "../../grid";
import { snapBeat } from "../../tempo";
import { useViewStore } from "../view";
import { useProjectStore } from "./store";

/** Beat rounding / snapping primitives shared by the marker and BPM editors. */

/** Round to a stable 6-decimal grid (bypassed under free input). */
export const round = (b: number): number =>
  isFreeInput() ? b : Math.round(b * 1e6) / 1e6;

/** Non-negative beat guard (dropped when free input is on). */
export function clampBeat(b: number): number {
  return isFreeInput() ? b : Math.max(0, b);
}

/** Snap a beat to the effective grid at that beat, or just round when off. */
export function snapped(b: number): number {
  const view = useViewStore();
  if (!view.snapEnabled) return round(b);
  const div = gridDivAt(useProjectStore().gridSegments, b);
  return snapBeat(b, div);
}
