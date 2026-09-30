<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  beatOfTime,
  timeOfBeat,
  markerTime as storeMarkerTime,
  contentEndMs,
} from "../services/timeline";
import { seekTo } from "../services/playback";
import { historyGestureBegin, historyGestureEnd } from "../services/history";
import {
  bpmOccupy,
  doSnap,
  laneKindAt,
  markerOccupy,
  visibleRows,
} from "./timeline/geometry";
import { useTimelineCanvas } from "./timeline/useTimelineCanvas";
import type { GhostState } from "./timeline/types";
import {
  useProjectStore,
  markersInTrack,
  addMarker,
  addBpmPoint,
  updateBpmPoint,
  moveMarker,
  removeMarker,
  removeBpmPoint,
  resolveMainMarker,
} from "../stores/project";
import { useTransportStore, disableFollowOnScrub } from "../stores/transport";
import {
  useSelectionStore,
  select,
  closeCard,
  selectSingleMarker,
  toggleMarkerSelect,
  markerSelectionIds,
  boxSelectMarkers,
} from "../stores/selection";
import { useSettingsStore } from "../stores/settings";
import { useViewStore } from "../stores/view";
import { useUiStore } from "../stores/ui";
import TimelineNotes from "./timeline/TimelineNotes.vue";
import TimelineScrollbars from "./timeline/TimelineScrollbars.vue";
import TimelinePropCard from "./timeline/TimelinePropCard.vue";
import { setScroll, timeToScreenX, screenToTime } from "../stores/view";
import {
  RULER_H,
  BPM_LANE_H,
  MARKER_LANE_H,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
} from "../metrics";
import type { Marker, MarkerTrack, BpmPoint } from "../types";

const { t } = useI18n();
const project = useProjectStore();
const transport = useTransportStore();
const selection = useSelectionStore();
const settings = useSettingsStore();
const view = useViewStore();
const ui = useUiStore();

const rootEl = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);

let mode:
  | "idle"
  | "scrub"
  | "placeBpm"
  | "placeMarker"
  | "dragBpm"
  | "dragMarker"
  | "brushAdd"
  | "brushErase"
  | "boxSelect"
  | "pan" = "idle";
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
let boxRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
let panStartX = 0;
let panStartY = 0;
let panStartViewX = 0;
let panStartViewY = 0;

const hover = { x: -1, y: -1 };
const cursor = ref("default");

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

const trackAt = (i: number): MarkerTrack | undefined => project.tracks[i];

// ---- sticky notes overlay (rendered by TimelineNotes) ----

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

// ---- canvas, drawing & frame loop ----

const ghostState = ref<GhostState | null>(null);

const { markDirty } = useTimelineCanvas({
  rootEl,
  canvasEl,
  getScene: () => ({
    canvas: canvasEl.value,
    boxRect,
    ghost: ghostState.value,
    hover,
  }),
});

// ---- pointer helpers ----

const HIT_PX = 7;

function hitMarkerAt(x: number, y: number): Marker | null {
  const lane = laneKindAt(y, view.y);
  if (lane.kind !== "marker") return null;
  const track = trackAt(lane.index);
  if (!track) return null;
  for (const m of markersInTrack(track.id)) {
    if (Math.abs(timeToScreenX(storeMarkerTime(m)) - x) <= HIT_PX) return m;
  }
  return null;
}

function hitBpmAt(x: number, y: number): BpmPoint | null {
  const lane = laneKindAt(y, view.y);
  if (lane.kind !== "bpm") return null;
  for (const p of project.bpmPoints) {
    if (Math.abs(timeToScreenX(timeOfBeat(p.beat)) - x) <= HIT_PX) return p;
  }
  return null;
}

// Where to anchor the property card (screen coords inside the editor). The card
// component owns its own size clamping / dragging from this anchor.
const cardAnchor = ref({ x: 0, y: 0 });

const openCard = (x: number, y: number): void => {
  selection.cardOpen = true;
  cardAnchor.value = { x, y };
};

function onCardClose(): void {
  closeCard();
  ghostState.value = null;
}

// ---- quick place / erase brush ----

let brushLastKey = "";

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
  const beat = doSnap(
    Math.max(0, beatOfTime(screenToTime(x))),
    view.snapEnabled,
    view.snapDiv,
  );
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
  boxRect = {
    x0: Math.min(downX, x),
    y0: Math.min(downY, y),
    x1: Math.max(downX, x),
    y1: Math.max(downY, y),
  };
  markDirty();
}

function applyBoxSelection(): void {
  const b = boxRect;
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
  const rect = rootEl.value!.getBoundingClientRect();
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
    const rect = rootEl.value!.getBoundingClientRect();
    panStartX = e.clientX - rect.left;
    panStartY = e.clientY - rect.top;
    panStartViewX = view.x;
    panStartViewY = view.y;
    mode = "pan";
    activePointer = e.pointerId;
    rootEl.value!.setPointerCapture(activePointer);
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
  const rect = rootEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  downX = x;
  downY = y;
  boxRect = null;
  markDirty();
  moved = false;
  activePointer = e.pointerId;
  rootEl.value!.setPointerCapture(activePointer);

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
    grabStartBeat = doSnap(mkHit.beat, view.snapEnabled, view.snapDiv);
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

function onPointerMove(e: PointerEvent): void {
  if (isOverNote(e)) {
    cursor.value = "default"; // note drag is handled by the note overlay, not the canvas
    return;
  }
  const rect = rootEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  hover.x = x;
  hover.y = y;
  updateCursor(x, y);
  if (Math.abs(x - downX) > 3 || Math.abs(y - downY) > 3) moved = true;

  if (mode === "pan") {
    setScroll(panStartViewX - (x - panStartX), panStartViewY - (y - panStartY));
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
    const raw = doSnap(
      Math.max(0, beatOfTime(screenToTime(x))),
      view.snapEnabled,
      view.snapDiv,
    );
    if (!e.altKey && !bpmOccupy(project.bpmPoints, raw))
      updateBpmPoint(dragId, { beat: raw });
  } else if (mode === "dragMarker" && dragId && dragTrackId) {
    // holding Alt temporarily disables snap (free, un-gridded drag)
    const rawBeat = Math.max(0, beatOfTime(screenToTime(x)));
    const raw = e.altKey
      ? rawBeat
      : doSnap(rawBeat, view.snapEnabled, view.snapDiv);
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

function seekPlayhead(msRaw?: number): void {
  const ms = Math.max(
    0,
    Math.min(msRaw ?? transport.positionMs, contentEndMs()),
  );
  transport.positionMs = ms;
  seekTo(ms);
}

function onPointerUp(e: PointerEvent): void {
  if (isOverNote(e)) return; // note drag is handled by the note overlay, not the canvas
  if (activePointer !== e.pointerId) return;
  const rect = rootEl.value!.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (mode === "boxSelect") applyBoxSelection();

  if (!moved) {
    if (mode === "scrub") {
      seekPlayhead();
    } else if (mode === "placeBpm") {
      const beat = doSnap(
        Math.max(0, beatOfTime(screenToTime(x))),
        view.snapEnabled,
        view.snapDiv,
      );
      const pt = addBpmPoint(beat);
      if (pt) openCard(x, y);
    } else if (mode === "placeMarker") {
      const lane = laneKindAt(y, view.y);
      const track = lane.kind === "marker" ? trackAt(lane.index) : undefined;
      if (track) {
        const beat = doSnap(
          Math.max(0, beatOfTime(screenToTime(x))),
          view.snapEnabled,
          view.snapDiv,
        );
        addMarker(track.id, beat);
        // no popup on placement; click the marker again to open its card
      }
    } else if (mode === "dragBpm") {
      openCard(x, y);
    } else if (mode === "dragMarker") {
      openCard(x, y);
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
  boxRect = null;
  markDirty();
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
  boxRect = null;
  markDirty();
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
  const beat = doSnap(raw, view.snapEnabled, view.snapDiv);
  const ok =
    lane.kind === "bpm"
      ? !bpmOccupy(project.bpmPoints, beat)
      : !markerOccupy(markersInTrack(trackAt(lane.index)!.id), beat);
  ghostState.value = { beat, ok, y0: laneRow.y + 4, y1: laneRow.y + laneRow.h };
}

const ANIM_MS = 100;
let wheelAnimRaf = 0;

function cancelWheelAnim(): void {
  cancelAnimationFrame(wheelAnimRaf);
  wheelAnimRaf = 0;
}

/** interruptible ease-out animator over `durMs`; apply receives 0→1 eased progress */
function animWheel(durMs: number, apply: (k: number) => void): void {
  cancelWheelAnim();
  const t0 = performance.now();
  const step = (): void => {
    const k = Math.min(1, (performance.now() - t0) / durMs);
    apply(1 - Math.pow(1 - k, 3));
    if (k < 1) wheelAnimRaf = requestAnimationFrame(step);
    else wheelAnimRaf = 0;
  };
  wheelAnimRaf = requestAnimationFrame(step);
}

function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const anim = settings.settings.animEnabled;
  if (e.ctrlKey || e.metaKey) {
    // zoom anchored on the currently visible centre of the timeline
    const cx = view.vw / 2;
    const from = view.pxPerSec;
    const target = Math.min(
      MAX_PX_PER_SEC,
      Math.max(
        MIN_PX_PER_SEC,
        view.pxPerSec * (e.deltaY < 0 ? 1.25 : 1 / 1.25),
      ),
    );
    const tc = screenToTime(cx); // time currently at the viewport centre
    const applyZoom = (k: number): void => {
      const p = from + (target - from) * k;
      view.pxPerSec = p;
      setScroll(Math.max(0, (tc / 1000) * p - cx), view.y);
    };
    if (anim) animWheel(ANIM_MS, applyZoom);
    else {
      view.pxPerSec = target;
      setScroll(Math.max(0, (tc / 1000) * target - cx), view.y);
    }
    return;
  }
  const dx = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
  const dy = e.deltaX !== 0 || e.shiftKey ? 0 : e.deltaY;
  if (anim) {
    const x0 = view.x;
    const y0 = view.y;
    const x1 = x0 + (dx || 0);
    const y1 = y0 + dy;
    animWheel(ANIM_MS, (k) => {
      setScroll(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
    });
  } else {
    setScroll(view.x + (dx || 0), view.y + dy);
  }
}

function onCardKey(e: KeyboardEvent): void {
  if ((e.target as HTMLElement)?.tagName === "INPUT") return;
  if (e.key === "Escape") {
    closeCard();
    ghostState.value = null;
  }
}

function deleteSelected(): void {
  const sel = selection.selected;
  if (sel.kind === "marker" && sel.id) removeMarker(sel.id);
  else if (sel.kind === "bpm" && sel.id) removeBpmPoint(sel.id);
  closeCard();
  ghostState.value = null;
}

onMounted(() => {
  window.addEventListener("keydown", onCardKey);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onCardKey);
});

const summary = computed(() => {
  const mm = project.markers.length;
  return `${t("sidebar.markerTrack")} × ${project.tracks.length} · ${t("sidebar.markers")} ${mm}`;
});

/** When multiple markers are selected, show start/end ms of the selection range. */
const selectionMs = computed<string | null>(() => {
  const ids = markerSelectionIds();
  if (ids.length < 2) return null;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const id of ids) {
    const m = project.markers.find((x) => x.id === id);
    if (!m) continue;
    const ms = storeMarkerTime(m);
    if (ms < lo) lo = ms;
    if (ms > hi) hi = ms;
  }
  if (!Number.isFinite(lo)) return null;
  return `⌖ ${Math.round(lo)}ms – ${Math.round(hi)}ms`;
});
</script>

<template>
  <div
    ref="rootEl"
    class="editor"
    :style="{ cursor }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @wheel="onWheel"
    @contextmenu.prevent="onContext"
  >
    <canvas ref="canvasEl" class="editor-canvas" />

    <TimelineNotes />

    <div
      v-if="!transport.hasAudio && project.markers.length === 0"
      class="editor-hint"
    >
      <div>{{ t("timeline.none") }}</div>
      <div class="editor-hint-sub">
        {{ t("timeline.hintNew") }}
        <br />{{ t("timeline.hintBeatAxis") }}
      </div>
    </div>

    <TimelineScrollbars />

    <div class="editor-statusbar">
      <span>{{ summary }}</span>
      <span class="sep">·</span>
      <span>{{ t("timeline.tempoHint") }}</span>
      <span v-if="view.snapEnabled" class="sep">·</span>
      <span v-if="view.snapEnabled" class="num">{{
        t("timeline.snap", { div: view.snapDiv })
      }}</span>
      <span v-if="selectionMs" class="sep">·</span>
      <span v-if="selectionMs" class="num">{{ selectionMs }}</span>
    </div>

    <TimelinePropCard
      :anchor="cardAnchor"
      @close="onCardClose"
      @delete="deleteSelected"
    />
  </div>
</template>

<style scoped>
.editor {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  background: var(--bdg-bg);
}
.editor-canvas {
  position: absolute;
  inset: 0;
  pointer-events: none;
  display: block;
}
.editor-hint {
  position: absolute;
  inset: 0 0 40px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  pointer-events: none;
  color: var(--bdg-text-dim);
  text-align: center;
  font-size: calc(14px * var(--bdg-font-scale, 1));
}
.editor-hint-sub {
  font-size: calc(12px * var(--bdg-font-scale, 1));
  opacity: 0.8;
}
.editor-statusbar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 22px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  font-size: calc(11px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
  background: rgb(var(--bdg-bg-rgb) / 0.88);
  border-top: 1px solid var(--bdg-border);
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
}
.editor-statusbar .sep {
  opacity: 0.4;
}
</style>
