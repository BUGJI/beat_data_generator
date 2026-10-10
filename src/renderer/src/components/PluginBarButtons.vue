<script setup lang="ts">
import { barButtons, localeText } from "../plugins/registry";

/**
 * Renders plugin-contributed quick-action buttons into the project bar. Kept
 * visually consistent with UiIconButton; the icon is plugin-authored inline SVG.
 */

function onClick(b: (typeof barButtons)[number]): void {
  if (b.def.toggle) b.active = !b.active;
  const r = b.def.run(b.active);
  if (r && typeof (r as Promise<void>).then === "function") {
    void (r as Promise<void>).catch((err) => {
      console.error(`[plugin:${b.pluginId}] bar button ${b.def.id} error`, err);
    });
  }
}
</script>

<template>
  <span v-if="barButtons.length" class="quick-divider" />
  <button
    v-for="b in barButtons"
    :key="`${b.pluginId}:${b.uid}`"
    type="button"
    class="icon-btn"
    :class="{ on: b.active }"
    :title="localeText(b.def.title)"
    :aria-label="localeText(b.def.title)"
    :aria-pressed="b.def.toggle ? b.active : undefined"
    @click="onClick(b)"
  >
    <span v-if="b.def.icon" class="pb-btn-ico" v-html="b.def.icon" />
    <span v-else class="pb-btn-txt">{{ localeText(b.def.title) }}</span>
  </button>
</template>

<style scoped>
.icon-btn {
  width: var(--bdg-ctl-md);
  height: var(--bdg-ctl-md);
  border-radius: var(--bdg-radius, 6px);
  border: 1px solid var(--bdg-border-strong);
  background: rgb(var(--bdg-neutral) / 0.08);
  color: var(--bdg-text-dim);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-family: inherit;
}
.icon-btn:hover {
  background: rgb(var(--bdg-neutral) / 0.18);
  color: var(--bdg-text);
}
.icon-btn.on {
  color: var(--bdg-accent);
  background: rgb(var(--bdg-accent-rgb) / 0.16);
  border-color: rgb(var(--bdg-accent-rgb) / 0.45);
  box-shadow: 0 0 8px rgb(var(--bdg-accent-rgb) / 0.25);
}
.pb-btn-ico {
  display: inline-flex;
  width: 15px;
  height: 15px;
}
.pb-btn-ico :deep(svg) {
  width: 15px;
  height: 15px;
  display: block;
}
.pb-btn-txt {
  font-size: var(--bdg-fs-11);
  padding: 0 6px;
  white-space: nowrap;
}
.quick-divider {
  width: 1px;
  height: 18px;
  background: var(--bdg-border);
  margin: 0 2px;
  flex: none;
}
</style>
