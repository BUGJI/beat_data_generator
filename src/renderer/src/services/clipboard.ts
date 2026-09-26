import { snapBeat } from "../tempo";
import { defaultAttrsFor } from "../plugins/registry";
import {
  addMarkerToStore,
  findMarker,
  isTrackLocked,
  MAX_LOOP_CHILDREN,
  refreshChildren,
  resolveMainMarker,
  useProjectStore,
} from "../stores/project";
import { markerSelectionIds } from "../stores/selection";
import { useViewStore } from "../stores/view";
import { useTransportStore } from "../stores/transport";
import { pushHistory } from "./history";
import { beatOfTime } from "./timeline";
import type { Marker } from "../types";

/**
 * Marker copy / paste (main points + loop groups, multi-select aware). The
 * clipboard is process-local plain data, so it survives project switches.
 */

interface ClipMarker {
  trackId: string;
  beat: number;
  loop: NonNullable<Marker["loop"]> | null;
  attrs: Record<string, unknown> | null;
}

let clipMarkers: ClipMarker[] = [];

export function copyMarkerGroup(): boolean {
  const mains = markerSelectionIds()
    .map((id) => resolveMainMarker(findMarker(id)))
    .filter((m): m is Marker => !!m);
  if (!mains.length) return false;
  const minBeat = Math.min(...mains.map((m) => m.beat));
  clipMarkers = mains.map((m) => ({
    trackId: m.trackId,
    beat: m.beat - minBeat,
    loop: m.loop
      ? {
          interval: m.loop.interval,
          count: m.loop.count,
          ...(m.loop.exclude ? { exclude: [...m.loop.exclude] } : {}),
        }
      : null,
    attrs: m.attrs ? { ...m.attrs } : null,
  }));
  return true;
}

export function canPaste(): boolean {
  return clipMarkers.length > 0;
}

function trackHasBeat(trackId: string, beat: number): boolean {
  return useProjectStore().markers.some(
    (m) => m.trackId === trackId && Math.abs(m.beat - beat) < 1 / 128,
  );
}

export function pasteMarkerGroup(): boolean {
  if (!clipMarkers.length) return false;
  const p = useProjectStore();
  const view = useViewStore();
  const posMs = useTransportStore().positionMs;
  const raw = beatOfTime(posMs);
  const anchor = Math.max(
    0,
    view.snapEnabled ? snapBeat(raw, view.snapDiv) : raw,
  );
  const trackIds = new Set(p.tracks.map((t) => t.id));
  pushHistory();
  let created = false;
  for (const clip of clipMarkers) {
    const beat = anchor + clip.beat;
    if (!trackIds.has(clip.trackId)) continue;
    if (isTrackLocked(clip.trackId)) continue;
    if (trackHasBeat(clip.trackId, beat)) continue;
    const m = addMarkerToStore(clip.trackId, beat);
    if (!m) continue;
    if (clip.attrs) {
      m.attrs = { ...clip.attrs };
    } else {
      const clipTrack = p.tracks.find((x) => x.id === clip.trackId);
      if (clipTrack?.type && clipTrack.type !== "beat") {
        m.attrs = defaultAttrsFor(clipTrack.type);
      }
    }
    if (clip.loop) {
      m.loop = {
        interval: clip.loop.interval,
        count: Math.min(
          MAX_LOOP_CHILDREN,
          Math.max(1, Math.floor(clip.loop.count)),
        ),
        ...(clip.loop.exclude?.length
          ? { exclude: [...clip.loop.exclude] }
          : {}),
      };
      refreshChildren(m);
    }
    created = true;
  }
  if (!created) return false;
  p.dirty = true;
  return true;
}
