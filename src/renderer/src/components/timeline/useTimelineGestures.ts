import { ref, type Ref } from "vue";
import {
  addBpmPoint,
  addMarker,
  gridDivAtBeat,
  markersInTrack,
  moveMarker,
  removeBpmPoint,
  removeMarker,
  resolveMainMarker,
  updateBpmPoint,
  useProjectStore,
} from "../../stores/project";
import {
  boxSelectMarkers,
  closeCard,
  select,
  selectSingleMarker,
  toggleMarkerSelect,
  useSelectionStore,
} from "../../stores/selection";
import {
  useTransportStore,
  disableFollowOnScrub,
} from "../../stores/transport";
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
import { seekTo } from "../../services/playback";
import { historyGestureBegin, historyGestureEnd } from "../../services/history";
import { BPM_LANE_H, MARKER_LANE_H, RULER_H } from "../../metrics";
import {
  bpmOccupy,
  doSnap,
  laneKindAt,
  markerOccupy,
  visibleRows,
} from "./geometry";
import { useTimelineHitTest } from "./useTimelineHitTest";
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
  const { hitMarkerAt, hitBpmAt } = useTimelineHitTest();

  let mode: Mode = "idle";
  let activePointer = -1;
  let gestureOn = false;
  let downX = 0;
  let downY = 0;
  let moved = false;
  let dragId: string | null = null;
  let dragTrackId: string | null = null;
  let dragGroupIds = new Set<string>();
  let grabStartBeat = 0;
  let mainStartBeat = 0;
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

  function loopGroupIds(mainId: string): Set<string> {
    const s = new Set<string>([mainId]);
    for (const c of project.markers) if (c.parentId === mainId) s.add(c.id);
    return s;
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
      mode === "boxSelect"
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
      removeMarker(mk.id);
      closeCard();
      ghostState.value = null;
      return;
    }
    const bp = hitBpmAt(x, y);
    if (bp) {
      removeBpmPoint(bp.id);
      closeCard();
      ghostState.value = null;
    }
  }

  function onPointerDown(e: PointerEvent): void {
    // middle-button drag pans the timeline (same as Shift+wheel horizontal scroll)
    if (e.button === 1) {
      selection.cardOpen = false;
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
    // A left press outside an open property card only dismisses it. Without this
    // the click falls through to marker placement and leaves a stray marker when
    // the user just meant to click away and close the popup. closeCard() also
    // drops the selection so the marker stops being highlighted on exit.
    if (selection.cardOpen && e.button === 0) {
      closeCard();
      ghostState.value = null;
      return;
    }
    // a fresh press dismisses the card; it reopens only on a clean click/release
    selection.cardOpen = false;
    const rect = opts.rootEl.value!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
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
      dragTrackId = main.trackId;
      dragGroupIds = loopGroupIds(main.id);
      // remember the clicked point (may be a child) and the main beat so the
      // grabbed point stays under the mouse while the main translates by the same delta.
      grabStartBeat = doSnap(
        mkHit.beat,
        view.snapEnabled,
        gridDivAtBeat(mkHit.beat),
      );
      mainStartBeat = main.beat;
      selectSingleMarker(main.id);
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
      setScroll(
        panStartViewX - (x - panStartX),
        panStartViewY - (y - panStartY),
      );
      return;
    }
    const lane = laneKindAt(y, view.y);
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
      const raw = doSnap(rawBeat, view.snapEnabled, gridDivAtBeat(rawBeat));
      if (!e.altKey && !bpmOccupy(project.bpmPoints, raw))
        updateBpmPoint(dragId, { beat: raw });
    } else if (mode === "dragMarker" && dragId && dragTrackId) {
      // holding Alt temporarily disables snap (free, un-gridded drag)
      const rawBeat = Math.max(0, beatOfTime(screenToTime(x)));
      const raw = e.altKey
        ? rawBeat
        : doSnap(rawBeat, view.snapEnabled, gridDivAtBeat(rawBeat));
      // children are regenerated with fresh ids on every parent move, so refresh
      // the exception set each frame or the parent gets blocked by its own children.
      dragGroupIds = loopGroupIds(dragId);
      // translate the whole group by the grabbed point's delta so the point under
      // the cursor stays grabbed; the main moves by the same offset.
      const mainBeat = mainStartBeat + (raw - grabStartBeat);
      const ok = !e.altKey
        ? !markerOccupy(markersInTrack(dragTrackId), mainBeat, dragGroupIds)
        : true;
      if (ok) moveMarker(dragId, mainBeat, true);
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

    if (!moved) {
      if (mode === "scrub") {
        seekPlayhead();
      } else if (mode === "placeBpm") {
        const raw = Math.max(0, beatOfTime(screenToTime(x)));
        const beat = doSnap(raw, view.snapEnabled, gridDivAtBeat(raw));
        const pt = addBpmPoint(beat);
        if (pt) opts.openCard(x, y);
      } else if (mode === "placeMarker") {
        const lane = laneKindAt(y, view.y);
        const track = lane.kind === "marker" ? trackAt(lane.index) : undefined;
        if (track) {
          const raw = Math.max(0, beatOfTime(screenToTime(x)));
          const beat = doSnap(raw, view.snapEnabled, gridDivAtBeat(raw));
          addMarker(track.id, beat);
          // no popup on placement; click the marker again to open its card
        }
      } else if (mode === "dragBpm") {
        opts.openCard(x, y);
      } else if (mode === "dragMarker") {
        opts.openCard(x, y);
      }
    }
    if (gestureOn) {
      historyGestureEnd();
      gestureOn = false;
    }
    mode = "idle";
    dragId = null;
    dragTrackId = null;
    dragGroupIds = new Set<string>();
    grabStartBeat = 0;
    mainStartBeat = 0;
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
    dragTrackId = null;
    dragGroupIds = new Set<string>();
    grabStartBeat = 0;
    mainStartBeat = 0;
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
    const beat = doSnap(raw, view.snapEnabled, gridDivAtBeat(raw));
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
