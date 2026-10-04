<script setup lang="ts">
import { computed } from "vue";
import {
  contentWidthPx,
  lanesTotalH,
  maxX,
  maxY,
  setScroll,
  useViewStore,
} from "../../stores/view";

const view = useViewStore();

// Bottom inset reserved by the status bar (22px) + horizontal bar (10px), and
// the width reserved by the vertical bar. Kept in sync with the CSS below so
// the thumb geometry is derived from the bar it actually lives in.
const V_BAR_INSET = 32;
const V_BAR_W = 10;

/** Track height of the vertical bar = editor height minus ruler minus inset. */
const vTrackH = computed(() => Math.max(0, view.vh - V_BAR_INSET));
/** Track width of the horizontal bar = editor width minus the vertical bar. */
const hTrackW = computed(() => Math.max(0, view.vw - V_BAR_W));

/** Vertical thumb geometry, or null when the content fits the viewport. */
const vThumb = computed(() => {
  const trackH = vTrackH.value;
  const th = lanesTotalH();
  const vv = view.vh;
  if (!(th > vv && trackH > 0)) return null;
  const thumbH = Math.max(24, trackH * (vv / th));
  const maxTravel = trackH - thumbH;
  return {
    height: `${thumbH}px`,
    transform: `translateY(${maxTravel * (view.y / (th - vv))}px)`,
  };
});

/** Horizontal thumb geometry, or null when the content fits the viewport. */
const hThumb = computed(() => {
  const trackW = hTrackW.value;
  const cw = contentWidthPx();
  if (!(cw > view.vw && trackW > 0)) return null;
  const thumbW = Math.max(24, trackW * (view.vw / cw));
  const maxTravel = trackW - thumbW;
  return {
    width: `${thumbW}px`,
    transform: `translateX(${maxTravel * (view.x / (cw - view.vw))}px)`,
  };
});

/** Follow the pointer while dragging; a grab on the thumb keeps its offset,
 *  a click on the bare track centres the thumb under the cursor. */
function dragScroll(vertical: boolean, e: PointerEvent): void {
  const el = (e.currentTarget as HTMLElement) ?? null;
  if (!el) return;
  e.preventDefault();
  const rect = el.getBoundingClientRect();
  const track = vertical ? vTrackH.value : hTrackW.value;
  const thumbSize = vertical
    ? Math.max(24, track * (view.vh / lanesTotalH()))
    : Math.max(24, track * (view.vw / contentWidthPx()));
  const maxTravel = Math.max(1, track - thumbSize);
  const onThumb = (e.target as HTMLElement).classList.contains(
    vertical ? "vthumb" : "hthumb",
  );
  const start = vertical ? e.clientY - rect.top : e.clientX - rect.left;
  const thumbStart =
    maxTravel *
    (vertical ? view.y / Math.max(1, maxY()) : view.x / Math.max(1, maxX()));
  const grab = onThumb ? start - thumbStart : thumbSize / 2;
  const apply = (client: number): void => {
    const pos = client - (vertical ? rect.top : rect.left);
    const travel = Math.min(maxTravel, Math.max(0, pos - grab));
    const ratio = travel / maxTravel;
    if (vertical) setScroll(view.x, ratio * maxY());
    else setScroll(ratio * maxX(), view.y);
  };
  apply(vertical ? e.clientY : e.clientX);
  const move = (ev: PointerEvent): void =>
    apply(vertical ? ev.clientY : ev.clientX);
  const up = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function onVBarDown(e: PointerEvent): void {
  dragScroll(true, e);
}

function onHBarDown(e: PointerEvent): void {
  dragScroll(false, e);
}
</script>

<template>
  <div v-if="vThumb" ref="vbarEl" class="vbar" @pointerdown="onVBarDown">
    <div class="vthumb" :style="vThumb" />
  </div>
  <div v-if="hThumb" ref="hbarEl" class="hbar" @pointerdown="onHBarDown">
    <div class="hthumb" :style="hThumb" />
  </div>
</template>

<style scoped>
.vbar {
  position: absolute;
  top: 48px;
  right: 0;
  bottom: 32px;
  width: 10px;
  background: rgb(var(--bdg-neutral) / 0.08);
  border-left: 1px solid var(--bdg-border);
  touch-action: none;
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
  touch-action: none;
}
.hthumb {
  height: 8px;
  margin: 1px 0;
  background: rgb(var(--bdg-neutral) / 0.3);
  border-radius: var(--bdg-radius-sm);
  cursor: pointer;
}
</style>
