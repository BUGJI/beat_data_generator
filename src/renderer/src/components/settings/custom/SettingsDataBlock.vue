<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "@renderer/stores/settings";
import {
  importSettings,
  resetSettings,
} from "@renderer/services/settingsPersistence";
import { toast } from "@renderer/ui/toast";
import UiButton from "../../ui/UiButton.vue";

const { t } = useI18n();
const settings = useSettingsStore();

const resetArmed = ref(false);
let resetTimer: number | undefined;

/** Two-step reset: the first click arms it, the second click performs it. */
function onResetSettings(): void {
  if (!resetArmed.value) {
    resetArmed.value = true;
    clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      resetArmed.value = false;
    }, 4000);
    return;
  }
  clearTimeout(resetTimer);
  resetArmed.value = false;
  resetSettings();
  toast.success(t("settings.data.resetOk"));
}
onBeforeUnmount(() => clearTimeout(resetTimer));

async function onExportSettings(): Promise<void> {
  const res = await window.api.saveFileDialog(
    t("settings.data.exportTitle"),
    "beat-data-generator-settings.json",
    [{ name: "JSON", extensions: ["json"] }],
  );
  if (res.canceled || !res.filePath) return;
  const snapshot = JSON.parse(JSON.stringify(settings.settings)) as Record<
    string,
    unknown
  >;
  const ok = await window.api.writeTextFile(
    res.filePath,
    JSON.stringify(snapshot, null, 2),
  );
  if (ok) toast.success(t("settings.data.exportOk"));
  else toast.error(t("settings.data.exportFail"));
}

async function onImportSettings(): Promise<void> {
  const path = await window.api.pickFile(t("settings.data.importTitle"), [
    { name: "JSON", extensions: ["json"] },
  ]);
  if (!path) return;
  const file = await window.api.readTextFile(path);
  if (file.canceled || typeof file.content !== "string") {
    toast.error(t("settings.data.importInvalid"));
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(file.content);
  } catch {
    toast.error(t("settings.data.importInvalid"));
    return;
  }
  if (importSettings(raw)) toast.success(t("settings.data.importOk"));
  else toast.error(t("settings.data.importInvalid"));
}
</script>

<template>
  <div class="data-block" :data-search="t('settings.general.settingsData')">
    <div class="data-head">
      <span class="field-name">{{ t("settings.data.manage") }}</span>
      <span class="muted">{{ t("settings.data.manageDesc") }}</span>
    </div>
    <div class="data-actions">
      <UiButton size="sm" @click="onExportSettings()">
        {{ t("settings.data.export") }}
      </UiButton>
      <UiButton size="sm" @click="onImportSettings()">
        {{ t("settings.data.import") }}
      </UiButton>
      <UiButton
        size="sm"
        :variant="resetArmed ? 'danger' : 'soft'"
        @click="onResetSettings()"
      >
        {{
          resetArmed
            ? t("settings.data.resetConfirm")
            : t("settings.data.reset")
        }}
      </UiButton>
    </div>
    <p v-if="resetArmed" class="muted data-note">
      {{ t("settings.data.resetDesc") }}
    </p>
  </div>
</template>

<style scoped>
.data-block {
  padding: 12px 0;
  border-bottom: 1px solid var(--bdg-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.data-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.data-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.data-note {
  margin: 0;
  font-size: var(--bdg-fs-12);
}
</style>
