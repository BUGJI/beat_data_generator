import { markersInTrack, useProjectStore } from "../../stores/project";
import { timeToScreenX, screenToTime, useViewStore } from "../../stores/view";
import {
  beatOfTime,
  markerTime as storeMarkerTime,
  timeOfBeat,
} from "../../services/timeline";
import { laneKindAt } from "./geometry";
import type { BpmPoint, Marker } from "../../types";

const HIT_PX = 7;

/** Hit testing for markers and BPM points on the canvas. */
export function useTimelineHitTest() {
  const project = useProjectStore();
  const view = useViewStore();

  const trackAt = (i: number) => project.tracks[i];

  function hitMarkerAt(x: number, y: number): Marker | null {
    const lane = laneKindAt(y, view.y);
    if (lane.kind !== "marker") return null;
    const track = trackAt(lane.index);
    if (!track) return null;
    const list = markersInTrack(track.id);
    if (!list.length) return null;
    // Markers are sorted by beat and screen x is monotonic in beat, so the
    // closest marker is one of the two straddling the beat under the cursor.
    const beat = beatOfTime(screenToTime(x));
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const mm = list[mid];
      if (!mm) break;
      if (mm.beat < beat) lo = mid + 1;
      else hi = mid;
    }
    let best: Marker | null = null;
    let bestDx = Number.POSITIVE_INFINITY;
    for (const i of [lo - 1, lo]) {
      const m = list[i];
      if (!m) continue;
      const dx = Math.abs(timeToScreenX(storeMarkerTime(m)) - x);
      if (dx < bestDx) {
        bestDx = dx;
        best = m;
      }
    }
    return bestDx <= HIT_PX ? best : null;
  }

  function hitBpmAt(x: number, y: number): BpmPoint | null {
    const lane = laneKindAt(y, view.y);
    if (lane.kind !== "bpm") return null;
    for (const p of project.bpmPoints) {
      if (Math.abs(timeToScreenX(timeOfBeat(p.beat)) - x) <= HIT_PX) return p;
    }
    return null;
  }

  return { hitMarkerAt, hitBpmAt };
}
