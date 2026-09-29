import type { LoopConfig } from "../../types";
import { useUiStore } from "../ui";
import { refreshChildren } from "./markers";
import { findMarker } from "./queries";
import { useProjectStore } from "./store";

/**
 * `timeAlign` keeps markers pinned to their absolute time when the tempo map
 * (base BPM / offset / tempo points) changes. It does so by rewriting each
 * marker's beat against the new map, so beats always describe the current tempo
 * map — saving, reloading and exporting therefore always match what is on
 * screen. (The old implementation kept session-only anchors and only rewrote
 * beats on toggle-off, which desynced from the saved file and mixed markers
 * that were anchored under different tempo maps.)
 */

/** Snapshot the absolute times of every marker and the ms-length of every loop
 *  interval; the returned function rewrites beats/intervals against the
 *  (possibly changed) tempo map so those absolute times are preserved. */
function captureTimePositions(): () => void {
  const p = useProjectStore();
  const before = p.tempoMap;
  const markerTimes = p.markers
    .filter((m) => !m.parentId)
    .map((m) => ({ id: m.id, timeMs: before.timeOfBeat(m.beat) }));
  const loopSpans = p.markers
    .filter((m) => !!m.loop)
    .map((m) => {
      const loop = m.loop as LoopConfig;
      return {
        id: m.id,
        spanMs: loop.interval * (60_000 / before.bpmAtBeat(m.beat)),
      };
    });
  return () => {
    const after = p.tempoMap;
    for (const it of markerTimes) {
      const m = findMarker(it.id);
      if (m) m.beat = Math.max(0, after.beatOfTime(it.timeMs));
    }
    for (const it of loopSpans) {
      const m = findMarker(it.id);
      if (m?.loop)
        m.loop.interval = Math.max(
          1e-4,
          it.spanMs / (60_000 / after.bpmAtBeat(m.beat)),
        );
    }
    for (const m of useProjectStore().markers.filter(
      (x) => x.loop && !x.parentId,
    ))
      refreshChildren(m);
  };
}

/** Run a tempo-map mutation; while `timeAlign` is on, marker absolute positions
 *  are preserved by rewriting their beats afterward. */
export function withTimeAlign<T>(mutate: () => T): T {
  const restore = useUiStore().timeAlign ? captureTimePositions() : null;
  const result = mutate();
  if (restore) restore();
  return result;
}
