<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { CatKey, GroupDef, RowDef } from "./types";
import { customRowComponent } from "./custom";
import { visualPreviewFor } from "./previews";
import SettingsFieldRow from "./SettingsFieldRow.vue";
import SettingsPage from "./SettingsPage.vue";
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
  })),
);

/** A live, read-only demo pane for categories that benefit from it. */
const preview = computed(() => visualPreviewFor(props.catKey));

/** Stable identity per row so switching sub-tabs reuses component state safely. */
function rowKey(row: RowDef): string {
  if (row.kind === "field") return `field:${row.key}`;
  if (row.kind === "custom") return `custom:${row.id}`;
  return `subhead:${row.key}`;
}
</script>

<template>
  <SettingsPage
    :title="t(`settings.cats.${catKey}`)"
    :wide="!!preview"
    :has-aside="!!preview"
  >
    <template v-if="groups.length > 1" #subnav>
      <SettingsSubnav
        :items="groupItems"
        :model-value="activeGroup"
        :aria-label="t(`settings.cats.${catKey}`)"
        @update:model-value="emit('selectGroup', $event)"
      />
    </template>

    <template v-for="row in rows" :key="rowKey(row)">
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

    <template v-if="preview" #aside>
      <div class="sub-head">{{ t("settings.preview.title") }}</div>
      <component :is="preview" :cat="catKey" />
      <p class="muted preview-hint">{{ t("settings.preview.hint") }}</p>
    </template>
  </SettingsPage>
</template>

<style scoped>
.preview-hint {
  margin: 8px 0 0;
}
</style>
