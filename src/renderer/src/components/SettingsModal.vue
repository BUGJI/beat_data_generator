<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { store, setSettingsOpen, patchSettings, openDevTools } from "../store";
import { setLocale, LOCALES } from "../i18n";
import {
  pluginEntries,
  pluginName,
  pluginDescription,
  setPluginEnabled,
  reloadPlugins,
  refreshPlugins,
} from "../plugins/host";
import type { PluginEntry } from "../../../shared/plugin";
import type { CloseMode } from "../../../shared/ipc";

const { t, locale } = useI18n();
const pv =
  typeof process !== "undefined" && process.versions
    ? process.versions
    : null;
const runtime = Object.freeze({
  node: pv?.node ?? "--",
  chrome: pv?.chrome ?? "--",
  electron: pv?.electron ?? "--",
});
const cat = ref<
  "general" | "shortcuts" | "anim" | "plugins" | "dev" | "about"
>("general");

type CatKey = "general" | "shortcuts" | "anim" | "plugins" | "dev" | "about";

const cats: Array<{ key: CatKey; icon: string }> = [
  { key: "general", icon: "⚙" },
  { key: "shortcuts", icon: "⌨" },
  { key: "anim", icon: "✺" },
  { key: "plugins", icon: "▤" },
  { key: "dev", icon: "⬢" },
  { key: "about", icon: "ⓘ" },
];

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

watch(
  () => store.ui.settingsOpen,
  (open) => {
    if (open) void refreshPlugins();
  },
);

const closeMode = computed<CloseMode>({
  get: () => store.ui.settings.closeMode,
  set: (v: CloseMode) => {
    void patchSettings({ closeMode: v });
  },
});

const devEnabled = computed({
  get: () => store.ui.settings.devEnabled,
  set: (v: boolean) => {
    void patchSettings({ devEnabled: v });
  },
});

const devFreeInput = computed({
  get: () => store.ui.settings.devFreeInput,
  set: (v: boolean) => {
    void patchSettings({ devFreeInput: v });
  },
});

const language = computed<string>({
  get: () => locale.value,
  set: (v: string) => {
    setLocale(v === "en" ? "en" : "zh");
  },
});

const animEnabled = computed({
  get: () => store.ui.settings.animEnabled,
  set: (v: boolean) => {
    void patchSettings({ animEnabled: v });
  },
});

const followScroll = computed({
  get: () => store.ui.settings.followScroll,
  set: (v: boolean) => {
    void patchSettings({ followScroll: v });
  },
});
const followPercent = computed({
  get: () => store.ui.settings.followPercent,
  set: (v: number) => {
    void patchSettings({ followPercent: v });
  },
});
const rememberWindow = computed({
  get: () => store.ui.settings.rememberWindow,
  set: (v: boolean) => {
    void patchSettings({ rememberWindow: v });
  },
});
const autoSave = computed({
  get: () => store.ui.settings.autoSave,
  set: (v: boolean) => {
    void patchSettings({ autoSave: v });
  },
});
const autoSaveMinutes = computed({
  get: () => store.ui.settings.autoSaveMinutes,
  set: (v: number) => {
    void patchSettings({ autoSaveMinutes: v });
  },
});

const shortcutRows = computed(() => [
  { label: t("settings.shortcuts.save"), keys: ["Ctrl", "S"] },
  { label: t("settings.shortcuts.copy"), keys: ["Ctrl", "C"] },
  { label: t("settings.shortcuts.paste"), keys: ["Ctrl", "V"] },
  { label: t("settings.shortcuts.undo"), keys: ["Ctrl", "Z"] },
  {
    label: t("settings.shortcuts.redo"),
    keys: ["Ctrl", "Y", "/", "Ctrl+Shift+Z"],
  },
  { label: t("settings.shortcuts.playPause"), keys: ["Space"] },
  { label: t("settings.shortcuts.deleteSel"), keys: ["Delete", "Backspace"] },
  { label: t("settings.shortcuts.nudge"), keys: ["←", "→"] },
  { label: t("settings.shortcuts.esc"), keys: ["Esc"] },
  { label: t("settings.shortcuts.home"), keys: ["Home"] },
  { label: t("settings.shortcuts.zoom"), keys: ["Ctrl", "滚轮 / Scroll"] },
  { label: t("settings.shortcuts.pan"), keys: ["滚轮 / Shift+Scroll"] },
]);

const devOpenBusy = ref(false);
async function onOpenDevTools(): Promise<void> {
  if (!store.ui.settings.devEnabled) return;
  devOpenBusy.value = true;
  await openDevTools();
  setTimeout(() => {
    devOpenBusy.value = false;
  }, 200);
}

function catLabel(key: string): string {
  return t(`settings.cats.${key}`);
}
</script>

<template>
  <teleport to="body">
    <div
      v-if="store.ui.settingsOpen"
      class="mask"
      @click.self="setSettingsOpen(false)"
    >
      <div class="panel">
        <header class="head">
          <span class="title">{{ t("settings.title") }}</span>
          <button class="close-x" @click="setSettingsOpen(false)">✕</button>
        </header>

        <div class="body">
          <nav class="nav">
            <button
              v-for="c in cats"
              :key="c.key"
              class="nav-item"
              :class="{ active: cat === c.key }"
              @click="cat = c.key"
            >
              <span class="nav-icon">{{ c.icon }}</span>
              {{ catLabel(c.key) }}
            </button>
          </nav>

          <main class="content">
            <!-- 常规 -->
            <section v-if="cat === 'general'">
              <h3>{{ t("settings.cats.general") }}</h3>
              <div class="field-row">
                <div class="field-info">
                  <span class="field-name">{{
                    t("settings.general.language")
                  }}</span>
                  <span class="field-desc">{{
                    t("settings.general.languageDesc")
                  }}</span>
                </div>
                <el-radio-group v-model="language">
                  <el-radio-button
                    v-for="l in LOCALES"
                    :key="l.value"
                    :value="l.value"
                    >{{ l.label }}</el-radio-button
                  >
                </el-radio-group>
              </div>

              <div class="field-row">
                <div class="field-info">
                  <span class="field-name">{{
                    t("settings.general.closeMode")
                  }}</span>
                  <span class="field-desc">{{
                    t("settings.general.closeModeDesc")
                  }}</span>
                </div>
                <el-radio-group v-model="closeMode" class="mode-group">
                  <el-radio-button value="ask">{{
                    t("settings.general.modeAsk")
                  }}</el-radio-button>
                  <el-radio-button value="minimize">{{
                    t("settings.general.modeMinimize")
                  }}</el-radio-button>
                  <el-radio-button value="close">{{
                    t("settings.general.modeClose")
                  }}</el-radio-button>
                </el-radio-group>
              </div>

              <div class="field-row">
                <div class="field-info">
                  <span class="field-name">{{
                    t("settings.general.autoFollow")
                  }}</span>
                  <span class="field-desc">{{
                    t("settings.general.autoFollowDesc")
                  }}</span>
                </div>
                <el-switch v-model="followScroll" size="small" />
              </div>

              <div v-if="followScroll" class="field-row col">
                <div class="field-info">
                  <span class="field-name">{{
                    t("settings.general.followPercent")
                  }}</span>
                  <span class="field-desc">{{
                    t("settings.general.followPercentDesc")
                  }}</span>
                </div>
                <div class="pct-row">
                  <el-slider
                    v-model="followPercent"
                    :min="0"
                    :max="100"
                    class="pct-slider"
                  />
                  <span class="num pct-value">{{ followPercent }}%</span>
                </div>
              </div>

              <div class="field-row">
                <div class="field-info">
                  <span class="field-name">{{
                    t("settings.general.rememberWindow")
                  }}</span>
                  <span class="field-desc">{{
                    t("settings.general.rememberWindowDesc")
                  }}</span>
                </div>
                <el-switch v-model="rememberWindow" size="small" />
              </div>

              <div class="field-row">
                <div class="field-info">
                  <span class="field-name">{{
                    t("settings.general.autoSave")
                  }}</span>
                  <span class="field-desc">{{
                    t("settings.general.autoSaveDesc")
                  }}</span>
                </div>
                <el-switch v-model="autoSave" size="small" />
              </div>

              <div v-if="autoSave" class="field-row col">
                <div class="field-info">
                  <span class="field-name">{{
                    t("settings.general.autoSaveMinutes")
                  }}</span>
                </div>
                <div class="pct-row">
                  <el-input-number
                    v-model="autoSaveMinutes"
                    :min="1"
                    :max="60"
                    :step="1"
                    size="small"
                    class="num minutes-input"
                  />
                  <span class="muted">{{
                    t("settings.general.autoSaveMinutesUnit")
                  }}</span>
                </div>
              </div>
            </section>

            <!-- 快捷键 -->
            <section v-if="cat === 'shortcuts'">
              <h3>{{ t("settings.cats.shortcuts") }}</h3>
              <p class="muted">{{ t("settings.shortcuts.note") }}</p>
              <table class="keys-table">
                <tbody>
                  <tr v-for="(row, i) in shortcutRows" :key="i">
                    <td class="act">{{ row.label }}</td>
                    <td class="keys">
                      <span v-for="(k, j) in row.keys" :key="j" class="kbd">{{
                        k
                      }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>

            <!-- 动画 -->
            <section v-if="cat === 'anim'">
              <h3>{{ t("settings.cats.anim") }}</h3>
              <div class="field-row">
                <div class="field-info">
                  <span class="field-name">{{
                    t("settings.anim.editor")
                  }}</span>
                  <span class="field-desc">{{
                    t("settings.anim.editorDesc")
                  }}</span>
                </div>
                <el-switch v-model="animEnabled" size="small" />
              </div>
            </section>

            <!-- 插件 -->
            <section v-if="cat === 'plugins'">
              <h3>{{ t("settings.plugins.title") }}</h3>
              <div class="plugin-tools">
                <el-button
                  size="small"
                  :loading="pluginsLoading"
                  @click="onReloadPlugins()"
                >
                  {{ t("settings.plugins.reload") }}
                </el-button>
                <el-button size="small" @click="onOpenPluginsFolder()">
                  {{ t("settings.plugins.openFolder") }}
                </el-button>
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
                    <el-switch
                      size="small"
                      :model-value="entry.enabled"
                      :loading="pluginBusy === entry.id"
                      @change="(v: boolean | string | number) => {
                        if (typeof v === 'boolean') {
                          void onTogglePlugin(entry);
                        }
                      }"
                    />
                  </div>
                </div>
                <div class="plugin-dir num">{{ entry.dir }}</div>
              </div>
            </section>

            <!-- 开发者 -->
            <section v-if="cat === 'dev'">
              <h3>{{ t("settings.cats.dev") }}</h3>
              <div class="field-row">
                <div class="field-info">
                  <span class="field-name">{{ t("settings.dev.master") }}</span>
                  <span class="field-desc">{{
                    t("settings.dev.masterDesc")
                  }}</span>
                </div>
                <el-switch v-model="devEnabled" size="small" />
              </div>

              <div class="field-row">
                <div class="field-info">
                  <span class="field-name">{{
                    t("settings.dev.freeInput")
                  }}</span>
                  <span class="field-desc">{{
                    t("settings.dev.freeInputDesc")
                  }}</span>
                </div>
                <el-switch
                  v-model="devFreeInput"
                  size="small"
                  :disabled="!devEnabled"
                />
              </div>

              <div class="dev-block" :class="{ off: !devEnabled }">
                <el-button
                  type="primary"
                  :disabled="!devEnabled"
                  :loading="devOpenBusy"
                  @click="onOpenDevTools()"
                >
                  {{ t("settings.dev.openTools") }}
                </el-button>
                <p class="muted">{{ t("settings.dev.openToolsDesc") }}</p>
              </div>
            </section>

            <!-- 关于 -->
            <section v-if="cat === 'about'">
              <h3>{{ t("settings.cats.about") }}</h3>
              <div class="about-card">
                <div class="about-logo">◈</div>
                <div>
                  <div class="about-name">{{ t("app.name") }}</div>
                  <div class="muted">{{ t("app.hint") }}</div>
                </div>
              </div>
              <dl class="about-meta">
                <dt>{{ t("settings.about.version") }}</dt>
                <dd>v0.1.0</dd>
                <dt>{{ t("settings.about.author") }}</dt>
                <dd>BUGJI</dd>
                <dt>{{ t("settings.about.tech") }}</dt>
                <dd>Electron · Vue 3 · TypeScript · Element Plus</dd>
                <dt>{{ t("settings.about.license") }}</dt>
                <dd>GNU GPL v3</dd>
                <dt>{{ t("settings.about.runtime") }}</dt>
                <dd>
                  Node.js {{ runtime.node }} · Chromium {{ runtime.chrome }} ·
                  Electron {{ runtime.electron }}
                </dd>
              </dl>
            </section>
          </main>
        </div>

        <footer class="foot">
          <span class="autosave">{{ t("settings.autoSave") }}</span>
          <el-button
            type="primary"
            size="small"
            @click="setSettingsOpen(false)"
          >
            {{ t("settings.done") }}
          </el-button>
        </footer>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(6, 8, 12, 0.6);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.panel {
  width: min(680px, 92vw);
  height: min(520px, 86vh);
  background: #171c24;
  border: 1px solid var(--bdg-border-strong);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}
.head {
  flex: none;
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--bdg-border);
}
.title {
  font-weight: 700;
}
.close-x {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--bdg-text-dim);
  cursor: pointer;
  font-size: 13px;
}
.close-x:hover {
  color: var(--bdg-text);
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.nav {
  flex: none;
  width: 168px;
  border-right: 1px solid var(--bdg-border);
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  color: var(--bdg-text);
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  font-family: inherit;
}
.nav-item:hover {
  background: rgba(148, 163, 184, 0.1);
}
.nav-item.active {
  background: rgba(56, 189, 248, 0.16);
  color: var(--bdg-accent);
  font-weight: 600;
}
.nav-icon {
  width: 16px;
  text-align: center;
  opacity: 0.9;
}
.content {
  flex: 1;
  overflow: auto;
  padding: 18px 22px;
}
.content h3 {
  margin: 0 0 14px;
  font-size: 15px;
}
.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 12px 0;
  border-bottom: 1px solid var(--bdg-border);
}
.field-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.field-name {
  font-weight: 600;
}
.field-desc,
.muted {
  font-size: 12px;
  color: var(--bdg-text-dim);
  margin: 0;
}
.dev-block {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.mode-group .el-radio-button {
  margin-right: 6px;
}
.keys-table {
  width: 100%;
  border-collapse: collapse;
}
.keys-table td {
  padding: 7px 4px;
  border-bottom: 1px solid var(--bdg-border);
  font-size: 13px;
}
.act {
  color: var(--bdg-text-dim);
}
.keys {
  text-align: right;
}
.kbd {
  display: inline-block;
  background: rgba(148, 163, 184, 0.12);
  border: 1px solid var(--bdg-border-strong);
  border-bottom-width: 2px;
  border-radius: 5px;
  padding: 1px 8px;
  margin-left: 6px;
  font-family: "Consolas", monospace;
  font-size: 11px;
}
.about-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  background: rgba(56, 189, 248, 0.07);
  border: 1px solid rgba(56, 189, 248, 0.18);
  border-radius: 10px;
}
.about-logo {
  font-size: 34px;
  color: var(--bdg-accent);
}
.about-name {
  font-size: 16px;
  font-weight: 800;
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
  font-size: 12px;
}
.foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-top: 1px solid var(--bdg-border);
}
.autosave {
  font-size: 11px;
  color: var(--bdg-text-dim);
}
.plugin-tools {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}
.plugin-empty {
  color: var(--bdg-text-dim);
  font-size: 13px;
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
  font-size: 13.5px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.plugin-ver {
  font-size: 10px;
  color: var(--bdg-text-dim);
  font-weight: 400;
}
.plugin-desc {
  font-size: 12px;
  color: var(--bdg-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plugin-err {
  font-size: 11px;
  color: var(--bdg-danger);
}
.plugin-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
}
.plugin-meta .badge {
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--bdg-accent);
  background: rgba(56, 189, 248, 0.12);
  border: 1px solid rgba(56, 189, 248, 0.22);
  padding: 1px 6px;
  border-radius: 5px;
}
.plugin-dir {
  font-size: 10px;
  color: var(--bdg-text-dim);
  margin-top: 4px;
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dev-block.off {
  opacity: 0.5;
}
.field-row.col {
  flex-direction: column;
  align-items: stretch;
}
.pct-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.pct-slider {
  flex: 1 1 0%;
  min-width: 0;
  --el-slider-main-bg-color: var(--bdg-accent);
  --el-slider-runway-bg-color: rgba(148, 163, 184, 0.2);
}
.pct-value {
  font-size: 12px;
  min-width: 34px;
  text-align: right;
  color: var(--bdg-accent);
}
</style>
