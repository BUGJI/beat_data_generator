import { isFreeInput } from "../../../../shared/limits";
import { snapBeat } from "../../tempo";
import { useViewStore } from "../view";

/** Beat rounding / snapping primitives shared by the marker and BPM editors. */

/** Round to a stable 6-decimal grid (bypassed under free input). */
export const round = (b: number): number =>
  isFreeInput() ? b : Math.round(b * 1e6) / 1e6;

/** Non-negative beat guard (dropped when free input is on). */
export function clampBeat(b: number): number {
  return isFreeInput() ? b : Math.max(0, b);
}

/** Snap a beat to the view's grid, or just round when snapping is off. */
export function snapped(b: number): number {
  const view = useViewStore();
  return view.snapEnabled ? snapBeat(b, view.snapDiv) : round(b);
}
