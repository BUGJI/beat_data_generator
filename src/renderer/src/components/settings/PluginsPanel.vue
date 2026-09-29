<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  pluginDescription,
  pluginEntries,
  pluginName,
  refreshPlugins,
  reloadPlugins,
  setPluginEnabled,
} from "../../plugins/host";
import { useMarketplaceStore } from "./useMarketplace";
import type { PluginEntry } from "../../../../shared/plugin";
import UiButton from "../ui/UiButton.vue";
import UiInput from "../ui/UiInput.vue";
import UiSwitch from "../ui/UiSwitch.vue";

const { t } = useI18n();
const market = useMarketplaceStore();

const pluginBusy = ref<string | null>(null);
const pluginsLoading = ref(false);

async function onTogglePlugin(entry: PluginEntry): Promise<void> {
  pluginBusy.value = entry.id;
  await setPluginEnabled(entry.id, !entry.enabled);
  pluginBusy.value = null;
}

async function onReloadPlugins(): Promise<void> {
  pluginsLoading.value = true;
  await reloadPlugins();
  pluginsLoading.value = false;
}

async function onOpenPluginsFolder(): Promise<void> {
  await window.api.openPluginsFolder();
}

onMounted(() => {
  void refreshPlugins();
  if (market.tab === "market" && market.items.length === 0)
    void market.load(false);
});

watch(
  () => market.tab,
  (tab) => {
    if (tab === "market" && market.items.length === 0 && !market.loading) {
      void market.load(false);
    }
  },
);
</script>

<template>
  <section>
    <h3>{{ t("settings.plugins.title") }}</h3>
    <nav class="subnav">
      <button
        class="subnav-item"
        :class="{ active: market.tab === 'installed' }"
        @click="market.tab = 'installed'"
      >
        {{ t("settings.plugins.subInstalled") }}
      </button>
      <button
        class="subnav-item"
        :class="{ active: market.tab === 'market' }"
        @click="market.tab = 'market'"
      >
        {{ t("settings.plugins.subMarket") }}
      </button>
    </nav>

    <div v-show="market.tab === 'installed'">
      <div class="plugin-tools">
        <UiButton
          size="sm"
          :loading="pluginsLoading"
          @click="onReloadPlugins()"
        >
          {{ t("settings.plugins.reload") }}
        </UiButton>
        <UiButton size="sm" @click="onOpenPluginsFolder()">
          {{ t("settings.plugins.openFolder") }}
        </UiButton>
        <UiButton size="sm" @click="market.installZip()">
          {{ t("settings.plugins.importZip") }}
        </UiButton>
      </div>

      <div v-if="pluginEntries.length === 0" class="plugin-empty">
        <p>{{ t("settings.plugins.none") }}</p>
        <p class="muted">{{ t("settings.plugins.noneHint") }}</p>
      </div>

      <div v-for="entry in pluginEntries" :key="entry.id" class="plugin-card">
        <div class="plugin-main">
          <div class="plugin-titles">
            <span class="plugin-name">
              {{ pluginName(entry) }}
              <span class="plugin-ver num">v{{ entry.version }}</span>
            </span>
            <span class="plugin-desc">
              {{ pluginDescription(entry) || entry.id }}
            </span>
            <span v-if="entry.error" class="plugin-err">
              {{ entry.error }}
            </span>
          </div>
          <div class="plugin-meta">
            <span v-if="entry.main" class="badge">main</span>
            <span v-if="entry.renderer" class="badge">renderer</span>
            <UiSwitch
              :model-value="entry.enabled"
              :disabled="pluginBusy === entry.id"
              :aria-label="pluginName(entry)"
              @update:model-value="() => void onTogglePlugin(entry)"
            />
          </div>
        </div>
        <div class="plugin-dir num">{{ entry.dir }}</div>
      </div>
    </div>

    <div v-show="market.tab === 'market'">
      <div class="plugin-tools">
        <UiButton
          size="sm"
          :loading="market.loading"
          @click="market.load(true)"
        >
          {{ t("settings.plugins.marketRefresh") }}
        </UiButton>
        <label class="ttl-field" :title="t('settings.plugins.cacheTtlDesc')">
          <span class="muted">{{ t("settings.plugins.cacheTtl") }}</span>
          <nav class="subnav ttl-chips">
            <button
              v-for="o in market.ttlOptions"
              :key="o.value"
              type="button"
              class="subnav-item"
              :class="{ active: market.cacheTtl === o.value }"
              @click="market.cacheTtl = o.value"
            >
              {{ o.label }}
            </button>
          </nav>
        </label>
      </div>

      <div class="market-filters">
        <UiInput
          v-model="market.query"
          size="sm"
          :placeholder="t('settings.plugins.marketSearch')"
        />
      </div>
      <nav v-if="market.categories.length" class="subnav market-cats">
        <button
          class="subnav-item"
          :class="{ active: market.category === '' }"
          @click="market.category = ''"
        >
          {{ t("settings.plugins.marketAll") }}
          <span class="num">{{ market.items.length }}</span>
        </button>
        <button
          v-for="c in market.categories"
          :key="c"
          class="subnav-item"
          :class="{ active: market.category === c }"
          @click="market.category = c"
        >
          {{ market.categoryLabel(c) }}
          <span class="num">{{ market.categoryCounts[c] ?? 0 }}</span>
        </button>
      </nav>

      <p v-if="market.error" class="plugin-err">{{ market.error }}</p>

      <p
        v-if="!market.loading && market.filtered.length === 0"
        class="plugin-empty"
      >
        {{ t("settings.plugins.marketNoMatch") }}
      </p>

      <div v-for="p in market.filtered" :key="p.id" class="plugin-card">
        <div class="plugin-main">
          <div class="plugin-titles">
            <span class="plugin-name">
              {{ market.name(p) }}
              <span class="plugin-ver num">v{{ p.latest }}</span>
              <span
                v-if="p.installedVersion && p.updateAvailable"
                class="badge warn"
              >
                {{ t("settings.plugins.badgeUpdate") }}
              </span>
              <span v-else-if="p.installedVersion" class="badge">
                {{ t("settings.plugins.badgeInstalled") }}
              </span>
            </span>
            <span class="plugin-desc">{{ market.desc(p) }}</span>
            <span class="plugin-sub muted">
              <template v-if="p.author">{{ p.author }}</template>
              <template v-for="c in p.categories" :key="c">
                · {{ market.categoryLabel(c) }}
              </template>
              <template v-if="p.installedVersion">
                ·
                {{
                  t("settings.plugins.installedVer", {
                    version: p.installedVersion,
                  })
                }}
              </template>
            </span>
          </div>
          <div class="plugin-meta">
            <template v-if="market.busy === p.id">
              <span class="plugin-ver num">
                {{ market.phaseText(market.progress[p.id]) }}
              </span>
              <div
                v-if="market.percent(market.progress[p.id]) !== null"
                class="progress-track"
              >
                <div
                  class="progress-fill"
                  :style="{
                    width: `${market.percent(market.progress[p.id])}%`,
                  }"
                />
              </div>
            </template>
            <template v-else-if="market.trustFor === p.id">
              <UiButton size="sm" variant="solid" @click="market.install(p)">
                {{ t("settings.plugins.trustConfirm") }}
              </UiButton>
              <UiButton size="sm" @click="market.trustFor = null">
                {{ t("settings.plugins.trustCancel") }}
              </UiButton>
            </template>
            <template v-else>
              <span
                v-if="!p.compatible"
                class="plugin-ver"
                :title="
                  t('settings.plugins.requiresApp', {
                    version: p.minAppVersion,
                  })
                "
              >
                {{ t("settings.plugins.incompatible") }}
              </span>
              <UiButton
                v-else-if="market.action(p) === 'install'"
                size="sm"
                variant="solid"
                @click="market.trustFor = p.id"
              >
                {{ t("settings.plugins.install") }}
              </UiButton>
              <UiButton
                v-else-if="market.action(p) === 'update'"
                size="sm"
                variant="solid"
                @click="market.trustFor = p.id"
              >
                {{ t("settings.plugins.update") }}
              </UiButton>
              <button
                v-if="market.action(p) === 'installed' && p.managed"
                class="link-btn"
                @click="market.uninstall(p)"
              >
                {{ t("settings.plugins.uninstall") }}
              </button>
            </template>
          </div>
        </div>
        <div v-if="market.trustFor === p.id" class="trust-box">
          <strong>{{ t("settings.plugins.trustTitle") }}</strong>
          <span>
            {{ t("settings.plugins.trustBody", { name: market.name(p) }) }}
          </span>
        </div>
        <div class="plugin-dir num">{{ p.repo || p.id }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.plugin-tools {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.plugin-empty {
  color: var(--bdg-text-dim);
  font-size: calc(13px * var(--bdg-font-scale, 1));
}
.plugin-card {
  padding: 10px 0;
  border-bottom: 1px solid var(--bdg-border);
}
.plugin-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.plugin-titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.plugin-name {
  font-weight: 700;
  font-size: calc(13.5px * var(--bdg-font-scale, 1));
  display: flex;
  align-items: center;
  gap: 8px;
}
.plugin-ver {
  font-size: calc(10px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
  font-weight: 400;
}
.plugin-desc {
  font-size: calc(12px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plugin-err {
  font-size: calc(11px * var(--bdg-font-scale, 1));
  color: var(--bdg-danger);
}
.plugin-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.plugin-meta .badge {
  font-size: calc(9px * var(--bdg-font-scale, 1));
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--bdg-accent);
  background: rgb(var(--bdg-accent-rgb) / 0.12);
  border: 1px solid rgb(var(--bdg-accent-rgb) / 0.22);
  padding: 1px 6px;
  border-radius: 5px;
}
.plugin-dir {
  font-size: calc(10px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
  margin-top: 4px;
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plugin-sub {
  font-size: calc(11px * var(--bdg-font-scale, 1));
}
.plugin-meta .badge.warn {
  color: var(--bdg-amber);
  background: rgb(var(--bdg-amber-rgb) / 0.14);
  border-color: rgb(var(--bdg-amber-rgb) / 0.28);
}
.market-filters {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.market-cats {
  margin: 0 0 12px;
}
.market-cats .num {
  margin-left: 6px;
  opacity: 0.6;
  font-size: 0.9em;
}
.ttl-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: calc(12px * var(--bdg-font-scale, 1));
}
.ttl-chips {
  margin: 0;
}
.link-btn {
  border: none;
  background: transparent;
  color: var(--bdg-danger);
  font-size: calc(12px * var(--bdg-font-scale, 1));
  font-family: inherit;
  cursor: pointer;
  padding: 0;
}
.link-btn:hover {
  text-decoration: underline;
}
.progress-track {
  width: 120px;
  height: 4px;
  border-radius: 999px;
  background: rgb(var(--bdg-neutral) / 0.2);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: var(--bdg-accent);
  transition: width 0.15s ease;
}
.trust-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: var(--bdg-radius, 6px);
  background: rgb(var(--bdg-amber-rgb) / 0.1);
  border: 1px solid rgb(var(--bdg-amber-rgb) / 0.25);
  font-size: calc(11.5px * var(--bdg-font-scale, 1));
  line-height: 1.4;
}
.trust-box strong {
  color: var(--bdg-amber);
}
</style>
