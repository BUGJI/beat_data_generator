<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  markersInTrack,
  addTrack,
  addTypedTrack,
  removeTrack,
  renameTrack,
  moveTrack,
  colorTrack,
  setTrackLocked,
  setTrackHidden,
  setBpmLocked,
  addNote,
  closeCard,
  timeOfBeat,
  formatTime,
} from "../store";
import { lanesTotalH, useViewStore } from "../stores/view";
import { useProjectStore } from "../stores/project";
import { useTransportStore } from "../stores/transport";
import { useUiStore } from "../stores/ui";
import { RULER_H, BPM_LANE_H, MARKER_LANE_H } from "../metrics";
import type { MarkerTrack } from "../types";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Lock,
  Plus,
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
const view = useViewStore();

const markerRows = computed<Array<{ i: number; track: MarkerTrack }>>(() => {
  const y = view.y;
  const vh = view.vh;
  const top = y - BPM_LANE_H;
  const bottom = y + vh - BPM_LANE_H;
  const first = Math.max(0, Math.floor(top / MARKER_LANE_H));
  const last = Math.min(
    project.tracks.length - 1,
    Math.ceil(bottom / MARKER_LANE_H),
  );
  const out: Array<{ i: number; track: MarkerTrack }> = [];
  for (let i = first; i <= last; i++) {
    const track = project.tracks[i];
    if (track) out.push({ i, track });
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
  if (key) addTypedTrack(key);
  else addTrack();
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

function clickTrack(_id: string): void {
  closeCard();
}

const addBtnText = computed(() => t("sidebar.addTrack"));
const renameBusy = ref<string | null>(null);

const glowSeqSeen: Record<string, number> = {};
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

watch(
  () => ui.glowSeqs,
  (seqs) => {
    for (const id of Object.keys(seqs)) {
      const seq = seqs[id];
      if (glowSeqSeen[id] === undefined) {
        glowSeqSeen[id] = seq;
        continue;
      }
      if (seq !== glowSeqSeen[id]) {
        glowSeqSeen[id] = seq;
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
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M4 2h12l4 4V22H4z" />
            <path d="M16 2v4h4" />
            <path d="M8 13h8M8 17h8" />
          </svg>
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
          :style="{ top: BPM_LANE_H + row.i * MARKER_LANE_H + 'px' }"
          @pointerdown="clickTrack(row.track.id)"
        >
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
              @blur="
                (e: FocusEvent) =>
                  renameTrack(
                    row.track.id,
                    (e.target as HTMLInputElement).value,
                  )
              "
              @keyup.enter="
                (e: KeyboardEvent) => (e.target as HTMLInputElement).blur()
              "
              @focus="renameBusy = row.track.id"
            />
            <span class="t-sub num">
              <span :style="{ color: row.track.color }">{{ row.i + 1 }}</span>
              <span v-if="lastFor(row.track.id)" class="dot">·</span>
              <span v-if="lastFor(row.track.id)">{{
                lastFor(row.track.id)
              }}</span>
            </span>
          </span>
          <span class="h-actions">
            <button
              class="mini icon"
              :class="{ on: row.track.locked }"
              :title="t('sidebar.lockTip')"
              @pointerdown.stop
              @click.stop="setTrackLocked(row.track.id, !row.track.locked)"
            >
              <Lock class="size-3" />
            </button>
            <button
              class="mini icon"
              :class="{ hide: row.track.hidden }"
              :title="t('sidebar.hideTip')"
              @pointerdown.stop
              @click.stop="setTrackHidden(row.track.id, !row.track.hidden)"
            >
              <EyeOff v-if="row.track.hidden" class="size-3" />
              <Eye v-else class="size-3" />
            </button>
            <button
              class="mini"
              :disabled="row.i === 0"
              @pointerdown.stop
              @click.stop="moveTrack(row.track.id, -1)"
            >
              <ChevronUp class="size-3" />
            </button>
            <button
              class="mini"
              :disabled="row.i >= project.tracks.length - 1"
              @pointerdown.stop
              @click.stop="moveTrack(row.track.id, 1)"
            >
              <ChevronDown class="size-3" />
            </button>
            <button
              class="mini danger"
              :disabled="project.tracks.length <= 1"
              @pointerdown.stop
              @click.stop="removeTrack(row.track.id)"
            >
              <X class="size-3" />
            </button>
          </span>
          <span
            v-if="ui.glowEnabled && glowOn[row.track.id]"
            :key="'g' + (ui.glowSeqs[row.track.id] ?? 0)"
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
  font-size: 10px;
  color: var(--bdg-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.add-btn {
  border: none;
  background: rgb(var(--bdg-accent-rgb) / 0.16);
  color: var(--bdg-accent);
  width: 20px;
  height: 20px;
  border-radius: 6px;
  font-size: 14px;
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
  z-index: 30;
  background: var(--bdg-bg-raised);
  border: 1px solid var(--bdg-border-strong);
  border-radius: 8px;
  box-shadow: 0 10px 30px var(--bdg-shadow);
  padding: 4px;
  display: flex;
  flex-direction: column;
  height: 260px;
  min-height: 100px;
  max-height: 260px;
  overflow: auto;
}
.add-item {
  text-align: left;
  border: none;
  background: transparent;
  color: var(--bdg-text);
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 6px;
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
  width: 20px;
  height: 20px;
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
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
}
.bpm-ic {
  background: rgb(var(--bdg-bpm-rgb) / 0.16);
  color: var(--bdg-bpm);
}
.color-chip {
  width: 13px;
  height: 13px;
  flex: none;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transform: rotate(45deg);
}
.t-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  justify-content: center;
}
.t-name,
.t-name-input {
  font-size: 12px;
  font-weight: 700;
}
.t-name-input {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
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
  font-size: 10px;
  color: var(--bdg-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: "Consolas", monospace;
}
.dot {
  opacity: 0.5;
  margin: 0 2px;
}
.h-count {
  flex: none;
  font-size: 12px;
  color: var(--bdg-text-dim);
}
.h-actions {
  flex: none;
  display: flex;
  gap: 1px;
}
.mini {
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--bdg-text-dim);
  border-radius: 4px;
  font-size: 9px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.mini.icon {
  font-size: 11px;
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
  opacity: 0.25;
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
  font-size: 12px;
}
</style>
