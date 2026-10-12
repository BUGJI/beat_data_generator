<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { CatKey, GroupDef, RowDef } from "./types";
import { customRowComponent } from "./custom";
import { visualPreviewFor } from "./previews";
import SettingsFieldRow from "./SettingsFieldRow.vue";
import SettingsSubnav from "./SettingsSubnav.vue";

const props = defineProps<{
  catKey: CatKey;
  groups: GroupDef[];
  activeGroup: string;
  rows: RowDef[];
}>();

const emit = defineEmits<{ selectGroup: [key: string] }>();

const { t, te } = useI18n();

const groupItems = computed(() =>
  props.groups.map((g) => ({
    key: g.key,
    label: t(`settings.subcats.${props.catKey}.${g.key}`),
    icon: g.icon,
  })),
);

/** A live, read-only demo pane for categories that benefit from it. */
const preview = computed(() => visualPreviewFor(props.catKey));
</script>

<template>
  <section :class="{ 'has-preview': !!preview }">
    <h3>{{ t(`settings.cats.${catKey}`) }}</h3>
    <SettingsSubnav
      v-if="groups.length > 1"
      :items="groupItems"
      :model-value="activeGroup"
      :aria-label="t(`settings.cats.${catKey}`)"
      @update:model-value="emit('selectGroup', $event)"
    />
    <div class="cat-split" :class="{ split: !!preview }">
      <div class="cat-main">
        <template v-for="(row, i) in rows" :key="i">
          <div v-if="row.kind === 'subhead'" class="sub-head">
            {{ t(`settings.${catKey}.${row.key}`) }}
          </div>

          <component
            :is="customRowComponent(row.id)"
            v-else-if="row.kind === 'custom'"
          />

          <SettingsFieldRow
            v-else-if="row.kind === 'field'"
            :label="t(`settings.${catKey}.${row.key}`)"
            :desc="
              te(`settings.${catKey}.${row.key}Desc`)
                ? t(`settings.${catKey}.${row.key}Desc`)
                : undefined
            "
            :unit="
              row.control.type === 'number' && row.control.unitKey
                ? t(`settings.${catKey}.${row.control.unitKey}`)
                : undefined
            "
            :col="row.col"
            :show-if="row.showIf"
            :control="row.control"
          />
        </template>
      </div>

      <aside v-if="preview" class="cat-preview">
        <div class="sub-head">{{ t("settings.preview.title") }}</div>
        <component :is="preview" :cat="catKey" />
        <p class="muted cat-preview-hint">{{ t("settings.preview.hint") }}</p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.cat-split.split {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 20px;
}
.cat-main {
  flex: 1 1 380px;
  min-width: 0;
}
.cat-split:not(.split) .cat-main {
  width: 100%;
}
.cat-preview {
  flex: 1 1 220px;
  max-width: 320px;
  min-width: 0;
  position: sticky;
  top: 0;
}
.cat-preview-hint {
  margin: 8px 0 0;
}
</style>
