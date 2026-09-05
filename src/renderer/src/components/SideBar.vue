<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { store, formatTime, durationReadout } from "../store";
import { RULER_H } from "../metrics";

const { t } = useI18n();

const audioName = computed(
  () => store.project.audioName ?? t("sidebar.noSong"),
);
const markerCount = computed(() => store.project.markers.length);
const markerLast = computed(() => {
  if (store.project.markers.length === 0) return "--:--.---";
  return formatTime(Math.max(...store.project.markers.map((m) => m.timeMs)));
});
const snapText = computed(() =>
  store.ui.snapEnabled ? `1/${store.ui.snapDiv}` : "OFF",
);
</script>

<template>
  <aside class="sidebar">
    <div class="corner" :style="{ height: RULER_H + 'px' }">
      <span class="corner-text">{{ t("sidebar.tracks") }}</span>
    </div>

    <div class="track-head audio" :title="audioName">
      <span class="accent accent-audio" />
      <span class="t-icon"
        ><i class="bar" /><i class="bar" /><i class="bar"
      /></span>
      <span class="t-body">
        <span class="t-name">{{ t("sidebar.audioTrack") }}</span>
        <span class="t-sub num">{{ audioName }} · {{ durationReadout() }}</span>
      </span>
    </div>

    <div class="track-head marker">
      <span class="accent accent-marker" />
      <span class="t-icon"><i class="dia" /></span>
      <span class="t-body">
        <span class="t-name">{{ t("sidebar.markerTrack") }}</span>
        <span class="t-sub">
          <b class="num">{{ markerCount }}</b> {{ t("sidebar.markers") }}
          <span class="dot">·</span> {{ t("sidebar.lastMark") }}
          <span class="num">{{ markerLast }}</span>
          <span class="dot">·</span> snap
          <span class="num">{{ snapText }}</span>
        </span>
      </span>
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
  flex: none;
  display: flex;
  align-items: center;
  padding: 0 10px;
  border-bottom: 1px solid var(--bdg-border);
  background: rgba(148, 163, 184, 0.04);
}
.corner-text {
  font-size: 10px;
  color: var(--bdg-text-dim);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.track-head {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  overflow: hidden;
  border-bottom: 1px solid var(--bdg-border);
}
.track-head:hover {
  background: rgba(148, 163, 184, 0.06);
}
.accent {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
}
.accent-audio {
  background: linear-gradient(180deg, #34d399, #10b981);
}
.accent-marker {
  background: linear-gradient(180deg, #38bdf8, #0ea5e9);
}
.t-icon {
  width: 26px;
  height: 26px;
  flex: none;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.track-head.audio .t-icon {
  background: rgba(52, 211, 153, 0.14);
}
.track-head.marker .t-icon {
  background: rgba(56, 189, 248, 0.14);
}
.bar {
  display: block;
  width: 3px;
  border-radius: 2px;
  background: #34d399;
}
.bar:nth-child(1) {
  height: 8px;
}
.bar:nth-child(2) {
  height: 14px;
}
.bar:nth-child(3) {
  height: 6px;
}
.dia {
  width: 9px;
  height: 9px;
  background: #38bdf8;
  transform: rotate(45deg);
  border-radius: 2px;
}
.t-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.t-name {
  font-size: 13px;
  font-weight: 700;
}
.t-sub {
  font-size: 11px;
  color: var(--bdg-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.t-sub b {
  color: #38bdf8;
}
.dot {
  opacity: 0.5;
  margin: 0 2px;
}
</style>
