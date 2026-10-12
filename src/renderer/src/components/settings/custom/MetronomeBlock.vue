<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Check, Play } from "@lucide/vue";
import { loadMetronome, previewMetronome } from "@renderer/services/audioIO";
import { patchSettings, useSettingsStore } from "@renderer/stores/settings";
import UiButton from "../../ui/UiButton.vue";
import UiSlider from "../../ui/UiSlider.vue";
import UiSwitch from "../../ui/UiSwitch.vue";
import type { MetronomeFile } from "@shared/ipc";

const { t } = useI18n();
const settings = useSettingsStore();

const metronomeFiles = ref<MetronomeFile[]>([]);
const metronomeLoading = ref(false);

const metronomePath = computed(() => settings.settings.metronomePath);
const metronomeFollowMaster = computed({
  get: () => settings.settings.metronomeFollowMaster,
  set: (v: boolean) => void patchSettings({ metronomeFollowMaster: v }),
});
const metronomeVolume = computed({
  get: () => settings.settings.metronomeVolume,
  set: (v: number) => void patchSettings({ metronomeVolume: v }),
});

async function refreshMetronomeFiles(): Promise<void> {
  metronomeLoading.value = true;
  try {
    metronomeFiles.value = await window.api.listMetronomes();
  } catch {
    metronomeFiles.value = [];
  } finally {
    metronomeLoading.value = false;
  }
}

async function openMetronomeFolder(): Promise<void> {
  await window.api.openMetronomeFolder();
  await refreshMetronomeFiles();
}

async function selectMetronome(file: string): Promise<void> {
  await loadMetronome(file);
  void patchSettings({ metronomePath: file });
  // clicking a sound previews it once (the "none" option just clears)
  if (file) previewMetronome();
}

/** Audition a file without changing which sound is selected. */
async function previewMetronomeFile(file: string): Promise<void> {
  await loadMetronome(file);
  previewMetronome();
  // restore the selected sound so the preview doesn't become the active one
  if (metronomePath.value !== file) await loadMetronome(metronomePath.value);
}

onMounted(refreshMetronomeFiles);
</script>

<template>
  <div class="metronome-block">
    <div class="field-info">
      <span class="field-name">{{ t("settings.audio.metronome") }}</span>
      <span class="field-desc">{{ t("settings.audio.metronomeDesc") }}</span>
    </div>
    <div class="metronome-actions">
      <UiButton size="sm" @click="openMetronomeFolder()">
        {{ t("settings.audio.metronomeOpenFolder") }}
      </UiButton>
      <UiButton
        size="sm"
        variant="soft"
        :loading="metronomeLoading"
        @click="refreshMetronomeFiles()"
      >
        {{ t("settings.audio.metronomeRefresh") }}
      </UiButton>
    </div>
    <div class="metronome-list">
      <div class="metronome-chip">
        <button
          type="button"
          class="metronome-item"
          :class="{ active: !metronomePath }"
          :data-search="t('settings.audio.metronomeNone')"
          @click="selectMetronome('')"
        >
          {{ t("settings.audio.metronomeNone") }}
        </button>
      </div>
      <div v-for="f in metronomeFiles" :key="f.file" class="metronome-chip">
        <button
          type="button"
          class="metronome-item"
          :class="{ active: metronomePath === f.file }"
          :data-search="f.name"
          @click="selectMetronome(f.file)"
        >
          <span class="metronome-name">{{ f.name }}</span>
          <Check v-if="metronomePath === f.file" class="metronome-check" />
        </button>
        <button
          type="button"
          class="metronome-play"
          :title="t('settings.audio.metronomePreview')"
          :aria-label="t('settings.audio.metronomePreview')"
          @click="previewMetronomeFile(f.file)"
        >
          <Play class="size-3.5" />
        </button>
      </div>
      <p v-if="metronomeFiles.length === 0" class="muted metronome-empty">
        {{ t("settings.audio.metronomeEmpty") }}
      </p>
    </div>
    <div class="metronome-volume">
      <label class="metronome-follow">
        <UiSwitch
          :model-value="metronomeFollowMaster"
          :aria-label="t('settings.audio.metronomeFollowMaster')"
          @update:model-value="(v: boolean) => (metronomeFollowMaster = v)"
        />
        <span>{{ t("settings.audio.metronomeFollowMaster") }}</span>
      </label>
      <div v-if="!metronomeFollowMaster" class="pct-row">
        <UiSlider
          :model-value="metronomeVolume"
          :min="0"
          :max="100"
          :label="t('settings.audio.metronomeVolume')"
          class="pct-slider"
          @update:model-value="(v: number) => (metronomeVolume = v)"
        />
        <span class="num pct-value">{{ metronomeVolume }}%</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.metronome-block {
  padding: 12px 0;
  border-bottom: 1px solid var(--bdg-border);
}
.metronome-actions {
  display: flex;
  gap: 8px;
  margin: 10px 0;
}
.metronome-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.metronome-chip {
  display: inline-flex;
  align-items: stretch;
  max-width: 100%;
}
.metronome-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--bdg-border);
  background: transparent;
  color: var(--bdg-text);
  padding: 5px 12px;
  border-radius: var(--bdg-radius, 6px);
  font-size: var(--bdg-fs-12);
  font-family: inherit;
  cursor: pointer;
  max-width: 100%;
}
.metronome-chip .metronome-item {
  border-radius: var(--bdg-radius, 6px) 0 0 var(--bdg-radius, 6px);
}
/* The "none" chip has no preview button, so it keeps a full-radius chip. */
.metronome-chip .metronome-item:only-child {
  border-radius: var(--bdg-radius, 6px);
}
.metronome-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.metronome-check {
  flex: none;
  width: 13px;
  height: 13px;
}
.metronome-play {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  border: 1px solid var(--bdg-border);
  border-left: none;
  border-radius: 0 var(--bdg-radius, 6px) var(--bdg-radius, 6px) 0;
  background: transparent;
  color: var(--bdg-text-dim);
  cursor: pointer;
}
.metronome-play:hover {
  color: var(--bdg-text);
  background: rgb(var(--bdg-neutral) / 0.12);
}
.metronome-item:hover {
  background: rgb(var(--bdg-neutral) / 0.1);
}
.metronome-item.active {
  background: rgb(var(--bdg-accent-rgb) / 0.16);
  border-color: transparent;
  color: var(--bdg-accent);
  font-weight: 600;
}
.metronome-empty {
  margin: 4px 0 0;
  font-size: var(--bdg-fs-12);
}
.metronome-volume {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}
.metronome-follow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--bdg-fs-12);
  color: var(--bdg-text-dim);
  cursor: pointer;
}
</style>
