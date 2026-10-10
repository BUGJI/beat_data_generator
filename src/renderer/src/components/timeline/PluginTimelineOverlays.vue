<script setup lang="ts">
import { computed, onBeforeUnmount } from "vue";
import { timelineOverlays } from "../../plugins/registry";

/**
 * Hosts plugin timeline overlays. Mirrors TimelineNotes' layer model: a
 * full-bleed, pointer-events:none layer inside the timeline viewport; each
 * overlay gets its own container that fills it. Interactive children opt into
 * pointer-events:auto themselves.
 */

const cleanups = new Map<string, () => void>();
// Cache the ref callback per overlay key; an inline arrow would be treated as
// changed every render and force a remount (which clears plugin DOM).
const refs = new Map<string, (el: unknown) => void>();

function refFor(key: string): (el: unknown) => void {
  let cb = refs.get(key);
  if (!cb) {
    cb = (el) => bindOverlay(key, el as HTMLElement | null);
    refs.set(key, cb);
  }
  return cb;
}

const list = computed(() =>
  timelineOverlays.map((o) => ({
    key: `${o.pluginId}:${o.uid}`,
    z: o.def.z ?? 0,
  })),
);

function bindOverlay(key: string, el: HTMLElement | null): void {
  if (el) {
    const sep = key.indexOf(":");
    const pluginId = key.slice(0, sep);
    const uid = Number(key.slice(sep + 1));
    const o = timelineOverlays.find(
      (x) => x.pluginId === pluginId && x.uid === uid,
    );
    if (!o) return;
    try {
      const ret = o.def.mount(el);
      if (typeof ret === "function") cleanups.set(key, ret);
    } catch (err) {
      console.error(`[plugins] timeline overlay mount failed ${key}`, err);
    }
    return;
  }
  const cleanup = cleanups.get(key);
  if (cleanup) {
    try {
      cleanup();
    } catch (err) {
      console.error(`[plugins] timeline overlay unmount failed ${key}`, err);
    }
    cleanups.delete(key);
  }
}

onBeforeUnmount(() => {
  for (const [key, cleanup] of [...cleanups]) {
    try {
      cleanup();
    } catch (err) {
      console.error(`[plugins] timeline overlay unmount failed ${key}`, err);
    }
    cleanups.delete(key);
  }
});
</script>

<template>
  <div class="plugin-timeline-layer">
    <div
      v-for="o in list"
      :key="o.key"
      class="plugin-timeline-overlay"
      :style="{ zIndex: String(o.z) }"
      :ref="refFor(o.key)"
    />
  </div>
</template>

<style scoped>
.plugin-timeline-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  overflow: hidden;
}
.plugin-timeline-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
