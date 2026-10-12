<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "../../stores/settings";

/**
 * A live, read-only mock of the editor that demonstrates the current audio and
 * display settings. It reads the settings store directly (no props wiring) and
 * paints with the active `--bdg-*` tokens, so toggling the switches next to it
 * changes the pane immediately.
 */
const props = defineProps<{ cat: "audio" | "display" }>();

const { t } = useI18n();
const settings = useSettingsStore();
const s = computed(() => settings.settings);

/** Evenly spaced mock beat markers on the timeline lanes. */
const BEATS = [12, 24, 36, 48, 60, 72, 84];
/** Fixed mel-spectrum bar heights (%). */
const SPECTRUM = [30, 55, 82, 46, 70, 92, 58, 38, 74, 86, 52, 34];

/** Follow-scroll trigger line position, clamped to stay on-screen. */
const followLeft = computed(
  () => `${Math.min(92, Math.max(4, s.value.followPercent))}%`,
);

// Restart the pan/zoom animation on demand (editor motion demo).
const replayKey = ref(0);
function replay(): void {
  replayKey.value++;
}
</script>

<template>
  <div class="vp" aria-hidden="true">
    <div class="vp-top">
      <span class="vp-dot" style="background: var(--bdg-danger)" />
      <span class="vp-dot" style="background: var(--bdg-amber)" />
      <span class="vp-dot" style="background: var(--bdg-accent-2)" />
      <span class="vp-title" />
      <span v-if="cat === 'audio' && s.audioPanel" class="vp-panel-btn" />
    </div>

    <div class="vp-body">
      <div
        :key="replayKey"
        class="vp-canvas"
        :class="{
          fine: cat === 'display' && !s.gridAutoHide,
          motion: cat === 'display' && s.animEnabled,
        }"
      >
        <div class="vp-motion">
          <template v-if="cat === 'audio'">
            <span class="vp-lane" style="top: 22%" />
            <span class="vp-lane" style="top: 48%" />
            <span class="vp-lane" style="top: 74%" />
            <template v-if="s.audioAutoBeats">
              <span
                v-for="(b, i) in BEATS"
                :key="i"
                class="vp-beat"
                :style="{ left: `${b}%`, top: i % 2 ? '48%' : '22%' }"
              />
            </template>
            <span v-if="s.audioLoopDetect" class="vp-loop" />
          </template>

          <template v-else>
            <span class="vp-lane" style="top: 34%" />
            <span class="vp-lane half" style="top: 60%" />
            <span
              v-if="s.followScroll"
              class="vp-follow"
              :style="{ left: followLeft }"
            />
          </template>
        </div>
      </div>
    </div>

    <div class="vp-bottom">
      <template v-if="cat === 'audio'">
        <span v-if="s.audioAutoBpm" class="vp-bpm">128</span>
        <span v-if="s.audioLiveBpm" class="vp-live">
          <i class="vp-live-dot" />BPM
        </span>
        <span v-if="s.audioSpectrum" class="vp-spectrum">
          <i v-for="(h, i) in SPECTRUM" :key="i" :style="{ height: `${h}%` }" />
        </span>
      </template>
      <button
        v-else-if="s.animEnabled"
        type="button"
        class="vp-replay"
        @click="replay()"
      >
        {{ t("settings.preview.replay") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.vp {
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bdg-bg-sunken);
  border: 1px solid var(--bdg-border);
  border-radius: var(--bdg-radius, 6px);
  user-select: none;
}
.vp-top {
  flex: none;
  height: 18px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 7px;
  background: var(--bdg-bg-panel);
  border-bottom: 1px solid var(--bdg-border);
}
.vp-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex: none;
}
.vp-title {
  width: 26%;
  height: 4px;
  border-radius: 2px;
  margin-left: 2px;
  background: var(--bdg-text-dim);
  opacity: 0.5;
}
.vp-panel-btn {
  width: 14px;
  height: 8px;
  margin-left: auto;
  border-radius: 3px;
  background: rgb(var(--bdg-accent-rgb) / 0.85);
}

.vp-body {
  flex: 1;
  min-height: 112px;
}
.vp-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 112px;
  overflow: hidden;
  background-image: repeating-linear-gradient(
    to right,
    rgb(var(--bdg-neutral) / 0.16) 0 1px,
    transparent 1px 25%
  );
}
.vp-canvas.fine {
  background-image:
    repeating-linear-gradient(
      to right,
      rgb(var(--bdg-neutral) / 0.07) 0 1px,
      transparent 1px 6.25%
    ),
    repeating-linear-gradient(
      to right,
      rgb(var(--bdg-neutral) / 0.16) 0 1px,
      transparent 1px 25%
    );
}
.vp-motion {
  position: absolute;
  inset: 0;
}
.vp-canvas.motion .vp-motion {
  animation: vpPan 1.3s cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes vpPan {
  0% {
    transform: translateX(0) scale(1);
  }
  45% {
    transform: translateX(-14%) scale(1.06);
  }
  100% {
    transform: translateX(0) scale(1);
  }
}

.vp-lane {
  position: absolute;
  left: 0;
  right: 0;
  height: 16%;
  background: var(--bdg-bg-raised);
  opacity: 0.9;
}
.vp-lane.half {
  height: 12%;
  opacity: 0.7;
}
.vp-beat {
  position: absolute;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: var(--bdg-accent);
  box-shadow: 0 0 0 1px rgb(var(--bdg-bg-rgb) / 0.6);
}
.vp-loop {
  position: absolute;
  left: 40%;
  width: 26%;
  top: 0;
  bottom: 0;
  background: rgb(var(--bdg-accent2-rgb) / 0.18);
  border-left: 1px solid var(--bdg-accent-2);
  border-right: 1px solid var(--bdg-accent-2);
}
.vp-follow {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background: var(--bdg-danger);
  opacity: 0.85;
}

.vp-bottom {
  flex: none;
  min-height: 22px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 7px;
  background: var(--bdg-bg-panel);
  border-top: 1px solid var(--bdg-border);
}
.vp-bpm {
  flex: none;
  font-size: var(--bdg-fs-10);
  font-weight: 700;
  color: var(--bdg-bpm);
  font-variant-numeric: tabular-nums;
}
.vp-live {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: var(--bdg-fs-10);
  color: var(--bdg-text-dim);
}
.vp-live-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--bdg-accent-2);
  animation: vpPulse 1.4s ease-in-out infinite;
}
@keyframes vpPulse {
  0%,
  100% {
    opacity: 0.35;
  }
  50% {
    opacity: 1;
  }
}
.vp-spectrum {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 18px;
  min-width: 0;
}
.vp-spectrum i {
  flex: 1;
  min-width: 2px;
  border-radius: 1px;
  background: linear-gradient(to top, var(--bdg-accent), var(--bdg-accent-2));
}
.vp-replay {
  border: 1px solid var(--bdg-border);
  background: transparent;
  color: var(--bdg-text-dim);
  border-radius: var(--bdg-radius-sm, 4px);
  font-family: inherit;
  font-size: var(--bdg-fs-10);
  padding: 2px 8px;
  cursor: pointer;
}
.vp-replay:hover {
  color: var(--bdg-text);
  background: rgb(var(--bdg-neutral) / 0.12);
}

@media (prefers-reduced-motion: reduce) {
  .vp-canvas.motion .vp-motion,
  .vp-live-dot {
    animation: none;
  }
}
</style>
