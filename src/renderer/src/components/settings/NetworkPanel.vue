<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "../../stores/settings";
import { patchSettings } from "../../services/settingsPersistence";
import {
  GH_PROXY_DEFAULT_HOST,
  GH_PROXY_PRESETS,
  normalizeProxyHost,
  type PingResult,
} from "@shared/network";
import type { ProxyMode } from "@shared/settings";
import SettingsPage from "./SettingsPage.vue";
import UiButton from "../ui/UiButton.vue";
import UiInput from "../ui/UiInput.vue";
import UiRadioGroup from "../ui/UiRadioGroup.vue";
import UiSwitch from "../ui/UiSwitch.vue";

const { t } = useI18n();
const settings = useSettingsStore();

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

// The free-form host is edited as a draft and only persisted when valid, so a
// half-typed value never replaces a working mirror.
const customHostDraft = ref(settings.settings.githubProxyHost);
watch(
  () => settings.settings.githubProxyHost,
  (host) => {
    customHostDraft.value = host;
  },
);
const customHostValid = computed(
  () => normalizeProxyHost(customHostDraft.value) !== null,
);

function useCustomProxy(): void {
  if (isCustomProxy.value) return;
  customHostDraft.value = GH_PROXY_DEFAULT_HOST;
  onGithubProxyHost(GH_PROXY_DEFAULT_HOST);
}

function commitCustomHost(): void {
  const host = normalizeProxyHost(customHostDraft.value);
  if (!host) return;
  customHostDraft.value = host;
  if (host !== settings.settings.githubProxyHost) onGithubProxyHost(host);
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
  <SettingsPage :title="t('settings.cats.network')">
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
          v-model="customHostDraft"
          size="sm"
          :placeholder="GH_PROXY_DEFAULT_HOST"
          @keydown.enter="commitCustomHost()"
          @blur="commitCustomHost()"
        />
        <p v-if="isCustomProxy && !customHostValid" class="network-error">
          {{ t("settings.network.ghProxyHostInvalid") }}
        </p>
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
  </SettingsPage>
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
  border-radius: var(--bdg-radius, 6px);
  background: transparent;
  color: var(--bdg-text);
  font-family: inherit;
  font-size: var(--bdg-fs-12);
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
  font-size: var(--bdg-fs-11);
  color: var(--bdg-text-dim);
}
.ghproxy-item.active .ghproxy-ms {
  color: var(--bdg-accent);
}
.network-note {
  margin: -6px 0 6px;
}
.network-error {
  margin: -2px 0 2px;
  color: var(--bdg-danger);
  font-size: var(--bdg-fs-11);
}
</style>
