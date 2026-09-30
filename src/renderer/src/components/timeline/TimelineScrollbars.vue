<script setup lang="ts">
import { computed, ref } from "vue";
import {
  contentWidthPx,
  lanesTotalH,
  maxX,
  maxY,
  setScroll,
  useViewStore,
} from "../../stores/view";

const view = useViewStore();

const vbarEl = ref<HTMLElement | null>(null);
const vthumbEl = ref<HTMLElement | null>(null);
const hbarEl = ref<HTMLElement | null>(null);

/** Vertical thumb geometry, or null when the content fits the viewport. */
const vThumb = computed(() => {
  const vv = view.vh;
  const th = lanesTotalH();
  if (!(th > vv && vv > 0)) return null;
  const trackH = vv - 2;
  const thumbH = Math.max(24, trackH * (vv / th));
  const maxTravel = trackH - thumbH;
  return {
    height: `${thumbH}px`,
    transform: `translateY(${maxTravel * (view.y / (th - vv))}px)`,
  };
});

/** Horizontal thumb geometry, or null when the content fits the viewport. */
const hThumb = computed(() => {
  const cw = contentWidthPx();
  if (!(cw > view.vw)) return null;
  const trackW = view.vw - 2;
  const thumbW = Math.max(24, trackW * (view.vw / cw));
  const maxTravel = trackW - thumbW;
  return {
    width: `${thumbW}px`,
    transform: `translateX(${maxTravel * (view.x / (cw - view.vw))}px)`,
  };
});

function startVBarDrag(e: PointerEvent): void {
  e.preventDefault();
  const el = vthumbEl.value!;
  el.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent): void => {
    const rect = vbarEl.value!.getBoundingClientRect();
    const travel =
      ev.clientY - rect.top - (rect.height - vbarEl.value!.clientHeight) / 2;
    const ratio = travel / rect.height;
    setScroll(view.x, ratio * maxY());
  };
  const up = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function startHBarDrag(e: PointerEvent): void {
  e.preventDefault();
  const move = (ev: PointerEvent): void => {
    const rect = hbarEl.value!.getBoundingClientRect();
    const ratio = (ev.clientX - rect.left) / rect.width;
    setScroll(ratio * maxX(), view.y);
  };
  const up = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}
</script>

<template>
  <div v-if="vThumb" ref="vbarEl" class="vbar">
    <div
      ref="vthumbEl"
      class="vthumb"
      :style="vThumb"
      @pointerdown="startVBarDrag"
    />
  </div>
  <div v-if="hThumb" ref="hbarEl" class="hbar">
    <div class="hthumb" :style="hThumb" @pointerdown="startHBarDrag" />
  </div>
</template>

<style scoped>
.vbar {
  position: absolute;
  top: 48px;
  right: 0;
  bottom: 22px;
  width: 10px;
  background: rgb(var(--bdg-neutral) / 0.08);
  border-left: 1px solid var(--bdg-border);
}
.vthumb {
  width: 8px;
  margin: 1px auto;
  background: rgb(var(--bdg-neutral) / 0.3);
  border-radius: var(--bdg-radius-sm);
  cursor: pointer;
}
.hbar {
  position: absolute;
  left: 0;
  right: 10px;
  bottom: 0;
  height: 10px;
  background: rgb(var(--bdg-neutral) / 0.08);
  border-top: 1px solid var(--bdg-border);
}
.hthumb {
  height: 8px;
  margin: 1px 0;
  background: rgb(var(--bdg-neutral) / 0.3);
  border-radius: var(--bdg-radius-sm);
  cursor: pointer;
}
</style>
