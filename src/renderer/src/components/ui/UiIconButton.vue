<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    /** Highlights the button as engaged (accent fill + glow). */
    active?: boolean;
    /** Maps to aria-pressed; omit for actions that are not toggles. */
    pressed?: boolean;
    disabled?: boolean;
    /** Optional visible text rendered to the right of the icon. */
    label?: string;
  }>(),
  { active: false, disabled: false },
);
</script>

<template>
  <button
    type="button"
    class="icon-btn"
    :class="{ on: active, 'has-label': !!label }"
    :title="title"
    :aria-label="title"
    :aria-pressed="pressed"
    :disabled="disabled"
  >
    <slot />
    <span v-if="label" class="icon-btn-label">{{ label }}</span>
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
.icon-btn.on {
  color: var(--bdg-accent);
  background: rgb(var(--bdg-accent-rgb) / 0.16);
  border-color: rgb(var(--bdg-accent-rgb) / 0.45);
  box-shadow: 0 0 8px rgb(var(--bdg-accent-rgb) / 0.25);
}
.icon-btn:disabled {
  opacity: var(--bdg-disabled-opacity);
  cursor: default;
}
.icon-btn:hover:not(:disabled) {
  background: rgb(var(--bdg-neutral) / 0.18);
  color: var(--bdg-text);
}
/* With a visible label the button grows past the icon square and keeps the
   icon and text on one line. */
.icon-btn.has-label {
  width: auto;
  min-width: var(--bdg-ctl-md);
  padding: 0 8px;
  gap: 6px;
}
.icon-btn-label {
  font-size: var(--bdg-fs-11);
  line-height: 1;
  white-space: nowrap;
}
</style>
