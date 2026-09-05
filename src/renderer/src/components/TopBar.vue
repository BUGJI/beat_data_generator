<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessageBox } from "element-plus";
import {
  DocumentAdd,
  Headset,
  FolderOpened,
  Download,
  ZoomIn,
  ZoomOut,
  FullScreen,
  QuestionFilled,
  CaretBottom,
} from "@element-plus/icons-vue";
import { setLocale, LOCALES } from "../i18n";
import {
  newProject,
  openAudioDialog,
  openProject,
  saveProject,
  exportTimestamps,
  store,
  zoomBy,
  fitZoom,
} from "../store";

const { t, locale } = useI18n();

const dirtyTitle = computed(() =>
  store.project.dirty ? ` • ${t('toolbar.unsavedDot')}` : "",
);

function onFileCmd(cmd: string): void {
  switch (cmd) {
    case "new":
      newProject();
      break;
    case "open-audio":
      void openAudioDialog();
      break;
    case "open-project":
      void openProject();
      break;
    case "save":
      void saveProject(false);
      break;
    case "save-as":
      void saveProject(true);
      break;
    case "export":
      void exportTimestamps();
      break;
  }
}

function onFit(): void {
  fitZoom(window.innerWidth * 0.62);
}

function onAbout(): void {
  void ElMessageBox.alert(
    `${t('app.name')} v0.2.0\n\n${t('app.hint')}`,
    t('menu.about'),
    {
      confirmButtonText: t('dialogs.ok'),
      customStyle: { whiteSpace: "pre-line" },
    },
  );
}

const zoomInDisabled = computed(() => store.ui.pxPerSec >= 4000);
const zoomOutDisabled = computed(() => store.ui.pxPerSec <= 6);
const pxLabel = computed(() => `${store.ui.pxPerSec.toFixed(1)} px/s`);
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="brand-dot" />
      <span class="brand-name">{{ t('app.name') }}</span>
      <span class="brand-sub num" :title="pxLabel">{{ pxLabel }}</span>
      <span
        v-if="dirtyTitle"
        class="brand-sub dirty"
        :title="t('toolbar.unsavedDot')"
        >●</span
      >
    </div>

    <el-dropdown trigger="click" @command="onFileCmd">
      <button class="menu-btn">
        <el-icon><DocumentAdd /></el-icon>{{ t('menu.file') }}
        <el-icon class="caret"><CaretBottom /></el-icon>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="new">{{ t('menu.new') }}</el-dropdown-item>
          <el-dropdown-item command="open-audio" divided>
            <el-icon><Headset /></el-icon>{{ t('menu.openAudio') }}
          </el-dropdown-item>
          <el-dropdown-item command="open-project">
            <el-icon><FolderOpened /></el-icon>{{ t('menu.openProject') }}
          </el-dropdown-item>
          <el-dropdown-item command="save" divided>{{
            t('menu.saveProject')
          }}</el-dropdown-item>
          <el-dropdown-item command="save-as">{{
            t('menu.saveProjectAs')
          }}</el-dropdown-item>
          <el-dropdown-item command="export" divided>
            <el-icon><Download /></el-icon>{{ t('menu.export') }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <div class="grow" />

    <div class="zoom-group">
      <el-tooltip :content="t('menu.zoomOut')" placement="bottom">
        <el-button
          size="small"
          text
          :disabled="zoomOutDisabled"
          @click="zoomBy(1 / 1.3)"
        >
          <el-icon><ZoomOut /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip :content="t('menu.zoomIn')" placement="bottom">
        <el-button
          size="small"
          text
          :disabled="zoomInDisabled"
          @click="zoomBy(1.3)"
        >
          <el-icon><ZoomIn /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip :content="t('menu.zoomFit')" placement="bottom">
        <el-button size="small" text @click="onFit">
          <el-icon><FullScreen /></el-icon>
        </el-button>
      </el-tooltip>
    </div>

    <el-dropdown
      trigger="click"
      @command="(cmd: string) => setLocale(cmd as 'zh' | 'en')"
    >
      <button class="menu-btn">
        {{ LOCALES.find((l) => l.value === locale)?.label ?? "中文" }}
        <el-icon class="caret"><CaretBottom /></el-icon>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item
            v-for="l in LOCALES"
            :key="l.value"
            :command="l.value"
            :disabled="l.value === locale"
          >
            {{ l.label }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-button class="help-btn" size="small" text @click="onAbout">
      <el-icon><QuestionFilled /></el-icon>
    </el-button>
  </header>
</template>

<style scoped>
.topbar {
  height: var(--bdg-toolbar-h);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  background: linear-gradient(180deg, #1a1f27, #161a21);
  border-bottom: 1px solid var(--bdg-border);
  flex: none;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 14px;
  margin-right: 4px;
  border-right: 1px solid var(--bdg-border);
}
.brand-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--bdg-accent), var(--bdg-accent-2));
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.6);
}
.brand-name {
  font-weight: 700;
  letter-spacing: 0.2px;
}
.brand-sub {
  color: var(--bdg-text-dim);
  font-size: 11px;
}
.brand-sub.dirty {
  color: #fbbf24;
  font-size: 9px;
}
.menu-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  color: var(--bdg-text);
  border: none;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
.menu-btn:hover {
  background: rgba(148, 163, 184, 0.12);
}
.caret {
  font-size: 10px;
}
.grow {
  flex: 1;
}
.zoom-group {
  display: flex;
  align-items: center;
  background: rgba(148, 163, 184, 0.06);
  border-radius: 8px;
  padding: 0 2px;
}
.help-btn {
  margin-left: 2px;
}
</style>
