<script setup lang="ts">
/**
 * Shared page shell for every settings category: title row, optional second
 * level tabs, and an optional side-by-side preview column. Styling lives in the
 * global `settings.css` (namespaced under `.settings-panel`).
 */
withDefaults(
  defineProps<{
    title: string;
    /** Two-column canvas width for preview / marketplace pages. */
    wide?: boolean;
    /** Render the `aside` slot next to the main column. */
    hasAside?: boolean;
  }>(),
  { wide: false, hasAside: false },
);
</script>

<template>
  <section class="settings-page" :class="{ wide, 'has-aside': hasAside }">
    <div class="settings-page-head">
      <h3>{{ title }}</h3>
      <div v-if="$slots.actions" class="settings-page-actions">
        <slot name="actions" />
      </div>
    </div>
    <slot name="subnav" />
    <div class="settings-page-split" :class="{ split: hasAside }">
      <div class="settings-page-main">
        <slot />
      </div>
      <aside v-if="hasAside" class="settings-page-aside">
        <slot name="aside" />
      </aside>
    </div>
  </section>
</template>
