<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  store,
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
  closeCard,
  timeOfBeat,
  formatTime,
} from "../store";
import { view, lanesTotalH } from "../editorView";
import { RULER_H, BPM_LANE_H, MARKER_LANE_H } from "../metrics";
import type { MarkerTrack } from "../types";
import {
  trackTypes as typedTrackTypes,
  typeKeyOf,
  localeText,
} from "../plugins/registry";

const { t } = useI18n();

const markerRows = computed<Array<{ i: number; track: MarkerTrack }>>(() => {
  const y = view.y;
  const vh = view.vh;
  const top = y - BPM_LANE_H;
  const bottom = y + vh - BPM_LANE_H;
  const first = Math.max(0, Math.floor(top / MARKER_LANE_H));
  const last = Math.min(
    store.project.tracks.length - 1,
    Math.ceil(bottom / MARKER_LANE_H),
  );
  const out: Array<{ i: number; track: MarkerTrack }> = [];
  for (let i = first; i <= last; i++) {
    const track = store.project.tracks[i];
    if (track) out.push({ i, track });
  }
  return out;
});

const addTrackTypes = computed(() => [
  { key: "", label: t("sidebar.addBeatTrack") },
  ...typedTrackTypes.map((tt) => ({
    key: typeKeyOf(tt.pluginId, tt.def.id),
    label: localeText(tt.def.trackName) || tt.def.id,
  })),
]);

const addMenuOpen = ref(false);

function toggleAddMenu(): void {
  addMenuOpen.value = !addMenuOpen.value;
}

function onPickAdd(key: string): void {
  addMenuOpen.value = false;
  if (key) addTypedTrack(key);
  else addTrack();
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
</script>

<template>
  <aside class="sidebar">
    <div class="corner" :style="{ height: RULER_H + 'px' }">
      <div class="corner-row">
        <span class="corner-text">{{ t("sidebar.tracks") }}</span>
        <button
          class="add-btn"
          :class="{ on: addMenuOpen }"
          :title="addBtnText"
          @click="toggleAddMenu"
        >
          ＋
        </button>
      </div>
      <div v-if="addMenuOpen" class="add-menu">
        <button
          v-for="item in addTrackTypes"
          :key="item.key"
          class="add-item"
          :class="{ head: item.key === '' }"
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
          <span class="h-icon bpm-ic">B</span>
          <span class="t-body">
            <span class="t-name">{{ t("sidebar.bpmTrack") }}</span>
            <span class="t-sub num">
              {{ store.project.baseBpm.toFixed(1) }} BPM ·
              {{ t("sidebar.bpmTrackHint") }}
            </span>
          </span>
          <span class="h-count num">{{ store.project.bpmPoints.length }}</span>
          <button
            class="mini icon"
            :class="{ on: store.project.bpmLocked }"
            :title="t('sidebar.lockTip')"
            @click="setBpmLocked(!store.project.bpmLocked)"
          >
            🔒
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
          <el-color-picker
            class="color-pick"
            :model-value="row.track.color"
            :disabled="!!row.track.locked"
            :title="t('sidebar.changeColor')"
            @pointerdown.stop
            @change="(c: string | null) => { if (c) colorTrack(row.track.id, c); }"
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
              🔒
            </button>
            <button
              class="mini icon"
              :class="{ hide: row.track.hidden }"
              :title="t('sidebar.hideTip')"
              @pointerdown.stop
              @click.stop="setTrackHidden(row.track.id, !row.track.hidden)"
            >
              {{ row.track.hidden ? "🙈" : "👁" }}
            </button>
            <button
              class="mini"
              :disabled="row.i === 0"
              @pointerdown.stop
              @click.stop="moveTrack(row.track.id, -1)"
            >
              ▲
            </button>
            <button
              class="mini"
              :disabled="row.i >= store.project.tracks.length - 1"
              @pointerdown.stop
              @click.stop="moveTrack(row.track.id, 1)"
            >
              ▼
            </button>
            <button
              class="mini danger"
              :disabled="store.project.tracks.length <= 1"
              @pointerdown.stop
              @click.stop="removeTrack(row.track.id)"
            >
              ✕
            </button>
          </span>
        </div>
      </div>
      <div v-if="store.project.tracks.length === 0" class="empty-tracks">
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
  background: rgba(148, 163, 184, 0.04);
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
  background: rgba(56, 189, 248, 0.16);
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
  background: rgba(56, 189, 248, 0.3);
}
.add-btn.on {
  background: rgba(56, 189, 248, 0.34);
}
.add-menu {
  position: absolute;
  top: calc(100% - 6px);
  left: 8px;
  right: 8px;
  z-index: 30;
  background: #1a1f28;
  border: 1px solid var(--bdg-border-strong);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
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
  background: rgba(56, 189, 248, 0.16);
  color: var(--bdg-accent);
}
.add-item.head {
  font-weight: 700;
  color: var(--bdg-text);
}
.add-item:not(.head) + .add-item:not(.head) {
  border-top: none;
}
.color-pick {
  width: 20px;
  height: 20px;
  flex: none;
}
.color-pick :deep(.el-color-picker__trigger) {
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  border-radius: 50%;
  overflow: hidden;
}
.color-pick :deep(.el-color-picker__color) {
  border: none;
  border-radius: 50%;
}
.color-pick :deep(.el-color-picker__color-inner) {
  border-radius: 50%;
}
.color-pick :deep(.el-color-picker__icon) {
  display: none;
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
  background: rgba(148, 163, 184, 0.05);
}
.accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
}
.accent-bpm {
  background: linear-gradient(180deg, #f59e0b, #d97706);
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
  background: rgba(245, 158, 11, 0.16);
  color: #f59e0b;
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
  background: rgba(148, 163, 184, 0.08);
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
}
.mini.icon {
  font-size: 11px;
}
.mini:hover:not(:disabled) {
  background: rgba(148, 163, 184, 0.16);
  color: var(--bdg-text);
}
.mini.on:not(:disabled) {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.12);
}
.mini.hide:not(:disabled) {
  opacity: 0.45;
}
.mini.danger:hover:not(:disabled) {
  color: var(--bdg-danger);
  background: rgba(244, 63, 94, 0.14);
}
.mini:disabled {
  opacity: 0.25;
  cursor: default;
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
