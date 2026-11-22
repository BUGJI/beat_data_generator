import { beatOfTime, timeOfBeat } from "../../services/timeline";
import { markersInTrack, useProjectStore } from "../../stores/project";
import { useTransportStore } from "../../stores/transport";
import { screenToTime, timeToScreenX, useViewStore } from "../../stores/view";
import { lowerBound } from "../../utils/search";

const THRESHOLD_PX = 9;

/** Snap the pointer to nearby markers / playhead / notes / loop edges. */
export function magnetBeat(
  x: number,
  excludeMarkerIds?: Set<string>,
): number | null {
  const view = useViewStore();
  if (!view.snapEnabled || !view.magnetEnabled) return null;
  const project = useProjectStore();
  const transport = useTransportStore();
  let best = THRESHOLD_PX + 1;
  let bestBeat: number | null = null;

  const consider = (timeMs: number): void => {
    const dx = Math.abs(timeToScreenX(timeMs) - x);
    if (dx > THRESHOLD_PX || dx >= best) return;
    best = dx;
    bestBeat = beatOfTime(timeMs);
  };

  consider(transport.positionMs);
  if (transport.loopEnabled && transport.loopEndMs > transport.loopStartMs) {
    consider(transport.loopStartMs);
    consider(transport.loopEndMs);
  }
  for (const note of project.notes) consider(note.timeMs);

  // Only markers whose beat can land within the pixel threshold are candidates.
  // Each track's marker list is sorted by beat, so a binary search turns the old
  // O(all markers) scan into O(tracks × log n + few candidates) per pointer move.
  const beatLo = beatOfTime(screenToTime(x - THRESHOLD_PX));
  const beatHi = beatOfTime(screenToTime(x + THRESHOLD_PX));
  for (const track of project.tracks) {
    if (track.hidden) continue;
    const list = markersInTrack(track.id);
    if (!list.length) continue;
    for (
      let i = lowerBound(list, (m) => m.beat, beatLo);
      i < list.length;
      i++
    ) {
      const marker = list[i]!;
      if (marker.beat > beatHi) break;
      if (excludeMarkerIds?.has(marker.id)) continue;
      consider(timeOfBeat(marker.beat));
    }
  }
  return bestBeat;
}
