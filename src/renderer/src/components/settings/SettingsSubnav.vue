<script setup lang="ts">
import { computed } from "vue";

/**
 * Second-level category tabs (chips) shared by the declarative category
 * sections, the theme panel and the plugin panel. Styling lives in the global
 * `settings.css` (`.subnav` / `.subnav-item`), namespaced under
 * `.settings-panel`.
 *
 * Tabs use a roving tabindex so Tab leaves the group instead of stepping
 * through every chip; arrow keys move between them.
 */
const props = defineProps<{
  items: Array<{ key: string; label: string }>;
  modelValue: string;
  ariaLabel?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [key: string] }>();

const hasActive = computed(() =>
  props.items.some((it) => it.key === props.modelValue),
);

function select(key: string): void {
  if (key !== props.modelValue) emit("update:modelValue", key);
}

function onKeydown(e: KeyboardEvent): void {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  const current = props.items.findIndex((it) => it.key === props.modelValue);
  const last = props.items.length - 1;
  if (last < 0) return;
  let next = current < 0 ? 0 : current;
  if (e.key === "ArrowLeft") next = current <= 0 ? last : current - 1;
  else if (e.key === "ArrowRight") next = current >= last ? 0 : current + 1;
  else if (e.key === "Home") next = 0;
  else next = last;
  const target = props.items[next];
  if (!target) return;
  // `currentTarget` is null once the handler returns, so capture the tab list
  // before scheduling the focus move for the newly selected chip.
  const list = (e.currentTarget as HTMLElement | null)?.parentElement;
  select(target.key);
  requestAnimationFrame(() => {
    list?.querySelectorAll<HTMLElement>(".subnav-item")[next]?.focus();
  });
}
</script>

<template>
  <nav class="subnav" role="tablist" :aria-label="ariaLabel">
    <button
      v-for="(it, index) in items"
      :key="it.key"
      type="button"
      role="tab"
      class="subnav-item"
      :class="{ active: modelValue === it.key }"
      :aria-selected="modelValue === it.key"
      :tabindex="modelValue === it.key || (!hasActive && index === 0) ? 0 : -1"
      @click="select(it.key)"
      @keydown="onKeydown"
    >
      {{ it.label }}
    </button>
  </nav>
</template>
