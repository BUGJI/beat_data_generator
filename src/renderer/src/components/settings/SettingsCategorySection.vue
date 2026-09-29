<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { CatKey, GroupDef, RowDef } from "./types";
import { customRowComponent } from "./custom";
import SettingsFieldRow from "./SettingsFieldRow.vue";

defineProps<{
  catKey: CatKey;
  groups: GroupDef[];
  activeGroup: string;
  rows: RowDef[];
}>();

defineEmits<{ selectGroup: [key: string] }>();

const { t, te } = useI18n();
</script>

<template>
  <section>
    <h3>{{ t(`settings.cats.${catKey}`) }}</h3>
    <nav
      v-if="groups.length > 1"
      class="subnav"
      :aria-label="t(`settings.cats.${catKey}`)"
    >
      <button
        v-for="g in groups"
        :key="g.key"
        class="subnav-item"
        :class="{ active: activeGroup === g.key }"
        @click="$emit('selectGroup', g.key)"
      >
        {{ t(`settings.subcats.${catKey}.${g.key}`) }}
      </button>
    </nav>
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
  </section>
</template>
