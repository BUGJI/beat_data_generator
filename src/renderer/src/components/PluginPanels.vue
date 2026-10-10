<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive } from "vue";
import { useI18n } from "vue-i18n";
import { X } from "@lucide/vue";
import type { PanelLayout } from "@shared/pluginData";
import {
  panels as allPanels,
  openPanels,
  closePanel,
  localeText,
  type RegisteredPanel,
} from "../plugins/registry";
import { pluginEntries, pluginName } from "../plugins/host";

const { t } = useI18n();

const cleanups = new Map<string, () => void>();
// Cache the ref callback per panel key. An inline arrow would be recreated on
// every render; Vue then treats the ref as "changed" and re-invokes it with
// null (unmout) then the element (re-mount) every render, which clears the
// plugin panel inputs while dragging/resizing the window.
const panelRefs = new Map<string, (el: unknown) => void>();
function panelRefFor(key: string): (el: unknown) => void {
  let cb = panelRefs.get(key);
  if (!cb) {
    cb = (el) => bindPanel(key, el as HTMLElement | null);
    panelRefs.set(key, cb);
  }
  return cb;
}

interface Card {
  pluginId: string;
  uid: number;
  /** uid-based element key (refs / mount binding). */
  key: string;
  /** Stable geometry key "<pluginId>:<panelId>" used for persistence. */
  panelKey: string;
  title: string;
  def: RegisteredPanel["def"];
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
/** Restored geometry, applied before each panel's first render. */
let persistedLayout: PanelLayout = {};
let persistTimer: ReturnType<typeof setTimeout> | null = null;

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
        panelKey: `${o.pluginId}:${p.def.id}`,
        title,
        def: p.def,
      };
    })
    .filter((x): x is Card => !!x),
);

function hashKey(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function stateOf(panelKey: string, def: RegisteredPanel["def"]): WinState {
  let st = winStates[panelKey];
  if (st) return st;
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  const minW = Math.max(160, def.minWidth ?? 240);
  const minH = Math.max(100, def.minHeight ?? 130);
  const saved = persistedLayout[panelKey];
  let x: number;
  let y: number;
  let w: number;
  let h: number;
  if (saved) {
    // Restore the user's geometry, clamped into the current window size.
    w = Math.min(vw, Math.max(minW, saved.w));
    h = Math.min(vh, Math.max(minH, saved.h));
    x = Math.min(vw - 90, Math.max(-w + 90, saved.x));
    y = Math.min(vh - 30, Math.max(0, saved.y));
  } else {
    const n = hashKey(panelKey);
    w = Math.max(minW, def.defaultWidth ?? 340);
    h = Math.max(minH, def.defaultHeight ?? 210);
    x = Math.max(16, Math.min(vw - w - 16, 40 + (n % 6) * 30));
    y = Math.max(54, Math.min(vh - h - 24, 70 + (n % 5) * 34));
  }
  st = { x, y, w, h, z: ++zTop };
  winStates[panelKey] = st;
  return st;
}

function styleOf(card: Card): Record<string, string> {
  const st = stateOf(card.panelKey, card.def);
  return {
    left: `${st.x}px`,
    top: `${st.y}px`,
    width: `${st.w}px`,
    height: `${st.h}px`,
    zIndex: String(st.z),
  };
}

function bringToFront(card: Card): void {
  const st = stateOf(card.panelKey, card.def);
  if (st.z < zTop) st.z = ++zTop;
}

interface Drag {
  card: Card;
  mode: "move" | "resize";
  sx: number;
  sy: number;
  bx: number;
  by: number;
  bw: number;
  bh: number;
  minW: number;
  minH: number;
}

let drag: Drag | null = null;

function beginDrag(e: PointerEvent, card: Card, mode: "move" | "resize"): void {
  if (e.button !== 0) return;
  e.preventDefault();
  bringToFront(card);
  const st = stateOf(card.panelKey, card.def);
  drag = {
    card,
    mode,
    sx: e.clientX,
    sy: e.clientY,
    bx: st.x,
    by: st.y,
    bw: st.w,
    bh: st.h,
    minW: Math.max(160, card.def.minWidth ?? 240),
    minH: Math.max(100, card.def.minHeight ?? 130),
  };
  window.addEventListener("pointermove", onWinMove);
  window.addEventListener("pointerup", onWinUp);
}

const onHeaderDown = (e: PointerEvent, card: Card): void =>
  beginDrag(e, card, "move");
const onResizeDown = (e: PointerEvent, card: Card): void =>
  beginDrag(e, card, "resize");

function onWinMove(e: PointerEvent): void {
  const d = drag;
  if (!d) return;
  const st = winStates[d.card.panelKey];
  if (!st) return;
  const dx = e.clientX - d.sx;
  const dy = e.clientY - d.sy;
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 800;
  if (d.mode === "move") {
    st.x = Math.min(vw - 90, Math.max(-st.w + 90, d.bx + dx));
    st.y = Math.min(vh - 30, Math.max(0, d.by + dy));
  } else {
    st.w = Math.min(vw - st.x, Math.max(d.minW, d.bw + dx));
    st.h = Math.min(vh - st.y, Math.max(d.minH, d.bh + dy));
  }
}

/** Persist every panel's geometry (coalesced) so it survives restarts. */
function persistLayout(): void {
  const out: PanelLayout = {};
  for (const [k, st] of Object.entries(winStates)) {
    out[k] = { x: st.x, y: st.y, w: st.w, h: st.h };
  }
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void window.api.setPluginPanelLayout(out);
  }, 250);
}

function onWinUp(): void {
  const moved = drag !== null;
  drag = null;
  window.removeEventListener("pointermove", onWinMove);
  window.removeEventListener("pointerup", onWinUp);
  if (moved) persistLayout();
}

onMounted(async () => {
  try {
    persistedLayout = (await window.api.getPluginPanelLayout()) ?? {};
  } catch {
    persistedLayout = {};
  }
  // Rebuild any panels created before the layout arrived so they use it.
  for (const k of Object.keys(winStates)) delete winStates[k];
});

onBeforeUnmount(() => {
  drag = null;
  if (persistTimer !== null) clearTimeout(persistTimer);
  window.removeEventListener("pointermove", onWinMove);
  window.removeEventListener("pointerup", onWinUp);
});

function bindPanel(key: string, el: HTMLElement | null): void {
  if (el) {
    const sep = key.indexOf(":");
    const pluginId = key.slice(0, sep);
    const uid = Number(key.slice(sep + 1));
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
      :style="styleOf(card)"
      role="dialog"
      :aria-label="card.title"
      @pointerdown="bringToFront(card)"
    >
      <div class="pw-head" @pointerdown.stop="onHeaderDown($event, card)">
        <span class="pw-title">{{ card.title }}</span>
        <button
          class="pw-x"
          :title="t('a11y.close')"
          :aria-label="t('a11y.close')"
          @click.stop="onClose(card)"
        >
          <X class="size-3" />
        </button>
      </div>
      <div class="pw-body" :ref="panelRefFor(card.key)" />
      <div class="pw-resize" @pointerdown.stop="onResizeDown($event, card)" />
    </div>
  </div>
</template>

<style scoped>
.plugin-layer {
  position: fixed;
  inset: 0;
  z-index: var(--bdg-z-panel);
  pointer-events: none;
}
.plugin-win {
  position: absolute;
  pointer-events: auto;
  background: var(--bdg-bg-panel);
  border: 1px solid var(--bdg-border-strong);
  border-radius: calc(var(--bdg-radius, 6px) * 2);
  box-shadow: 0 14px 44px var(--bdg-shadow);
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
  background: rgb(var(--bdg-neutral) / 0.07);
  border-bottom: 1px solid var(--bdg-border);
  cursor: move;
  touch-action: none;
}
.pw-title {
  flex: 1;
  min-width: 0;
  font-size: var(--bdg-fs-12);
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
  font-size: var(--bdg-fs-11);
  padding: 2px 6px;
}
.pw-x:hover {
  color: var(--bdg-text);
}
.pw-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  font-size: var(--bdg-fs-12);
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
