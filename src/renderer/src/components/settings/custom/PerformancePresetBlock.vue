<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "@renderer/stores/settings";
import { patchSettings } from "@renderer/services/settingsPersistence";
import {
  activePerformancePreset,
  PERFORMANCE_PRESETS,
  type PerformancePresetId,
} from "@renderer/services/performancePresets";
import UiButton from "../../ui/UiButton.vue";

const { t } = useI18n();
const settings = useSettingsStore();

const active = computed<PerformancePresetId | null>(() =>
  activePerformancePreset(settings.settings),
);

function apply(id: PerformancePresetId): void {
  void patchSettings(PERFORMANCE_PRESETS[id]);
}
</script>

<template>
  <div
    class="preset-block"
    :data-search="t('settings.display.performancePreset')"
  >
    <div class="preset-head">
      <span class="field-name">{{
        t("settings.display.performancePreset")
      }}</span>
      <span class="muted">{{
        t("settings.display.performancePresetDesc")
      }}</span>
    </div>
    <div class="preset-actions">
      <UiButton
        size="sm"
        :variant="active === 'standard' ? 'solid' : 'soft'"
        @click="apply('standard')"
      >
        {{ t("settings.display.performanceStandard") }}
      </UiButton>
      <UiButton
        size="sm"
        :variant="active === 'light' ? 'solid' : 'soft'"
        @click="apply('light')"
      >
        {{ t("settings.display.performanceLight") }}
      </UiButton>
      <span v-if="active" class="muted preset-active">
        {{ t("settings.display.performanceActive") }}
      </span>
    </div>
    <p class="muted preset-note">
      {{ t("settings.display.performancePresetHint") }}
    </p>
  </div>
</template>

<style scoped>
.preset-block {
  padding: 12px 0;
  border-bottom: 1px solid var(--bdg-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.preset-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.preset-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.preset-active {
  font-size: var(--bdg-fs-12);
}
.preset-note {
  margin: 0;
  font-size: var(--bdg-fs-12);
}
</style>
