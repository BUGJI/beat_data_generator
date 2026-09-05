<script setup lang="ts">
import { computed, onBeforeUnmount, reactive } from "vue";
import {
  panels as allPanels,
  openPanels,
  closePanel,
  localeText,
} from "../plugins/registry";
import { pluginEntries, pluginName } from "../plugins/host";

const cleanups = new Map<string, () => void>();

interface Card {
  pluginId: string;
  uid: number;
  key: string;
  title: string;
}

interface WinState {
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

const winStates = reactive<Record<string, WinState>>({});
let zTop = 10;

const list = computed<Card[]>(() =>
  openPanels
    .map((o) => {
      const p = allPanels.find(
        (x) => x.pluginId === o.pluginId && x.uid === o.uid,
      );
      if (!p) return null;
      const e = pluginEntries.find((x) => x.id === o.pluginId);
      const pname = e ? pluginName(e) : o.pluginId;
      const title = localeText(p.def.title) || pname;
      return {
        pluginId: o.pluginId,
        uid: o.uid,
        key: `${o.pluginId}:${o.uid}`,
        title,
      };
    })
    .filter((x): x is Card => !!x),
);

function hashKey(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function stateOf(key: string): WinState {
  let st = winStates[key];
  if (!st) {
    const n = hashKey(key);
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 800;
    const w = 340;
    const h = 210;
    const x = Math.max(16, Math.min(vw - w - 16, 40 + (n % 6) * 30));
    const y = Math.max(54, Math.min(vh - h - 24, 70 + (n % 5) * 34));
    st = { x, y, w, h, z: ++zTop };
    winStates[key] = st;
  }
  return st;
}

function styleOf(key: string): Record<string, string> {
  const st = stateOf(key);
  return {
    left: `${st.x}px`,
    top: `${st.y}px`,
    width: `${st.w}px`,
    height: `${st.h}px`,
    zIndex: String(st.z),
  };
}

function bringToFront(key: string): void {
  const st = stateOf(key);
  if (st.z < zTop) st.z = ++zTop;
}

interface Drag {
  key: string;
  mode: "move" | "resize";
  sx: number;
  sy: number;
  bx: number;
  by: number;
  bw: number;
  bh: number;
}

let drag: Drag | null = null;

function onHeaderDown(e: PointerEvent, card: Card): void {
  if (e.button !== 0) return;
  e.preventDefault();
  bringToFront(card.key);
  const st = stateOf(card.key);
  drag = {
    key: card.key,
    mode: "move",
    sx: e.clientX,
    sy: e.clientY,
    bx: st.x,
    by: st.y,
    bw: st.w,
    bh: st.h,
  };
  window.addEventListener("pointermove", onWinMove);
  window.addEventListener("pointerup", onWinUp);
}

function onResizeDown(e: PointerEvent, card: Card): void {
  if (e.button !== 0) return;
  e.preventDefault();
  bringToFront(card.key);
  const st = stateOf(card.key);
  drag = {
    key: card.key,
    mode: "resize",
    sx: e.clientX,
    sy: e.clientY,
    bx: st.x,
    by: st.y,
    bw: st.w,
    bh: st.h,
  };
  window.addEventListener("pointermove", onWinMove);
  window.addEventListener("pointerup", onWinUp);
}

function onWinMove(e: PointerEvent): void {
  const d = drag;
  if (!d) return;
  const st = winStates[d.key];
  if (!st) return;
  const dx = e.clientX - d.sx;
  const dy = e.clientY - d.sy;
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  if (d.mode === "move") {
    st.x = Math.min(vw - 90, Math.max(-st.w + 90, d.bx + dx));
    st.y = Math.min(vh - 30, Math.max(0, d.by + dy));
  } else {
    st.w = Math.min(vw - st.x, Math.max(240, d.bw + dx));
    st.h = Math.min(vh - st.y, Math.max(130, d.bh + dy));
  }
}

function onWinUp(): void {
  drag = null;
  window.removeEventListener("pointermove", onWinMove);
  window.removeEventListener("pointerup", onWinUp);
}

onBeforeUnmount(() => {
  drag = null;
  window.removeEventListener("pointermove", onWinMove);
  window.removeEventListener("pointerup", onWinUp);
});

function bindPanel(
  pluginId: string,
  uid: number,
  el: HTMLElement | null,
): void {
  const key = `${pluginId}:${uid}`;
  if (el) {
    const p = allPanels.find((x) => x.pluginId === pluginId && x.uid === uid);
    if (!p) return;
    try {
      const ret = p.def.mount(el);
      if (typeof ret === "function") cleanups.set(key, ret);
    } catch (err) {
      console.error(`[plugins] panel mount failed ${key}`, err);
    }
    return;
  }
  const cleanup = cleanups.get(key);
  if (cleanup) {
    try {
      cleanup();
    } catch (err) {
      console.error(`[plugins] panel unmount failed ${key}`, err);
    }
    cleanups.delete(key);
  }
}

function onClose(card: Card): void {
  closePanel(card.pluginId, card.uid);
}
</script>

<template>
  <div class="plugin-layer">
    <div
      v-for="card in list"
      :key="card.key"
      class="plugin-win"
      :style="styleOf(card.key)"
      @pointerdown="bringToFront(card.key)"
    >
      <div
        class="pw-head"
        @pointerdown.stop="onHeaderDown($event, card)"
      >
        <span class="pw-title">{{ card.title }}</span>
        <button class="pw-x" @click.stop="onClose(card)">✕</button>
      </div>
      <div
        class="pw-body"
        :ref="
          (el: unknown) =>
            bindPanel(card.pluginId, card.uid, el as HTMLElement | null)
        "
      />
      <div
        class="pw-resize"
        @pointerdown.stop="onResizeDown($event, card)"
      />
    </div>
  </div>
</template>

<style scoped>
.plugin-layer {
  position: fixed;
  inset: 0;
  z-index: 40;
  pointer-events: none;
}
.plugin-win {
  position: absolute;
  pointer-events: auto;
  background: #161b23;
  border: 1px solid var(--bdg-border-strong);
  border-radius: 10px;
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.55);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 240px;
  min-height: 130px;
  user-select: none;
}
.pw-head {
  flex: none;
  display: flex;
  align-items: center;
  padding: 6px 8px 6px 12px;
  background: rgba(148, 163, 184, 0.07);
  border-bottom: 1px solid var(--bdg-border);
  cursor: move;
  touch-action: none;
}
.pw-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pw-x {
  flex: none;
  background: none;
  border: none;
  color: var(--bdg-text-dim);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 6px;
}
.pw-x:hover {
  color: var(--bdg-text);
}
.pw-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-size: 12px;
  color: var(--bdg-text);
  user-select: text;
}
.pw-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  touch-action: none;
}
</style>
