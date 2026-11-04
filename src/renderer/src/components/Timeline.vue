<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  beatOfTime,
  formatTime,
  markerTime as storeMarkerTime,
  timeOfBeat,
} from "../services/timeline";
import { useTimelineCanvas } from "./timeline/useTimelineCanvas";
import { useTimelineGestures } from "./timeline/useTimelineGestures";
import { useTimelineWheel } from "./timeline/useTimelineWheel";
import {
  findBpmPoint,
  findMarker,
  findTrack,
  gridDivAtBeat,
  removeBpmPoint,
  removeMarker,
  useProjectStore,
} from "../stores/project";
import { useTransportStore } from "../stores/transport";
import {
  closeCard,
  markerSelectionIds,
  useSelectionStore,
} from "../stores/selection";
import { useViewStore } from "../stores/view";
import TimelineNotes from "./timeline/TimelineNotes.vue";
import PluginTimelineOverlays from "./timeline/PluginTimelineOverlays.vue";
import TimelineScrollbars from "./timeline/TimelineScrollbars.vue";
import TimelinePropCard from "./timeline/TimelinePropCard.vue";

const { t } = useI18n();
const project = useProjectStore();
const transport = useTransportStore();
const selection = useSelectionStore();
const view = useViewStore();

const rootEl = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);

// Where to anchor the property card (screen coords inside the editor). The card
// component owns its own size clamping / dragging from this anchor.
const cardAnchor = ref({ x: 0, y: 0 });

const openCard = (x: number, y: number): void => {
  selection.cardOpen = true;
  cardAnchor.value = { x, y };
};

// `requestRepaint` is bound right after the canvas composable is created; the
// gesture handlers only run from events, by which time the binding is live.
let requestRepaint: () => void = () => {};

const {
  hover,
  cursor,
  ghostState,
  boxRect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onContext,
} = useTimelineGestures({
  rootEl,
  markDirty: () => requestRepaint(),
  openCard,
});

const { markDirty } = useTimelineCanvas({
  rootEl,
  canvasEl,
  getScene: () => ({
    canvas: canvasEl.value,
    boxRect: boxRect.value,
    ghost: ghostState.value,
    hover,
  }),
});
requestRepaint = markDirty;

const { onWheel } = useTimelineWheel();

function onCardClose(): void {
  closeCard();
  ghostState.value = null;
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
    const m = findMarker(id);
    if (!m) continue;
    const ms = storeMarkerTime(m);
    if (ms < lo) lo = ms;
    if (ms > hi) hi = ms;
  }
  if (!Number.isFinite(lo)) return null;
  return `⌖ ${Math.round(lo)}ms – ${Math.round(hi)}ms`;
});

/** Spoken summary of the current selection, for the screen-reader live region. */
const selectionAnnounce = computed(() => {
  const sel = selection.selected;
  if (sel.kind === "marker" && sel.id) {
    const m = findMarker(sel.id);
    if (!m) return "";
    const track = findTrack(m.trackId);
    return `${t("keys.marker")}: ${track?.name ?? ""} ${formatTime(storeMarkerTime(m))}`;
  }
  if (sel.kind === "bpm" && sel.id) {
    const p = findBpmPoint(sel.id);
    if (!p) return "";
    return `${t("keys.bpmPoint")}: ${formatTime(timeOfBeat(p.beat))}`;
  }
  return "";
});
</script>

<template>
  <div
    ref="rootEl"
    class="editor"
    tabindex="0"
    role="application"
    :aria-label="t('timeline.editorLabel')"
    :style="{ cursor }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerCancel"
    @wheel="onWheel"
    @contextmenu.prevent="onContext"
  >
    <canvas ref="canvasEl" class="editor-canvas" aria-hidden="true" />

    <div class="sr-only" role="status" aria-live="polite">
      {{ selectionAnnounce }}
    </div>

    <TimelineNotes />

    <PluginTimelineOverlays />

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
        t("timeline.snap", {
          div: gridDivAtBeat(beatOfTime(transport.positionMs)),
        })
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
.editor:focus-visible {
  outline: 2px solid var(--bdg-accent);
  outline-offset: -2px;
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
  font-size: var(--bdg-fs-14);
}
.editor-hint-sub {
  font-size: var(--bdg-fs-12);
  opacity: 0.8;
}
.editor-statusbar {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 10px;
  height: 22px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  font-size: var(--bdg-fs-11);
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
