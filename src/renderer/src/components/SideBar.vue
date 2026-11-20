<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  useProjectStore,
  markersInTrack,
  addTrack,
  addTypedTrack,
  removeTrack,
  renameTrack,
  moveTrackTo,
  colorTrack,
  setTrackLocked,
  setTrackHidden,
  setBpmLocked,
  addNote,
} from "../stores/project";
import { closeCard } from "../stores/selection";
import { timeOfBeat, formatTime } from "../services/timeline";
import { undo } from "../services/history";
import { toast } from "../ui/toast";
import { lanesTotalH, useViewStore } from "../stores/view";
import { useTransportStore } from "../stores/transport";
import { useUiStore } from "../stores/ui";
import { useSettingsStore } from "../stores/settings";
import { BEAT_FX_DURATION_MS } from "@shared/beatFx";
import { RULER_H, BPM_LANE_H, MARKER_LANE_H } from "../metrics";
import type { MarkerTrack } from "../types";
import {
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  Plus,
  StickyNote,
  Timer,
  X,
} from "@lucide/vue";
import {
  trackTypes as typedTrackTypes,
  typeKeyOf,
  localeText,
} from "../plugins/registry";
import UiColorPicker from "./ui/UiColorPicker.vue";

const { t } = useI18n();
const project = useProjectStore();
const transport = useTransportStore();
const ui = useUiStore();
const settings = useSettingsStore();
const view = useViewStore();

const markerRows = computed<
  Array<{ i: number; track: MarkerTrack; last: string }>
>(() => {
  const y = view.y;
  const vh = view.vh;
  const top = y - BPM_LANE_H;
  const bottom = y + vh - BPM_LANE_H;
  const first = Math.max(0, Math.floor(top / MARKER_LANE_H));
  const last = Math.min(
    project.tracks.length - 1,
    Math.ceil(bottom / MARKER_LANE_H),
  );
  const out: Array<{ i: number; track: MarkerTrack; last: string }> = [];
  for (let i = first; i <= last; i++) {
    const track = project.tracks[i];
    if (track) out.push({ i, track, last: lastFor(track.id) });
  }
  return out;
});

const typedAddItems = computed(() =>
  typedTrackTypes.map((tt) => ({
    key: typeKeyOf(tt.pluginId, tt.def.id),
    label: localeText(tt.def.trackName) || tt.def.id,
  })),
);

const addMenuOpen = ref(false);

function toggleAddMenu(): void {
  addMenuOpen.value = !addMenuOpen.value;
}

function onPickAdd(key: string): void {
  addMenuOpen.value = false;
  if (key) {
    const id = addTypedTrack(key);
    if (id) ui.activeTrackId = id;
  } else {
    const track = addTrack();
    ui.activeTrackId = track.id;
  }
}

function onAddNote(): void {
  addNote({
    timeMs: transport.positionMs,
    y: BPM_LANE_H + MARKER_LANE_H / 2,
  });
}

const isBpmRowVisible = computed(() => {
  const y = view.y;
  return BPM_LANE_H - y > 0 && 0 - y < view.vh;
});

function lastFor(trackId: string): string {
  const arr = markersInTrack(trackId);
  if (!arr.length) return "";
  return formatTime(timeOfBeat(arr[arr.length - 1].beat));
}

const activeTrackId = computed(() => {
  const id = ui.activeTrackId;
  if (id && project.tracks.some((track) => track.id === id)) return id;
  return project.tracks[0]?.id ?? null;
});

function clickTrack(id: string): void {
  ui.activeTrackId = id;
  closeCard();
}

function onRemoveTrack(track: MarkerTrack): void {
  if (!removeTrack(track.id)) return;
  if (ui.activeTrackId === track.id) ui.activeTrackId = null;
  toast.undo(
    t("dialogs.deletedTrack", {
      name: track.name || t("sidebar.trackName"),
    }),
    undo,
  );
}

const draggingTrackId = ref<string | null>(null);
const dropTrackId = ref<string | null>(null);

function onTrackDragStart(e: DragEvent, id: string): void {
  draggingTrackId.value = id;
  dropTrackId.value = null;
  e.dataTransfer?.setData("text/plain", id);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
}

function onTrackDragOver(e: DragEvent, id: string): void {
  if (!draggingTrackId.value) return;
  e.preventDefault();
  if (draggingTrackId.value !== id) dropTrackId.value = id;
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
}

function onTrackDrop(e: DragEvent, id: string): void {
  e.preventDefault();
  const source = draggingTrackId.value;
  const targetIndex = project.tracks.findIndex((track) => track.id === id);
  if (source && targetIndex >= 0) {
    moveTrackTo(source, targetIndex);
    ui.activeTrackId = source;
  }
  draggingTrackId.value = null;
  dropTrackId.value = null;
}

function onTrackDragEnd(): void {
  draggingTrackId.value = null;
  dropTrackId.value = null;
}

const addBtnText = computed(() => t("sidebar.addTrack"));
/** Tracks whose rename input was cancelled with Escape (skip the blur commit). */
const renameCancelled = new Set<string>();

function onRenameBlur(e: FocusEvent, id: string): void {
  const input = e.target as HTMLInputElement;
  if (renameCancelled.delete(id)) return;
  renameTrack(id, input.value);
}

function onRenameEsc(e: KeyboardEvent, id: string, name: string): void {
  const input = e.target as HTMLInputElement;
  renameCancelled.add(id);
  input.value = name;
  input.blur();
}

const glowAtSeen: Record<string, number> = {};
const glowOn = reactive<Record<string, boolean>>({});
const glowTimers: Record<string, number> = {};

function pulseHeaderGlow(id: string): void {
  glowOn[id] = true;
  const prev = glowTimers[id];
  if (prev) window.clearTimeout(prev);
  glowTimers[id] = window.setTimeout(() => {
    glowOn[id] = false;
    delete glowTimers[id];
  }, 110);
}

/** A pulse this recent is still part of the animation that is starting now. */
const GLOW_FRESH_MS = BEAT_FX_DURATION_MS.laneGlow + 10;

watch(
  () => ui.fxPulses.laneGlow,
  (pulses) => {
    const now = performance.now();
    for (const id of Object.keys(pulses)) {
      const at = pulses[id]?.at;
      if (at === undefined) continue;
      if (glowAtSeen[id] === undefined) {
        glowAtSeen[id] = at;
        // The very first pulse after mount used to be swallowed by the
        // "prime the baseline" branch; pulse it while it is still fresh, but
        // don't replay old entries after a remount.
        if (now - at <= GLOW_FRESH_MS) pulseHeaderGlow(id);
        continue;
      }
      if (at !== glowAtSeen[id]) {
        glowAtSeen[id] = at;
        pulseHeaderGlow(id);
      }
    }
  },
  { deep: true, immediate: true },
);

onBeforeUnmount(() => {
  for (const id of Object.keys(glowTimers)) {
    window.clearTimeout(glowTimers[id] as number);
  }
});
</script>

<template>
  <aside class="sidebar">
    <div class="corner" :style="{ height: RULER_H + 'px' }">
      <div class="corner-row">
        <span class="corner-text">{{ t("sidebar.tracks") }}</span>
        <button
          class="add-btn note-btn"
          :title="t('sidebar.addNote')"
          @click="onAddNote"
        >
          <StickyNote class="size-3.5" />
        </button>
        <button
          class="add-btn"
          :class="{ on: addMenuOpen }"
          :title="addBtnText"
          @click="toggleAddMenu"
        >
          <Plus class="size-3.5" />
        </button>
      </div>
      <div v-if="addMenuOpen" class="add-menu">
        <button class="add-item" @click="onPickAdd('')">
          {{ t("sidebar.addBeatTrack") }}
        </button>
        <div v-if="typedAddItems.length" class="add-sep" />
        <button
          v-for="item in typedAddItems"
          :key="item.key"
          class="add-item"
          @click="onPickAdd(item.key)"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <div class="rows">
      <div
        class="scroll-inner"
        :style="{
          height: lanesTotalH() + 'px',
          transform: `translateY(${-view.y}px)`,
        }"
      >
        <!-- BPM 专用轨头 -->
        <div v-if="isBpmRowVisible" class="head bpm-row">
          <span class="accent accent-bpm" />
          <Timer class="h-icon bpm-ic" />
          <span class="t-body">
            <span class="t-name">{{ t("sidebar.bpmTrack") }}</span>
            <span class="t-sub num">
              {{ project.baseBpm.toFixed(1) }} BPM ·
              {{ t("sidebar.bpmTrackHint") }}
            </span>
          </span>
          <span class="h-count num">{{ project.bpmPoints.length }}</span>
          <button
            class="mini icon"
            :class="{ on: project.bpmLocked }"
            :title="t('sidebar.lockTip')"
            @click="setBpmLocked(!project.bpmLocked)"
          >
            <Lock class="size-3" />
          </button>
        </div>

        <!-- 踩点轨头（虚拟滚动子集） -->
        <div
          v-for="row in markerRows"
          :key="row.track.id"
          class="head marker-row"
          :class="{
            active: row.track.id === activeTrackId,
            drop: row.track.id === dropTrackId,
          }"
          :style="{ top: BPM_LANE_H + row.i * MARKER_LANE_H + 'px' }"
          @pointerdown="clickTrack(row.track.id)"
          @dragover="onTrackDragOver($event, row.track.id)"
          @drop="onTrackDrop($event, row.track.id)"
        >
          <span
            class="drag-grip"
            draggable="true"
            :title="t('a11y.reorderTrack')"
            @pointerdown.stop
            @dragstart.stop="onTrackDragStart($event, row.track.id)"
            @dragend.stop="onTrackDragEnd"
          >
            <GripVertical class="size-3" />
          </span>
          <span class="accent" :style="{ background: row.track.color }" />
          <UiColorPicker
            class="color-pick"
            :model-value="row.track.color"
            :disabled="!!row.track.locked"
            :title="t('sidebar.changeColor')"
            @pointerdown.stop
            @update:model-value="(c: string) => colorTrack(row.track.id, c)"
          />
          <span class="t-body">
            <input
              class="t-name-input num"
              :value="row.track.name"
              :placeholder="t('sidebar.trackName')"
              @pointerdown.stop
              @blur="(e: FocusEvent) => onRenameBlur(e, row.track.id)"
              @keyup.enter="
                (e: KeyboardEvent) => (e.target as HTMLInputElement).blur()
              "
              @keyup.esc="
                (e: KeyboardEvent) =>
                  onRenameEsc(e, row.track.id, row.track.name)
              "
            />
            <span class="t-sub num">
              <span :style="{ color: row.track.color }">{{ row.i + 1 }}</span>
              <span v-if="row.last" class="dot">·</span>
              <span v-if="row.last">{{ row.last }}</span>
            </span>
          </span>
          <span class="h-actions">
            <button
              class="mini icon"
              :class="{ on: row.track.locked }"
              :title="t('sidebar.lockTip')"
              :aria-label="t('a11y.lockTrack')"
              :aria-pressed="!!row.track.locked"
              @pointerdown.stop
              @click.stop="setTrackLocked(row.track.id, !row.track.locked)"
            >
              <Lock class="size-3" />
            </button>
            <button
              class="mini icon"
              :class="{ hide: row.track.hidden }"
              :title="t('sidebar.hideTip')"
              :aria-label="t('a11y.hideTrack')"
              :aria-pressed="!!row.track.hidden"
              @pointerdown.stop
              @click.stop="setTrackHidden(row.track.id, !row.track.hidden)"
            >
              <EyeOff v-if="row.track.hidden" class="size-3" />
              <Eye v-else class="size-3" />
            </button>
            <button
              class="mini danger"
              :disabled="project.tracks.length <= 1"
              :title="t('a11y.removeTrack')"
              :aria-label="t('a11y.removeTrack')"
              @pointerdown.stop
              @click.stop="onRemoveTrack(row.track)"
            >
              <X class="size-3" />
            </button>
          </span>
          <span
            v-if="
              ui.fxMasterOn &&
              settings.settings.beatFx.laneGlow &&
              glowOn[row.track.id]
            "
            :key="'g' + (ui.fxPulses.laneGlow[row.track.id]?.at ?? 0)"
            class="row-glow"
            :style="{ background: row.track.color }"
          />
        </div>
      </div>
      <div v-if="project.tracks.length === 0" class="empty-tracks">
        {{ t("sidebar.noTracks") }}
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--bdg-left-w);
  flex: none;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bdg-bg-panel);
  border-right: 1px solid var(--bdg-border);
  overflow: hidden;
}
.corner {
  position: relative;
  flex: none;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 8px;
  border-bottom: 1px solid var(--bdg-border);
  background: rgb(var(--bdg-neutral) / 0.04);
}
.corner-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.corner-text {
  font-size: var(--bdg-fs-10);
  color: var(--bdg-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.add-btn {
  border: none;
  background: rgb(var(--bdg-accent-rgb) / 0.16);
  color: var(--bdg-accent);
  width: var(--bdg-ctl-xs);
  height: var(--bdg-ctl-xs);
  border-radius: var(--bdg-radius, 6px);
  font-size: var(--bdg-fs-14);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
}
.add-btn:hover {
  background: rgb(var(--bdg-accent-rgb) / 0.3);
}
.add-btn.on {
  background: rgb(var(--bdg-accent-rgb) / 0.34);
}
.add-menu {
  position: absolute;
  top: calc(100% - 6px);
  left: 8px;
  right: 8px;
  z-index: var(--bdg-z-menu);
  background: var(--bdg-bg-raised);
  border: 1px solid var(--bdg-border-strong);
  border-radius: var(--bdg-radius, 6px);
  box-shadow: 0 10px 30px var(--bdg-shadow);
  padding: 4px;
  display: flex;
  flex-direction: column;
  max-height: 260px;
  overflow: auto;
}
.add-item {
  text-align: left;
  border: none;
  background: transparent;
  color: var(--bdg-text);
  font-size: var(--bdg-fs-12);
  padding: 6px 8px;
  border-radius: var(--bdg-radius, 6px);
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.add-item:hover {
  background: rgb(var(--bdg-accent-rgb) / 0.16);
  color: var(--bdg-accent);
}
.add-sep {
  flex: none;
  height: 1px;
  margin: 4px 6px;
  background: var(--bdg-border);
}
.color-pick {
  width: var(--bdg-ctl-xs);
  height: var(--bdg-ctl-xs);
  flex: none;
}
.rows {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.scroll-inner {
  position: relative;
  width: 100%;
}
.head {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px 0 8px;
  border-bottom: 1px solid var(--bdg-border);
  box-sizing: border-box;
}
.bpm-row {
  top: 0;
  height: v-bind('BPM_LANE_H + "px"');
}
.marker-row {
  height: v-bind('MARKER_LANE_H + "px"');
  cursor: default;
}
.head:hover {
  background: rgb(var(--bdg-neutral) / 0.05);
}
.head.active {
  background: rgb(var(--bdg-accent-rgb) / 0.1);
}
.head.active::after {
  content: "";
  position: absolute;
  inset: 0;
  border: 1px solid rgb(var(--bdg-accent-rgb) / 0.35);
  border-radius: var(--bdg-radius-sm);
  pointer-events: none;
}
.head.drop {
  background: rgb(var(--bdg-accent-rgb) / 0.16);
}
.drag-grip {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 100%;
  color: var(--bdg-text-faint);
  cursor: grab;
}
.drag-grip:hover {
  color: var(--bdg-text);
}
.drag-grip:active {
  cursor: grabbing;
}
.accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
}
.accent-bpm {
  background: linear-gradient(
    180deg,
    var(--bdg-bpm),
    rgb(var(--bdg-bpm-rgb) / 0.7)
  );
}
.h-icon {
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: var(--bdg-radius, 6px);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: var(--bdg-fs-13);
}
.bpm-ic {
  background: rgb(var(--bdg-bpm-rgb) / 0.16);
  color: var(--bdg-bpm);
}
.t-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  justify-content: center;
  /* The lane height is a fixed constant; clip instead of bleeding into the
     neighbouring track when the Appearance text scale is cranked up. */
  overflow: hidden;
}
.t-name,
.t-name-input {
  font-size: var(--bdg-fs-12);
  font-weight: 700;
  line-height: 1.15;
}
.t-name-input {
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--bdg-radius-sm);
  color: var(--bdg-text);
  font-family: inherit;
  padding: 0 2px;
  width: 100%;
}
.t-name-input:hover,
.t-name-input:focus {
  border-color: var(--bdg-border-strong);
  outline: none;
  background: rgb(var(--bdg-neutral) / 0.08);
}
.t-sub {
  font-size: var(--bdg-fs-10);
  line-height: 1.1;
  color: var(--bdg-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--bdg-font-mono);
}
.dot {
  opacity: 0.5;
  margin: 0 2px;
}
.h-count {
  flex: none;
  font-size: var(--bdg-fs-12);
  color: var(--bdg-text-dim);
}
.h-actions {
  flex: none;
  display: flex;
  gap: 1px;
}
.mini {
  width: var(--bdg-ctl-2xs);
  height: var(--bdg-ctl-2xs);
  border: none;
  background: transparent;
  color: var(--bdg-text-dim);
  border-radius: var(--bdg-radius-sm);
  font-size: var(--bdg-fs-9);
  cursor: pointer;
  padding: 0;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.mini.icon {
  font-size: var(--bdg-fs-11);
}
.mini:hover:not(:disabled) {
  background: rgb(var(--bdg-neutral) / 0.16);
  color: var(--bdg-text);
}
.mini.on:not(:disabled) {
  color: var(--bdg-amber);
  background: rgb(var(--bdg-amber-rgb) / 0.12);
}
.mini.hide:not(:disabled) {
  opacity: 0.45;
}
.mini.danger:hover:not(:disabled) {
  color: var(--bdg-danger);
  background: rgb(var(--bdg-danger-rgb) / 0.14);
}
.mini:disabled {
  opacity: var(--bdg-disabled-opacity);
  cursor: default;
}
.row-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  animation: row-glow-fade 0.1s ease-out forwards;
  border-radius: 0;
}
@keyframes row-glow-fade {
  from {
    opacity: 0.38;
  }
  to {
    opacity: 0;
  }
}
.empty-tracks {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--bdg-text-dim);
  font-size: var(--bdg-fs-12);
}
/* The per-row glow is purely decorative; skip it when motion is reduced. */
@media (prefers-reduced-motion: reduce) {
  .row-glow {
    animation: none;
  }
}
</style>
