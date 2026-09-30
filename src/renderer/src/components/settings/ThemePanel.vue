<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { Check, RotateCcw } from "@lucide/vue";
import {
  exportThemeCode,
  importThemeCode,
  patchSettings,
  previewThemeToken,
  resetThemeTokens,
  setThemePreset,
  setThemeToken,
  useSettingsStore,
} from "../../stores/settings";
import { toast } from "../../ui/toast";
import {
  THEME_PRESETS,
  isLightColor,
  resolveTheme,
  themeContrastIssues,
  type ThemeOverrides,
  type ThemeSpec,
} from "../../theme";
import { useSettingsRowsStore } from "./useSettingsRows";
import ThemePreview from "../ThemePreview.vue";
import ThemeAppearancePanel from "./ThemeAppearancePanel.vue";
import UiButton from "../ui/UiButton.vue";
import UiColorField from "../ui/UiColorField.vue";
import UiInput from "../ui/UiInput.vue";

const { t } = useI18n();
const settings = useSettingsStore();

const themeSpec = computed<ThemeSpec>(() =>
  resolveTheme(
    settings.settings.themePreset,
    settings.settings.themeOverrides as ThemeOverrides,
  ),
);
const themeOverrides = computed<ThemeOverrides>(
  () => settings.settings.themeOverrides as ThemeOverrides,
);
const themeGroups: Array<{ key: string; tokens: (keyof ThemeSpec)[] }> = [
  { key: "surfaces", tokens: ["bg", "panel", "raised", "sunken", "menu"] },
  { key: "text", tokens: ["text", "textDim", "neutral"] },
  { key: "brand", tokens: ["accent", "accent2", "danger", "amber", "bpm"] },
  {
    key: "timeline",
    tokens: [
      "laneBpmBg",
      "laneMarkerBg",
      "laneMarkerAlt",
      "markerDim",
      "bpmPointSelected",
    ],
  },
];

// Theme page sub-tabs (presets / custom colors, incl. share & import).
// The active sub-tab lives in the shared rows store so settings search can
// jump straight into "custom" / "appearance".
const { themeSub } = storeToRefs(useSettingsRowsStore());
const themeSubs = computed<
  Array<{ key: "preset" | "custom" | "appearance"; label: string }>
>(() => [
  { key: "preset", label: t("settings.theme.subs.preset") },
  { key: "custom", label: t("settings.theme.subs.custom") },
  { key: "appearance", label: t("settings.theme.subs.appearance") },
]);

const contrastIssues = computed(() => themeContrastIssues(themeSpec.value));

function onThemeToken(token: keyof ThemeSpec, value: string | null): void {
  setThemeToken(token, value ?? "");
}
function tokenOverridden(token: keyof ThemeSpec): boolean {
  return themeOverrides.value[token] != null;
}

/** Curated accents for the one-click swatch row (any color still works). */
const ACCENT_SWATCHES = [
  "#38bdf8",
  "#22d3ee",
  "#34d399",
  "#a3e635",
  "#fbbf24",
  "#fb923c",
  "#f43f5e",
  "#ec4899",
  "#a78bfa",
  "#6366f1",
  "#60a5fa",
  "#94a3b8",
];

/** Preset cards are grouped dark-first; this flags the light ones. */
function isLightPreset(spec: ThemeSpec): boolean {
  return isLightColor(spec.bg);
}

function groupOverridden(tokens: (keyof ThemeSpec)[]): boolean {
  return tokens.some((token) => themeOverrides.value[token] != null);
}

function resetThemeGroup(tokens: (keyof ThemeSpec)[]): void {
  const next = { ...themeOverrides.value };
  for (const token of tokens) delete next[token];
  void patchSettings({ themeOverrides: next });
}

// ---- shareable theme code (export / import) ----
const themeCode = ref("");

async function onExportTheme(): Promise<void> {
  const code = exportThemeCode();
  themeCode.value = code;
  try {
    await window.api.writeClipboard(code);
    toast.success(t("settings.theme.exportOk"));
  } catch {
    toast.error(t("settings.theme.exportFail"));
  }
}

function onImportTheme(): void {
  if (importThemeCode(themeCode.value))
    toast.success(t("settings.theme.importOk"));
  else toast.error(t("settings.theme.importFail"));
}
</script>

<template>
  <section class="theme-section">
    <h3>{{ t("settings.cats.theme") }}</h3>
    <nav class="subnav">
      <button
        v-for="s in themeSubs"
        :key="s.key"
        class="subnav-item"
        :class="{ active: themeSub === s.key }"
        @click="themeSub = s.key"
      >
        {{ s.label }}
      </button>
    </nav>

    <div class="theme-split">
      <div class="theme-main">
        <template v-if="themeSub === 'preset'">
          <div class="sub-head">{{ t("settings.theme.preset") }}</div>
          <div class="theme-presets">
            <button
              v-for="p in THEME_PRESETS"
              :key="p.id"
              class="theme-preset"
              :class="{ active: settings.settings.themePreset === p.id }"
              @click="setThemePreset(p.id)"
            >
              <ThemePreview
                :spec="p.spec"
                variant="card"
                class="theme-preset-preview"
              />
              <span class="theme-preset-meta">
                <span class="theme-preset-name">{{
                  t(`settings.theme.presets.${p.name}`)
                }}</span>
                <span
                  class="theme-preset-badge"
                  :class="isLightPreset(p.spec) ? 'light' : 'dark'"
                >
                  {{
                    isLightPreset(p.spec)
                      ? t("settings.theme.modeLight")
                      : t("settings.theme.modeDark")
                  }}
                </span>
              </span>
              <span
                v-if="settings.settings.themePreset === p.id"
                class="theme-preset-check"
              >
                <Check class="size-3" />
              </span>
            </button>
          </div>
        </template>

        <template v-else-if="themeSub === 'custom'">
          <div class="sub-head">{{ t("settings.theme.accentPick") }}</div>
          <div class="accent-pick">
            <button
              v-for="c in ACCENT_SWATCHES"
              :key="c"
              type="button"
              class="accent-swatch"
              :class="{ active: themeSpec.accent.toLowerCase() === c }"
              :style="{ background: c }"
              :title="c"
              :aria-label="c"
              @click="setThemeToken('accent', c)"
            />
            <UiColorField
              :model-value="themeSpec.accent"
              @update:model-value="
                (v: string) => previewThemeToken('accent', v)
              "
              @commit="(v: string) => setThemeToken('accent', v)"
            />
          </div>

          <div class="sub-head">{{ t("settings.theme.share") }}</div>
          <div class="theme-share">
            <UiButton size="sm" @click="onExportTheme()">
              {{ t("settings.theme.export") }}
            </UiButton>
            <div class="theme-code-wrap">
              <UiInput
                v-model="themeCode"
                size="sm"
                :placeholder="t('settings.theme.importPlaceholder')"
              />
            </div>
            <UiButton
              size="sm"
              variant="soft"
              :disabled="!themeCode.trim()"
              @click="onImportTheme()"
            >
              {{ t("settings.theme.importBtn") }}
            </UiButton>
          </div>

          <div class="sub-head theme-custom-head">
            <span>{{ t("settings.theme.custom") }}</span>
            <UiButton
              size="sm"
              :disabled="Object.keys(themeOverrides).length === 0"
              @click="resetThemeTokens()"
            >
              {{ t("settings.theme.reset") }}
            </UiButton>
          </div>
          <p class="muted theme-hint">{{ t("settings.theme.hint") }}</p>

          <div v-if="contrastIssues.length" class="contrast-warn">
            <div class="contrast-warn-title">
              {{ t("settings.theme.contrastTitle") }}
            </div>
            <ul class="contrast-warn-list">
              <li v-for="(i, idx) in contrastIssues" :key="idx">
                {{
                  t("settings.theme.contrastIssue", {
                    fg: t(`settings.theme.tokens.${i.fg}`),
                    bg: t(`settings.theme.tokens.${i.bg}`),
                    ratio: i.ratio.toFixed(2),
                  })
                }}
              </li>
            </ul>
          </div>

          <div v-for="g in themeGroups" :key="g.key" class="theme-card">
            <div class="theme-card-head">
              <span class="theme-card-title">{{
                t(`settings.theme.groups.${g.key}`)
              }}</span>
              <span class="theme-card-swatches">
                <i
                  v-for="tk in g.tokens.slice(0, 5)"
                  :key="tk"
                  :style="{ background: themeSpec[tk] }"
                />
              </span>
              <button
                class="theme-group-reset"
                :class="{ on: groupOverridden(g.tokens) }"
                :disabled="!groupOverridden(g.tokens)"
                :title="t('settings.theme.resetGroup')"
                :aria-label="t('settings.theme.resetGroup')"
                @click="resetThemeGroup(g.tokens)"
              >
                <RotateCcw class="size-3" />
              </button>
            </div>
            <div
              v-for="token in g.tokens"
              :key="token"
              class="field-row theme-row"
            >
              <div class="field-info">
                <span class="field-name">{{
                  t(`settings.theme.tokens.${token}`)
                }}</span>
              </div>
              <div class="theme-token-ctrl">
                <UiColorField
                  :model-value="themeSpec[token]"
                  @update:model-value="
                    (v: string) => previewThemeToken(token, v)
                  "
                  @commit="(v: string) => setThemeToken(token, v)"
                />
                <button
                  class="theme-token-reset"
                  :class="{ on: tokenOverridden(token) }"
                  :title="t('settings.theme.reset')"
                  :aria-label="t('settings.theme.reset')"
                  @click="onThemeToken(token, null)"
                >
                  ↺
                </button>
              </div>
            </div>
          </div>
        </template>

        <ThemeAppearancePanel v-else-if="themeSub === 'appearance'" />
      </div>

      <aside class="theme-preview">
        <div class="sub-head">{{ t("settings.theme.preview") }}</div>
        <ThemePreview :spec="themeSpec" variant="panel" />
        <p class="muted theme-hint">{{ t("settings.theme.previewHint") }}</p>
      </aside>
    </div>
  </section>
</template>

<style scoped>
/* Theme page: content column + sticky live-preview column. */
.theme-section {
  max-width: 940px;
}
.theme-split {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 20px;
}
.theme-main {
  flex: 2 1 380px;
  min-width: 0;
}
.theme-preview {
  flex: 1 1 220px;
  max-width: 320px;
  min-width: 0;
  position: sticky;
  top: 0;
}
.theme-presets {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px;
}
.theme-preset {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
  background: var(--bdg-bg-raised);
  border: 1px solid var(--bdg-border);
  color: var(--bdg-text);
  border-radius: var(--bdg-radius, 6px);
  padding: 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: var(--bdg-fs-12);
  transition:
    transform 0.16s ease,
    border-color 0.16s ease,
    box-shadow 0.16s ease;
}
.theme-preset:hover {
  border-color: var(--bdg-border-strong);
  transform: translateY(-2px);
  box-shadow: 0 8px 20px var(--bdg-shadow);
}
.theme-preset.active {
  border-color: var(--bdg-accent);
  background: rgb(var(--bdg-accent-rgb) / 0.12);
}
.theme-preset-preview {
  pointer-events: none;
}
.theme-preset-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 2px;
}
.theme-preset-name {
  font-weight: 600;
}
.theme-preset-badge {
  flex: none;
  font-size: var(--bdg-fs-10);
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--bdg-border);
  color: var(--bdg-text-dim);
}
.theme-preset-badge.light {
  background: rgb(255 255 255 / 0.12);
}
.theme-preset-badge.dark {
  background: rgb(0 0 0 / 0.22);
}
.theme-preset-check {
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--bdg-accent);
  color: var(--bdg-bg);
  box-shadow: 0 2px 6px var(--bdg-shadow);
}
.accent-pick {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.accent-swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid transparent;
  padding: 0;
  cursor: pointer;
  box-shadow: 0 0 0 1px var(--bdg-border-strong) inset;
  transition: transform 0.14s ease;
}
.accent-swatch:hover {
  transform: scale(1.14);
}
.accent-swatch.active {
  border-color: var(--bdg-text);
  box-shadow:
    0 0 0 1px var(--bdg-border-strong) inset,
    0 0 0 2px var(--bdg-accent);
}
.theme-share {
  display: flex;
  align-items: center;
  gap: 8px;
}
.theme-code-wrap {
  flex: 1 1 auto;
  min-width: 0;
}
.theme-custom-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.theme-hint {
  margin: 0 0 8px;
}
.contrast-warn {
  background: rgb(var(--bdg-amber-rgb) / 0.1);
  border: 1px solid rgb(var(--bdg-amber-rgb) / 0.32);
  border-radius: var(--bdg-radius, 6px);
  padding: 8px 10px;
  margin: 0 0 10px;
  font-size: var(--bdg-fs-12);
}
.contrast-warn-title {
  font-weight: 700;
  color: var(--bdg-amber);
  margin-bottom: 4px;
}
.contrast-warn-list {
  margin: 0;
  padding-left: 16px;
  color: var(--bdg-text-dim);
}
.contrast-warn-list li {
  margin: 2px 0;
}
.theme-card {
  border: 1px solid var(--bdg-border);
  border-radius: var(--bdg-radius, 6px);
  background: rgb(var(--bdg-neutral) / 0.04);
  padding: 2px 12px 6px;
  margin-bottom: 12px;
}
.theme-card-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0 6px;
  border-bottom: 1px solid var(--bdg-border);
}
.theme-card-title {
  font-size: var(--bdg-fs-12);
  font-weight: 700;
  color: var(--bdg-text);
  letter-spacing: 0.03em;
}
.theme-card-swatches {
  display: inline-flex;
  border-radius: var(--bdg-radius-sm);
  overflow: hidden;
  border: 1px solid var(--bdg-border-strong);
  margin-left: auto;
}
.theme-card-swatches i {
  width: 14px;
  height: 14px;
  display: block;
}
.theme-group-reset {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--bdg-border);
  border-radius: var(--bdg-radius-md);
  background: none;
  color: var(--bdg-text-dim);
  cursor: pointer;
  opacity: 0.4;
}
.theme-group-reset.on {
  opacity: 1;
  color: var(--bdg-accent);
  border-color: rgb(var(--bdg-accent-rgb) / 0.4);
}
.theme-group-reset:disabled {
  cursor: default;
}
.theme-row {
  padding: 8px 0;
}
.theme-token-ctrl {
  display: flex;
  align-items: center;
  gap: 6px;
}
.theme-token-reset {
  background: none;
  border: none;
  color: var(--bdg-text-dim);
  cursor: pointer;
  font-size: var(--bdg-fs-13);
  opacity: 0.25;
  padding: 0 2px;
}
.theme-token-reset.on {
  opacity: 1;
  color: var(--bdg-accent);
}
</style>
