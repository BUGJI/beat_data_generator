<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { patchSettings, useSettingsStore } from "../../stores/settings";
import { GH_PROXY_PRESETS, type PingResult } from "@shared/network";
import type { ProxyMode } from "@shared/settings";
import { useSettingsRowsStore } from "./useSettingsRows";
import UiButton from "../ui/UiButton.vue";
import UiInput from "../ui/UiInput.vue";
import UiRadioGroup from "../ui/UiRadioGroup.vue";
import UiSwitch from "../ui/UiSwitch.vue";

const { t } = useI18n();
const settings = useSettingsStore();
const { simpleMode } = storeToRefs(useSettingsRowsStore());

const proxyOptions = computed(() => [
  { value: "system", label: t("settings.network.proxySystem") },
  { value: "env", label: t("settings.network.proxyEnv") },
  { value: "off", label: t("settings.network.proxyOff") },
]);

function onProxyMode(v: string): void {
  void patchSettings({ proxyMode: v as ProxyMode });
}
function onGithubProxy(v: boolean): void {
  void patchSettings({ githubProxy: v });
}
function onGithubProxyHost(v: string): void {
  void patchSettings({ githubProxyHost: v });
}

const proxyLatency = ref<Record<string, PingResult | "testing">>({});
const pinging = ref(false);

function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

function ghProxyLatencyText(u: string): string {
  const r = proxyLatency.value[u];
  if (r === "testing") return t("settings.network.pingTesting");
  if (r?.ok) return `${r.ms} ms`;
  if (r && !r.ok) return t("settings.network.pingFail");
  return "";
}

const isCustomProxy = computed(
  () =>
    !(GH_PROXY_PRESETS as readonly string[]).includes(
      settings.settings.githubProxyHost,
    ),
);

function useCustomProxy(): void {
  if (!isCustomProxy.value) onGithubProxyHost("");
}

async function testProxies(): Promise<void> {
  if (pinging.value) return;
  pinging.value = true;
  const targets = new Set<string>(GH_PROXY_PRESETS);
  const custom = settings.settings.githubProxyHost.trim();
  if (custom) targets.add(custom);
  const next: Record<string, PingResult | "testing"> = {
    ...proxyLatency.value,
  };
  for (const u of targets) next[u] = "testing";
  proxyLatency.value = next;
  try {
    await Promise.all(
      [...targets].map(async (u) => {
        const r = await window.api.pingHost(u);
        proxyLatency.value = { ...proxyLatency.value, [u]: r };
      }),
    );
  } finally {
    pinging.value = false;
  }
}
</script>

<template>
  <section>
    <h3>{{ t("settings.cats.network") }}</h3>

    <template v-if="!simpleMode">
      <div class="sub-head">{{ t("settings.network.proxy") }}</div>
      <div class="field-row col">
        <div class="field-info">
          <span class="field-name">{{ t("settings.network.proxy") }}</span>
          <span class="field-desc">{{ t("settings.network.proxyDesc") }}</span>
        </div>
        <UiRadioGroup
          :model-value="settings.settings.proxyMode"
          :options="proxyOptions"
          :aria-label="t('settings.network.proxy')"
          @update:model-value="onProxyMode"
        />
      </div>
      <p
        v-if="settings.settings.proxyMode === 'env'"
        class="field-desc network-note"
      >
        {{ t("settings.network.proxyEnvHint") }}
      </p>
    </template>

    <div class="sub-head">{{ t("settings.network.ghProxy") }}</div>
    <div class="field-row">
      <div class="field-info">
        <span class="field-name">{{ t("settings.network.ghProxy") }}</span>
        <span class="field-desc">{{ t("settings.network.ghProxyDesc") }}</span>
      </div>
      <UiSwitch
        :model-value="settings.settings.githubProxy"
        :aria-label="t('settings.network.ghProxy')"
        @update:model-value="onGithubProxy"
      />
    </div>
    <div v-if="settings.settings.githubProxy" class="field-row col">
      <div class="field-info">
        <span class="field-name">{{ t("settings.network.ghProxyHost") }}</span>
        <span class="field-desc">{{
          t("settings.network.ghProxyHostDesc")
        }}</span>
      </div>
      <div class="ghproxy-list">
        <button
          v-for="u in GH_PROXY_PRESETS"
          :key="u"
          type="button"
          class="ghproxy-item"
          :class="{ active: settings.settings.githubProxyHost === u }"
          @click="onGithubProxyHost(u)"
        >
          <span class="ghproxy-host">{{ hostOf(u) }}</span>
          <span class="ghproxy-ms num">{{ ghProxyLatencyText(u) }}</span>
        </button>
        <button
          type="button"
          class="ghproxy-item"
          :class="{ active: isCustomProxy }"
          @click="useCustomProxy()"
        >
          <span class="ghproxy-host">{{
            t("settings.network.ghProxyCustom")
          }}</span>
        </button>
        <UiInput
          v-if="isCustomProxy"
          :model-value="settings.settings.githubProxyHost"
          size="sm"
          @update:model-value="onGithubProxyHost"
        />
        <UiButton
          size="sm"
          variant="soft"
          :loading="pinging"
          @click="testProxies()"
        >
          {{ t("settings.network.ghProxyTest") }}
        </UiButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ghproxy-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  max-width: 440px;
}
.ghproxy-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 10px;
  border: 1px solid var(--bdg-border);
  border-radius: var(--bdg-radius-ui, 6px);
  background: transparent;
  color: var(--bdg-text);
  font-family: inherit;
  font-size: calc(12px * var(--bdg-font-scale, 1));
  cursor: pointer;
  text-align: left;
}
.ghproxy-item:hover {
  background: rgb(var(--bdg-neutral) / 0.1);
}
.ghproxy-item.active {
  border-color: rgb(var(--bdg-accent-rgb) / 0.5);
  background: rgb(var(--bdg-accent-rgb) / 0.12);
  color: var(--bdg-accent);
  font-weight: 600;
}
.ghproxy-host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ghproxy-ms {
  flex: none;
  font-size: calc(11px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
}
.ghproxy-item.active .ghproxy-ms {
  color: var(--bdg-accent);
}
.network-note {
  margin: -6px 0 6px;
}
</style>
