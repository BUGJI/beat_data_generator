<script setup lang="ts">
import { computed } from "vue";
import { rgbTriple, type ThemeSpec } from "../theme";

/**
 * A miniature mock of the editor rendered from a resolved `ThemeSpec`.
 *
 * It never touches the live `--bdg-*` variables — every color is inlined from
 * the given spec — so it can preview a preset that is *not* currently applied
 * (used by the theme preset cards) as well as the live theme.
 */
const props = withDefaults(
  defineProps<{ spec: ThemeSpec; variant?: "panel" | "card" }>(),
  { variant: "panel" },
);

const tint = (hex: string, alpha: number): string =>
  `rgb(${rgbTriple(hex)} / ${alpha})`;

const s = computed(() => {
  const c = props.spec;
  return {
    root: {
      background: c.bg,
      color: c.text,
      borderColor: tint(c.neutral, 0.3),
    },
    bar: { background: c.panel, borderColor: tint(c.neutral, 0.16) },
    side: { background: c.panel },
    sideRow: { background: tint(c.neutral, 0.14) },
    sideActive: { background: tint(c.accent, 0.22) },
    canvas: { background: c.sunken },
    grid: { background: tint(c.neutral, 0.2) },
    gridBar: { background: tint(c.accent2, 0.4) },
    lane: { background: c.raised },
    laneAlt: { background: tint(c.neutral, 0.08) },
    marker: { background: c.accent },
    markerSel: { background: c.amber },
    bpm: { background: c.bpm },
    playhead: { background: c.danger },
    accentBtn: { background: c.accent, color: c.bg },
    chip: { background: c.sunken, borderColor: tint(c.neutral, 0.18) },
    track: { background: c.raised },
    knob: { background: c.accent },
    dot: { background: c.textDim },
  };
});
</script>

<template>
  <div class="tp" :class="variant" :style="s.root" aria-hidden="true">
    <div class="tp-top" :style="s.bar">
      <span class="tp-dot" :style="{ background: spec.danger }" />
      <span class="tp-dot" :style="{ background: spec.amber }" />
      <span class="tp-dot" :style="{ background: spec.accent2 }" />
      <span class="tp-title" :style="s.dot" />
      <span class="tp-search" :style="s.chip" />
    </div>

    <div class="tp-body">
      <div class="tp-side" :style="s.side">
        <span class="tp-side-row" :style="s.sideRow" />
        <span class="tp-side-row active" :style="s.sideActive" />
        <span class="tp-side-row" :style="s.sideRow" />
        <span class="tp-side-row short" :style="s.sideRow" />
      </div>

      <div class="tp-canvas" :style="s.canvas">
        <span class="tp-ruler" :style="s.grid" />
        <span class="tp-gl" :style="s.grid" />
        <span class="tp-gl second" :style="s.gridBar" />
        <span class="tp-lane" :style="s.lane" />
        <span class="tp-lane half" :style="s.laneAlt" />
        <span class="tp-mark m1" :style="s.marker" />
        <span class="tp-mark m2" :style="s.markerSel" />
        <span class="tp-mark m3" :style="s.marker" />
        <span class="tp-bpm b1" :style="s.bpm" />
        <span class="tp-bpm b2" :style="s.bpm" />
        <span class="tp-playhead" :style="s.playhead" />
      </div>
    </div>

    <div class="tp-bottom" :style="s.bar">
      <span class="tp-play" :style="s.accentBtn" />
      <span class="tp-track" :style="s.track">
        <span class="tp-knob" :style="s.knob" />
      </span>
      <span class="tp-chip" :style="s.chip" />
    </div>
  </div>
</template>

<style scoped>
.tp {
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid;
  border-radius: var(--bdg-radius, 6px);
  user-select: none;
}
.tp.panel {
  height: 168px;
}
.tp.card {
  height: 92px;
  border-radius: calc(var(--bdg-radius, 6px) + 2px);
}

.tp-top {
  flex: none;
  height: 16px;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 0 6px;
  border-bottom: 1px solid;
}
.card .tp-top {
  height: 11px;
  padding: 0 4px;
}
.tp-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex: none;
}
.card .tp-dot {
  width: 3px;
  height: 3px;
}
.tp-title {
  width: 26%;
  height: 4px;
  border-radius: 2px;
  opacity: 0.5;
  margin-left: 2px;
}
.tp-search {
  width: 34%;
  height: 8px;
  border: 1px solid;
  border-radius: 4px;
  margin-left: auto;
}
.card .tp-search {
  height: 5px;
}

.tp-body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.tp-side {
  flex: none;
  width: 22%;
  padding: 5px 4px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.card .tp-side {
  padding: 3px;
  gap: 2px;
}
.tp-side-row {
  height: 6px;
  border-radius: 3px;
}
.tp-side-row.short {
  width: 70%;
}
.card .tp-side-row {
  height: 3px;
}

.tp-canvas {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
.tp-ruler {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 1px;
  opacity: 0.7;
}
.tp-gl {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 34%;
  width: 1px;
  opacity: 0.9;
}
.tp-gl.second {
  left: 66%;
}
.tp-lane {
  position: absolute;
  left: 0;
  right: 0;
  top: 26%;
  height: 20%;
  opacity: 0.55;
}
.tp-lane.half {
  top: 58%;
  height: 16%;
}
.tp-mark {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  top: 33%;
  transform: translate(-50%, -50%);
}
.card .tp-mark {
  width: 3px;
  height: 3px;
}
.tp-mark.m1 {
  left: 22%;
}
.tp-mark.m2 {
  left: 50%;
}
.tp-mark.m3 {
  left: 78%;
}
.tp-bpm {
  position: absolute;
  width: 3px;
  height: 3px;
  top: 64%;
  transform: rotate(45deg);
}
.tp-bpm.b1 {
  left: 38%;
}
.tp-bpm.b2 {
  left: 72%;
}
.tp-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 42%;
  width: 1.5px;
  opacity: 0.9;
}

.tp-bottom {
  flex: none;
  height: 18px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 7px;
  border-top: 1px solid;
}
.card .tp-bottom {
  height: 12px;
  padding: 0 4px;
  gap: 4px;
}
.tp-play {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: none;
}
.card .tp-play {
  width: 6px;
  height: 6px;
}
.tp-track {
  position: relative;
  flex: 1;
  height: 3px;
  border-radius: 2px;
}
.tp-knob {
  position: absolute;
  left: 38%;
  top: 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}
.card .tp-knob {
  width: 4px;
  height: 4px;
}
.tp-chip {
  width: 12%;
  height: 7px;
  border: 1px solid;
  border-radius: 3px;
}
.card .tp-chip {
  height: 5px;
}
</style>
