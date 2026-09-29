<script setup lang="ts">
import { ref } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { openDevTools } from "../../../stores/settings";
import { useSettingsRowsStore } from "../useSettingsRows";
import UiButton from "../../ui/UiButton.vue";

const { t } = useI18n();
const { devEnabled } = storeToRefs(useSettingsRowsStore());

const devOpenBusy = ref(false);
async function onOpenDevTools(): Promise<void> {
  if (!devEnabled.value) return;
  devOpenBusy.value = true;
  await openDevTools();
  setTimeout(() => {
    devOpenBusy.value = false;
  }, 200);
}
</script>

<template>
  <div class="dev-block" :class="{ off: !devEnabled }">
    <UiButton
      variant="solid"
      :disabled="!devEnabled"
      :loading="devOpenBusy"
      @click="onOpenDevTools()"
    >
      {{ t("settings.advanced.openTools") }}
    </UiButton>
    <p class="muted">{{ t("settings.advanced.openToolsDesc") }}</p>
  </div>
</template>

<style scoped>
.dev-block {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.dev-block.off {
  opacity: 0.5;
}
</style>
