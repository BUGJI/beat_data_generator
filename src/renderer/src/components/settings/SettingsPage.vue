<script setup lang="ts">
import { ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import { ChevronDown } from "@lucide/vue";

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

const { t } = useI18n();
// Collapsed by default so narrow panels can reach the settings first; the
// toggle only exists when the two-column layout has stacked (see the container
// query below), and wide panels ignore the state entirely.
const asideOpen = ref(false);
const asideBodyId = useId();
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
      <aside
        v-if="hasAside"
        class="settings-page-aside"
        :class="{ open: asideOpen }"
      >
        <button
          type="button"
          class="aside-toggle"
          :aria-expanded="asideOpen"
          :aria-controls="asideBodyId"
          @click="asideOpen = !asideOpen"
        >
          <ChevronDown class="aside-toggle-icon" :class="{ open: asideOpen }" />
          <span>{{ t("settings.preview.title") }}</span>
        </button>
        <div :id="asideBodyId" class="aside-body">
          <slot name="aside" />
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
/* Hidden on wide panels where the preview sits beside the settings. */
.aside-toggle {
  display: none;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin: 0 0 8px;
  padding: 8px 10px;
  border: 1px solid var(--bdg-border);
  border-radius: var(--bdg-radius, 6px);
  background: var(--bdg-bg-raised);
  color: var(--bdg-text);
  font-family: inherit;
  font-size: var(--bdg-fs-12);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.aside-toggle:hover {
  background: rgb(var(--bdg-neutral) / 0.12);
}
.aside-toggle-icon {
  flex: none;
  transition: transform calc(0.18s * var(--bdg-motion-scale, 1)) ease;
}
.aside-toggle-icon.open {
  transform: rotate(180deg);
}

@container (max-width: 720px) {
  .aside-toggle {
    display: inline-flex;
  }
  .aside-body {
    display: none;
  }
  .settings-page-aside.open .aside-body {
    display: block;
  }
}
</style>
