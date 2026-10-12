<script setup lang="ts">
import type { Component } from "vue";

/**
 * Second-level category tabs (chips) shared by the declarative category
 * sections and the theme panel. Styling lives in the global `settings.css`
 * (`.subnav` / `.subnav-item`), namespaced under `.settings-panel`.
 */
defineProps<{
  items: Array<{ key: string; label: string; icon?: Component }>;
  modelValue: string;
  ariaLabel?: string;
}>();

defineEmits<{ "update:modelValue": [key: string] }>();
</script>

<template>
  <nav class="subnav" :aria-label="ariaLabel">
    <button
      v-for="it in items"
      :key="it.key"
      type="button"
      class="subnav-item"
      :class="{ active: modelValue === it.key }"
      @click="$emit('update:modelValue', it.key)"
    >
      <component :is="it.icon" v-if="it.icon" class="subnav-icon" />
      {{ it.label }}
    </button>
  </nav>
</template>

<style scoped>
.subnav-icon {
  width: 14px;
  height: 14px;
  margin-right: 5px;
  vertical-align: -2px;
}
</style>
