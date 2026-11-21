import { ref, type Ref } from "vue";
import {
  addBpmPoint,
  addMarker,
  changeMarkerTrack,
  findMarker,
  gridDivAtBeat,
  markersInTrack,
  moveMarkers,
  removeBpmPoint,
  removeMarker,
  resolveMainMarker,
  updateBpmPoint,
  useProjectStore,
} from "../../stores/project";
import {
  boxSelectMarkers,
  closeCard,
  markerSelectionIds,
  select,
  selectSingleMarker,
  toggleMarkerSelect,
  useSelectionStore,
} from "../../stores/selection";
import {
  useTransportStore,
  disableFollowOnScrub,
} from "../../stores/transport";
import { useSettingsStore } from "../../stores/settings";
import { useUiStore } from "../../stores/ui";
import {
  screenToTime,
  setScroll,
  timeToScreenX,
  useViewStore,
} from "../../stores/view";
import {
  beatOfTime,
  contentEndMs,
  markerTime as storeMarkerTime,
} from "../../services/timeline";
import { clearLoop, seekTo, setLoopRange } from "../../services/playback";
import { holdFollow } from "../../services/follow";
import {
  historyGestureBegin,
  historyGestureEnd,
  undo,
} from "../../services/history";
import { toast } from "../../ui/toast";
import { t } from "../../utils/text";
import { BPM_LANE_H, MARKER_LANE_H, RULER_H } from "../../metrics";
import {
  bpmOccupy,
  doSnap,
  laneKindAt,
  markerOccupy,
  visibleRows,
} from "./geometry";
import { useTimelineHitTest } from "./useTimelineHitTest";
import { magnetBeat } from "./magnet";
import type { GhostState } from "./types";
import type { Marker, MarkerTrack } from "../../types";

type Mode =
  | "idle"
  | "scrub"
  | "placeBpm"
  | "placeMarker"
  | "dragBpm"
  | "dragMarker"
  | "brushAdd"
  | "brushErase"
  | "boxSelect"
  | "loopSelect"
  | "pan";

type BoxRect = { x0: number; y0: number; x1: number; y1: number };

/**
 * Pointer state machine for the timeline: placement, dragging, brushing,
 * box-select, scrubbing and panning. Rendering and hit testing live in
 * sibling modules; this only turns pointer events into project edits.
 */
export function useTimelineGestures(opts: {
  rootEl: Ref<HTMLElement | null>;
  markDirty: () => void;
  openCard: (x: number, y: number) => void;
}) {
  const project = useProjectStore();
  const transport = useTransportStore();
  const selection = useSelectionStore();
  const view = useViewStore();
  const ui = useUiStore();
  const settings = useSettingsStore();
  const { hitMarkerAt, hitBpmAt } = useTimelineHitTest();

  let mode: Mode = "idle";
  let activePointer = -1;
  let gestureOn = false;
  let downX = 0;
  let downY = 0;
  let moved = false;
  let dragId: string | null = null;
  let dragIds: string[] = [];
  let dragStartBeats = new Map<string, number>();
  let grabStartBeat = 0;
  let panStartX = 0;
  let panStartY = 0;
  let panStartViewX = 0;
  let panStartViewY = 0;
  let brushLastKey = "";

  const hover = { x: -1, y: -1 };
  const cursor = ref("default");
  const ghostState = ref<GhostState | null>(null);
  const boxRect = ref<BoxRect | null>(null);

  const trackAt = (i: number): MarkerTrack | undefined => project.tracks[i];

  /** Canvas gestures must ignore pointer events that land on a sticky note. */
  function isOverNote(e: Event): boolean {
    const target = e.target;
    return target instanceof Element && !!target.closest(".note");
  }

  /** Reflect what the pointer is over / doing in the cursor shape. */
  function updateCursor(x: number, y: number): void {
    if (mode === "pan") {
      cursor.value = "grabbing";
      return;
    }
    if (
      mode === "dragMarker" ||
      mode === "dragBpm" ||
      mode === "scrub" ||
      mode === "boxSelect" ||
      mode === "loopSelect"
    ) {
      cursor.value = "ew-resize";
      return;
    }
    if (mode === "brushAdd" || mode === "brushErase") {
      cursor.value = "crosshair";
      return;
    }
    const lane = laneKindAt(y, view.y);
    if (lane.kind === "bpm") {
      cursor.value = hitBpmAt(x, y) ? "ew-resize" : "copy";
      return;
    }
    if (lane.kind === "marker") {
      if (hitMarkerAt(x, y)) cursor.value = "ew-resize";
      else cursor.value = ui.quickPlace ? "crosshair" : "copy";
      return;
    }
    cursor.value = "default";
  }

  // ---- quick place / erase brush ----

  function eraseMarkerAt(trackId: string, beat: number): void {
    let best: Marker | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (const m of markersInTrack(trackId)) {
      const d = Math.abs(m.beat - beat);
      if (d < bestDiff) {
        best = m;
        bestDiff = d;
      }
    }
    if (best && bestDiff < 1 / 256) removeMarker(best.id);
  }

  function brushStep(x: number, y: number): void {
    const lane = laneKindAt(y, view.y);
    if (lane.kind !== "marker") return;
    const track = trackAt(lane.index);
    if (!track) return;
    const raw = Math.max(0, beatOfTime(screenToTime(x)));
    const beat = doSnap(raw, view.snapEnabled, gridDivAtBeat(raw));
    const key = `${track.id}@${beat}`;
    if (key === brushLastKey) return;
    brushLastKey = key;
    if (mode === "brushAdd") {
      addMarker(track.id, beat);
    } else if (mode === "brushErase") {
      eraseMarkerAt(track.id, beat);
    }
  }

  function dragExcludeIds(): Set<string> {
    const out = new Set(dragIds);
    for (const marker of project.markers) {
      if (marker.parentId && out.has(marker.parentId)) out.add(marker.id);
    }
    return out;
  }

  function setBox(x: number, y: number): void {
    boxRect.value = {
      x0: Math.min(downX, x),
      y0: Math.min(downY, y),
      x1: Math.max(downX, x),
      y1: Math.max(downY, y),
    };
    opts.markDirty();
  }

  function applyBoxSelection(): void {
    const b = boxRect.value;
    if (!b) return;
    const picked: string[] = [];
    project.tracks.forEach((tr, idx) => {
      // screen y of this lane's vertical centre
      const my =
        RULER_H - view.y + BPM_LANE_H + idx * MARKER_LANE_H + MARKER_LANE_H / 2;
      if (my < b.y0 || my > b.y1) return;
      for (const m of markersInTrack(tr.id)) {
        if (m.parentId) continue; // box selects the loop parents only
        const mx = timeToScreenX(storeMarkerTime(m));
        if (mx >= b.x0 && mx <= b.x1) picked.push(m.id);
      }
    });
    boxSelectMarkers(picked);
  }

  // ---- events ----

  function onContext(e: MouseEvent): void {
    if (ui.quickPlace) return; // quick-erase brush handles right button
    const rect = opts.rootEl.value!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (y < RULER_H) return;
    const mk = hitMarkerAt(x, y);
    if (mk) {
      const before = project.markers.length;
      if (removeMarker(mk.id)) {
        toast.undo(
          t("dialogs.deletedMarkers", {
            n: before - project.markers.length,
          }),
          undo,
        );
      }
      closeCard();
      ghostState.value = null;
      return;
    }
    const bp = hitBpmAt(x, y);
    if (bp) {
      if (removeBpmPoint(bp.id)) {
        toast.undo(t("dialogs.deletedBpm"), undo);
      }
      closeCard();
      ghostState.value = null;
    }
  }

  function onPointerDown(e: PointerEvent): void {
    // middle-button drag pans the timeline (same as Shift+wheel horizontal scroll)
    if (e.button === 1) {
      selection.cardOpen = false;
      holdFollow();
      const rect = opts.rootEl.value!.getBoundingClientRect();
      panStartX = e.clientX - rect.left;
      panStartY = e.clientY - rect.top;
      panStartViewX = view.x;
      panStartViewY = view.y;
      mode = "pan";
      activePointer = e.pointerId;
      opts.rootEl.value!.setPointerCapture(activePointer);
      return;
    }
    if (e.button !== 0 && !(ui.quickPlace && e.button === 2)) return;
    const rect = opts.rootEl.value!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // A left press outside an open property card dismisses it. Hitting another
    // marker / BPM point falls through so the card moves straight to it.
    if (selection.cardOpen && e.button === 0) {
      if (!hitMarkerAt(x, y) && !hitBpmAt(x, y)) {
        closeCard();
        ghostState.value = null;
        return;
      }
    }
    // a fresh press dismisses the card; it reopens only on a clean click/release
    selection.cardOpen = false;
    downX = x;
    downY = y;
    boxRect.value = null;
    opts.markDirty();
    moved = false;
    activePointer = e.pointerId;
    opts.rootEl.value!.setPointerCapture(activePointer);

    // right-button quick-erase brush (sweep deletes markers under the cursor)
    if (e.button === 2) {
      const rl = laneKindAt(y, view.y);
      if (rl.kind === "marker" && rl.index < project.tracks.length) {
        mode = "brushErase";
        brushLastKey = "";
        historyGestureBegin();
        gestureOn = true;
        brushStep(x, y);
      }
      return;
    }

    if (y < RULER_H) {
      if (e.shiftKey) {
        mode = "loopSelect";
        return;
      }
      mode = "scrub";
      if (transport.playing) disableFollowOnScrub();
      return;
    }
    const lane0 = laneKindAt(y, view.y);
    if (lane0.kind === "marker" && lane0.index >= project.tracks.length) {
      // blank area without a track -> drag the red playhead (scrub)
      mode = "scrub";
      if (transport.playing) disableFollowOnScrub();
      return;
    }
    const bpmHit = hitBpmAt(x, y);
    if (bpmHit) {
      mode = "dragBpm";
      dragId = bpmHit.id;
      select("bpm", bpmHit.id);
      return;
    }
    const mkHit = hitMarkerAt(x, y);
    if (mkHit) {
      const main = resolveMainMarker(mkHit);
      if (!main) return;
      if (e.ctrlKey || e.metaKey) {
        toggleMarkerSelect(main.id);
        mode = "idle";
        return;
      }
      mode = "dragMarker";
      dragId = main.id;
      ui.activeTrackId = main.trackId;
      const selected = markerSelectionIds();
      const inSelection = selected.includes(main.id);
      if (!inSelection) selectSingleMarker(main.id);
      dragIds = inSelection ? selected : [main.id];
      dragStartBeats = new Map(
        dragIds.map((id) => [id, findMarker(id)?.beat ?? 0]),
      );
      // remember the clicked point (may be a child) so the grabbed point stays
      // under the mouse while every selected marker translates by the same delta.
      grabStartBeat = doSnap(
        mkHit.beat,
        view.snapEnabled,
        gridDivAtBeat(mkHit.beat),
      );
      return;
    }
    if (ui.quickPlace) {
      const ql = laneKindAt(y, view.y);
      if (ql.kind === "marker" && ql.index < project.tracks.length) {
        // sweep-placement brush over empty lane cells
        mode = "brushAdd";
        brushLastKey = "";
        historyGestureBegin();
        gestureOn = true;
        brushStep(x, y);
        return;
      }
    }
    const lane = laneKindAt(y, view.y);
    mode = lane.kind === "bpm" ? "placeBpm" : "placeMarker";
    if (lane.kind === "marker") closeCard();
  }

  function seekPlayhead(msRaw?: number): void {
    const ms = Math.max(
      0,
      Math.min(msRaw ?? transport.positionMs, contentEndMs()),
    );
    transport.positionMs = ms;
    seekTo(ms);
  }

  function onPointerMove(e: PointerEvent): void {
    if (isOverNote(e)) {
      cursor.value = "default"; // note drag is handled by the note overlay, not the canvas
      return;
    }
    const rect = opts.rootEl.value!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    hover.x = x;
    hover.y = y;
    updateCursor(x, y);
    if (Math.abs(x - downX) > 3 || Math.abs(y - downY) > 3) moved = true;

    if (mode === "pan") {
      holdFollow();
      setScroll(
        panStartViewX - (x - panStartX),
        panStartViewY - (y - panStartY),
      );
      return;
    }
    const lane = laneKindAt(y, view.y);
    if (mode === "loopSelect") {
      if (moved) {
        const a = screenToTime(downX);
        const b = screenToTime(x);
        setLoopRange(Math.min(a, b), Math.max(a, b), true);
      }
      return;
    }
    if (mode === "scrub") {
      seekPlayhead(screenToTime(x));
      return;
    }
    if (!gestureOn && (mode === "dragBpm" || mode === "dragMarker")) {
      historyGestureBegin();
      gestureOn = true;
    }
    if (mode === "dragBpm" && dragId) {
      const rawBeat = Math.max(0, beatOfTime(screenToTime(x)));
      const raw = e.altKey
        ? rawBeat
        : (magnetBeat(x) ??
          doSnap(rawBeat, view.snapEnabled, gridDivAtBeat(rawBeat)));
      if (!e.altKey && !bpmOccupy(project.bpmPoints, raw))
        updateBpmPoint(dragId, { beat: raw });
    } else if (mode === "dragMarker" && dragId && dragIds.length) {
      // holding Alt temporarily disables snap (free, un-gridded drag)
      const rawBeat = Math.max(0, beatOfTime(screenToTime(x)));
      const raw = e.altKey
        ? rawBeat
        : (magnetBeat(x, dragExcludeIds()) ??
          doSnap(rawBeat, view.snapEnabled, gridDivAtBeat(rawBeat)));
      let delta = raw - grabStartBeat;
      let minStart = Number.POSITIVE_INFINITY;
      for (const id of dragIds) {
        minStart = Math.min(minStart, dragStartBeats.get(id) ?? 0);
      }
      if (delta < -minStart) delta = -minStart;
      moveMarkers(
        dragIds.map((id) => ({
          id,
          beat: (dragStartBeats.get(id) ?? 0) + delta,
        })),
      );
    } else if (mode === "brushAdd" || mode === "brushErase") {
      brushStep(x, y);
    } else if (mode === "placeMarker" && moved) {
      // quick place is off: a drag on a marker lane turns into a box selection
      mode = "boxSelect";
      setBox(x, y);
    } else if (mode === "boxSelect") {
      setBox(x, y);
    } else if ((mode === "placeBpm" || mode === "placeMarker") && lane) {
      updateGhost(lane);
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (isOverNote(e)) return; // note drag is handled by the note overlay, not the canvas
    if (activePointer !== e.pointerId) return;
    const rect = opts.rootEl.value!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (mode === "boxSelect") applyBoxSelection();
    if (mode === "loopSelect" && !moved) clearLoop();

    if (!moved) {
      if (mode === "scrub") {
        seekPlayhead();
      } else if (mode === "placeBpm") {
        const raw = Math.max(0, beatOfTime(screenToTime(x)));
        const beat =
          magnetBeat(x) ?? doSnap(raw, view.snapEnabled, gridDivAtBeat(raw));
        const pt = addBpmPoint(beat);
        if (pt) opts.openCard(x, y);
      } else if (mode === "placeMarker") {
        const lane = laneKindAt(y, view.y);
        const track = lane.kind === "marker" ? trackAt(lane.index) : undefined;
        if (track) {
          const raw = Math.max(0, beatOfTime(screenToTime(x)));
          const beat =
            magnetBeat(x) ?? doSnap(raw, view.snapEnabled, gridDivAtBeat(raw));
          const placed = addMarker(track.id, beat);
          const st = settings.settings;
          if (placed && st.selectAfterPlace) selectSingleMarker(placed.id);
          if (placed && st.openCardAfterPlace) opts.openCard(x, y);
        }
      } else if (mode === "dragBpm") {
        opts.openCard(x, y);
      } else if (mode === "dragMarker") {
        opts.openCard(x, y);
      }
    }
    if (moved && mode === "dragMarker" && dragId && dragIds.length === 1) {
      const lane = laneKindAt(y, view.y);
      const target = lane.kind === "marker" ? trackAt(lane.index) : undefined;
      const marker = findMarker(dragId);
      if (target && marker && marker.trackId !== target.id) {
        changeMarkerTrack(dragId, target.id);
        ui.activeTrackId = target.id;
      }
    }
    if (gestureOn) {
      historyGestureEnd();
      gestureOn = false;
    }
    mode = "idle";
    dragId = null;
    dragIds = [];
    dragStartBeats = new Map();
    grabStartBeat = 0;
    brushLastKey = "";
    activePointer = -1;
    boxRect.value = null;
    opts.markDirty();
    ghostState.value = null;
  }

  function onPointerCancel(): void {
    if (gestureOn) {
      historyGestureEnd();
      gestureOn = false;
    }
    mode = "idle";
    dragId = null;
    dragIds = [];
    dragStartBeats = new Map();
    grabStartBeat = 0;
    brushLastKey = "";
    activePointer = -1;
    boxRect.value = null;
    opts.markDirty();
    ghostState.value = null;
  }

  function updateGhost(lane: { kind: "bpm" | "marker"; index: number }): void {
    if (!lane) return;
    const laneRow = visibleRows(
      view.vh + RULER_H,
      view.y,
      project.tracks.length,
    ).find((r) => (lane.kind === "bpm" ? r.bpm : !r.bpm && r.i === lane.index));
    if (!laneRow) return;
    const raw = Math.max(0, beatOfTime(screenToTime(hover.x)));
    const beat =
      magnetBeat(hover.x) ?? doSnap(raw, view.snapEnabled, gridDivAtBeat(raw));
    const ok =
      lane.kind === "bpm"
        ? !bpmOccupy(project.bpmPoints, beat)
        : !markerOccupy(markersInTrack(trackAt(lane.index)!.id), beat);
    ghostState.value = {
      beat,
      ok,
      y0: laneRow.y + 4,
      y1: laneRow.y + laneRow.h,
    };
  }

  return {
    hover,
    cursor,
    ghostState,
    boxRect,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onContext,
  };
}
