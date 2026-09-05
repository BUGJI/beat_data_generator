<script setup lang="ts">
import { computed } from "vue";
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
  title: string;
}

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
      return { pluginId: o.pluginId, uid: o.uid, title };
    })
    .filter((x): x is Card => !!x),
);

function bindPanel(pluginId: string, uid: number, el: HTMLElement | null): void {
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

function onClose(pluginId: string, uid: number): void {
  closePanel(pluginId, uid);
}
</script>

<template>
  <div v-if="list.length" class="plugin-panels">
    <div
      v-for="card in list"
      :key="`${card.pluginId}:${card.uid}`"
      class="plugin-panel"
    >
      <div class="pp-head">
        <span class="pp-title">{{ card.title }}</span>
        <button class="pp-x" @click="onClose(card.pluginId, card.uid)">
          ✕
        </button>
      </div>
      <div
        class="pp-body"
        :ref="(el: unknown) => bindPanel(card.pluginId, card.uid, el as HTMLElement | null)"
      />
    </div>
  </div>
</template>

<style scoped>
.plugin-panels {
  position: fixed;
  right: 12px;
  bottom: 46px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  pointer-events: none;
}
.plugin-panel {
  width: 320px;
  max-width: calc(100vw - 24px);
  pointer-events: auto;
  background: #161b23;
  border: 1px solid var(--bdg-border-strong);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.pp-head {
  flex: none;
  display: flex;
  align-items: center;
  padding: 6px 8px 6px 12px;
  background: rgba(148, 163, 184, 0.05);
  border-bottom: 1px solid var(--bdg-border);
}
.pp-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pp-x {
  flex: none;
  background: none;
  border: none;
  color: var(--bdg-text-dim);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 6px;
}
.pp-x:hover {
  color: var(--bdg-text);
}
.pp-body {
  min-height: 60px;
  max-height: 46vh;
  overflow: auto;
  font-size: 12px;
  color: var(--bdg-text);
}
</style>
