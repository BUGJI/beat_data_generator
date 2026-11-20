<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Info } from "@lucide/vue";
import { useSettingsStore } from "@renderer/stores/settings";
import { appDisplayName } from "@renderer/services/settingsEffects";
import {
  importSettings,
  patchSettings,
  resetSettings,
} from "@renderer/services/settingsPersistence";
import { toast } from "@renderer/ui/toast";
import UiButton from "../../ui/UiButton.vue";
import UiInput from "../../ui/UiInput.vue";

const { t } = useI18n();
const settings = useSettingsStore();

const appVersion = __APP_VERSION__;
const pv =
  typeof process !== "undefined" && process.versions ? process.versions : null;
const runtime = Object.freeze({
  node: pv?.node ?? "--",
  chrome: pv?.chrome ?? "--",
  electron: pv?.electron ?? "--",
});

const appName = computed<string>({
  // Empty means "use the localized default"; show that default in the field.
  get: () => settings.settings.appName.trim() || appDisplayName(),
  set: (v) => void patchSettings({ appName: v.trim() }),
});

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
  toast.success(t("settings.about.resetOk"));
}
onBeforeUnmount(() => clearTimeout(resetTimer));

async function onExportSettings(): Promise<void> {
  const res = await window.api.saveFileDialog(
    t("settings.about.exportTitle"),
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
  if (ok) toast.success(t("settings.about.exportOk"));
  else toast.error(t("settings.about.exportFail"));
}

async function onImportSettings(): Promise<void> {
  const path = await window.api.pickFile(t("settings.about.importTitle"), [
    { name: "JSON", extensions: ["json"] },
  ]);
  if (!path) return;
  const file = await window.api.readTextFile(path);
  if (file.canceled || typeof file.content !== "string") {
    toast.error(t("settings.about.importInvalid"));
    return;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(file.content);
  } catch {
    toast.error(t("settings.about.importInvalid"));
    return;
  }
  if (importSettings(raw)) toast.success(t("settings.about.importOk"));
  else toast.error(t("settings.about.importInvalid"));
}

const checkUpdateBusy = ref(false);
async function onCheckUpdates(): Promise<void> {
  checkUpdateBusy.value = true;
  try {
    const res = await window.api.checkForUpdates();
    if (res.status === "update")
      toast.success(
        t("settings.about.updateAvailable", { version: res.version ?? "" }),
      );
    else if (res.status === "current") toast.info(t("settings.about.upToDate"));
    else if (res.status === "unsupported")
      toast.info(t("settings.about.updateUnsupported"));
    else toast.error(t("settings.about.updateError"));
  } finally {
    checkUpdateBusy.value = false;
  }
}
</script>

<template>
  <div class="about-card">
    <div class="about-logo">
      <Info class="size-8" />
    </div>
    <div class="about-info">
      <UiInput v-model="appName" size="sm" class="about-name-input" />
      <div class="muted">{{ t("app.hint") }}</div>
    </div>
  </div>
  <div class="about-update">
    <UiButton
      variant="solid"
      size="sm"
      :loading="checkUpdateBusy"
      @click="onCheckUpdates()"
    >
      {{ t("settings.about.checkUpdates") }}
    </UiButton>
    <p class="muted">{{ t("settings.about.checkUpdatesDesc") }}</p>
  </div>
  <div class="about-manage">
    <div class="about-manage-head">
      <span class="field-name">{{ t("settings.about.manage") }}</span>
      <span class="muted">{{ t("settings.about.manageDesc") }}</span>
    </div>
    <div class="about-manage-actions">
      <UiButton size="sm" @click="onExportSettings()">
        {{ t("settings.about.export") }}
      </UiButton>
      <UiButton size="sm" @click="onImportSettings()">
        {{ t("settings.about.import") }}
      </UiButton>
      <UiButton
        size="sm"
        :variant="resetArmed ? 'danger' : 'soft'"
        @click="onResetSettings()"
      >
        {{
          resetArmed
            ? t("settings.about.resetConfirm")
            : t("settings.about.reset")
        }}
      </UiButton>
    </div>
    <p v-if="resetArmed" class="muted about-manage-note">
      {{ t("settings.about.resetDesc") }}
    </p>
  </div>
  <dl class="about-meta">
    <dt>{{ t("settings.about.version") }}</dt>
    <dd>v{{ appVersion }}</dd>
    <dt>{{ t("settings.about.author") }}</dt>
    <dd>BUGJI</dd>
    <dt>{{ t("settings.about.tech") }}</dt>
    <dd>
      Electron · Vue 3 · TypeScript · Vite · Pinia · Tailwind CSS · Reka UI
    </dd>
    <dt>{{ t("settings.about.license") }}</dt>
    <dd>GNU GPL v3</dd>
    <dt>{{ t("settings.about.runtime") }}</dt>
    <dd>
      Node.js {{ runtime.node }} · Chromium {{ runtime.chrome }} · Electron
      {{ runtime.electron }}
    </dd>
  </dl>
</template>

<style scoped>
.about-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  background: rgb(var(--bdg-accent-rgb) / 0.07);
  border: 1px solid rgb(var(--bdg-accent-rgb) / 0.18);
  border-radius: calc(var(--bdg-radius, 6px) * 2);
}
.about-update {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.about-update p {
  margin: 0;
  font-size: var(--bdg-fs-12);
}
.about-manage {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--bdg-border);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.about-manage-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.about-manage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.about-manage-note {
  margin: 0;
  font-size: var(--bdg-fs-12);
}
.about-logo {
  font-size: var(--bdg-fs-34);
  color: var(--bdg-accent);
}
.about-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.about-name-input {
  font-size: var(--bdg-fs-16);
  font-weight: 800;
  height: auto;
  padding-left: 0px;
  padding-right: 2px;
  border-color: transparent;
  background: transparent;
  border-radius: var(--bdg-radius-sm);
  cursor: text;
}
.about-name-input:focus {
  border-color: var(--bdg-accent);
  background: rgb(var(--bdg-accent-rgb) / 0.08);
}
.about-meta {
  display: grid;
  grid-template-columns: 96px 1fr;
  gap: 8px 14px;
  margin-top: 16px;
}
.about-meta dt {
  color: var(--bdg-text-dim);
}
.about-meta dd {
  margin: 0;
  font-family: var(--bdg-font-mono);
  font-size: var(--bdg-fs-12);
}
</style>
