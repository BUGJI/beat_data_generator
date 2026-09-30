<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    /** Highlights the button as engaged (accent fill + glow). */
    active?: boolean;
    /** Maps to aria-pressed; omit for actions that are not toggles. */
    pressed?: boolean;
  }>(),
  { active: false },
);
</script>

<template>
  <button
    type="button"
    class="icon-btn"
    :class="{ on: active }"
    :title="title"
    :aria-label="title"
    :aria-pressed="pressed"
  >
    <slot />
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
</style>
