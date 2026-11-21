import { beatOfTime, timeOfBeat } from "../../services/timeline";
import { useProjectStore } from "../../stores/project";
import { useSettingsStore } from "../../stores/settings";
import { useTransportStore } from "../../stores/transport";
import { timeToScreenX, useViewStore } from "../../stores/view";

/** Snap the pointer to nearby markers / playhead / notes / loop edges. */
export function magnetBeat(
  x: number,
  excludeMarkerIds?: Set<string>,
): number | null {
  const view = useViewStore();
  if (!view.snapEnabled || !view.magnetEnabled) return null;
  const project = useProjectStore();
  const transport = useTransportStore();
  const s = useSettingsStore().settings;
  const threshold = s.magnetThresholdPx;
  let best = threshold + 1;
  let bestBeat: number | null = null;

  const consider = (timeMs: number): void => {
    const dx = Math.abs(timeToScreenX(timeMs) - x);
    if (dx > threshold || dx >= best) return;
    best = dx;
    bestBeat = beatOfTime(timeMs);
  };

  if (s.magnetPlayhead) consider(transport.positionMs);
  if (
    s.magnetLoopEdges &&
    transport.loopEnabled &&
    transport.loopEndMs > transport.loopStartMs
  ) {
    consider(transport.loopStartMs);
    consider(transport.loopEndMs);
  }
  if (s.magnetNotes) {
    for (const note of project.notes) consider(note.timeMs);
  }
  if (s.magnetMarkers) {
    for (const marker of project.markers) {
      const track = project.tracksById.get(marker.trackId);
      if (track?.hidden) continue;
      if (excludeMarkerIds?.has(marker.id)) continue;
      consider(timeOfBeat(marker.beat));
    }
  }
  return bestBeat;
}
