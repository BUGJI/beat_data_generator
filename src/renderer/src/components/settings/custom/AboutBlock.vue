<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Info } from "@lucide/vue";
import {
  appDisplayName,
  patchSettings,
  useSettingsStore,
} from "../../../store";
import { toast } from "../../../ui/toast";
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
  font-size: calc(12px * var(--bdg-font-scale, 1));
}
.about-logo {
  font-size: calc(34px * var(--bdg-font-scale, 1));
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
  font-size: calc(16px * var(--bdg-font-scale, 1));
  font-weight: 800;
  height: auto;
  padding-left: 0px;
  padding-right: 2px;
  border-color: transparent;
  background: transparent;
  border-radius: 4px;
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
  font-family: "Consolas", monospace;
  font-size: calc(12px * var(--bdg-font-scale, 1));
}
</style>
