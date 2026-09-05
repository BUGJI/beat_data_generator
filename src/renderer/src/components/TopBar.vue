<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  DocumentAdd,
  FolderOpened,
  Files,
  Download,
  Collection,
  Document,
  CopyDocument,
  RefreshLeft,
  RefreshRight,
  Remove,
  Select,
  ZoomIn,
  ZoomOut,
  FullScreen,
  Setting,
  CaretBottom,
  Grid,
} from "@element-plus/icons-vue";
import {
  actions as pluginActions,
  panels as pluginPanels,
  localeText,
  openPanel,
  closePanel,
  isPanelOpen,
} from "../plugins/registry";
import { pluginEntries, pluginName } from "../plugins/host";
import { newProject,
  openProject,
  saveProject,
  saveProjectQuick,
  exportTimestamps,
  exportEDL,
  store,
  zoomBy,
  fitZoom,
  setSettingsOpen,
  copyMarkerGroup,
  pasteMarkerGroup,
  removeSelectedMarkers,
  selectAllMarkers,
  undo,
  redo,
} from "../store";

const { t } = useI18n();

interface PluginMenuChild {
  kind: "action" | "panel";
  uid: number;
  label: string;
  open: boolean;
}

interface PluginMenuGroup {
  pluginId: string;
  name: string;
  children: PluginMenuChild[];
}

const pluginMenu = computed<PluginMenuGroup[]>(() => {
  const groups = new Map<string, PluginMenuGroup>();
  const nameOf = (pluginId: string): string => {
    const e = pluginEntries.find((x) => x.id === pluginId);
    return e ? pluginName(e) : pluginId;
  };
  const ensure = (pluginId: string): PluginMenuGroup => {
    let g = groups.get(pluginId);
    if (!g) {
      g = { pluginId, name: nameOf(pluginId), children: [] };
      groups.set(pluginId, g);
    }
    return g;
  };
  for (const a of pluginActions) {
    ensure(a.pluginId).children.push({
      kind: "action",
      uid: a.uid,
      label: localeText(a.def.label),
      open: false,
    });
  }
  for (const p of pluginPanels) {
    ensure(p.pluginId).children.push({
      kind: "panel",
      uid: p.uid,
      label: localeText(p.def.title),
      open: isPanelOpen(p.pluginId, p.uid),
    });
  }
  return [...groups.values()];
});

function onPluginItem(item: PluginMenuChild): void {
  if (item.kind === "action") {
    const a = pluginActions.find((x) => x.uid === item.uid);
    if (a) {
      try {
        const r = a.def.run();
        if (r && typeof (r as Promise<void>).then === "function") void r;
      } catch (err) {
        console.error("[plugins] action failed", err);
      }
    }
    return;
  }
  const p = pluginPanels.find((x) => x.uid === item.uid);
  if (!p) return;
  if (isPanelOpen(p.pluginId, p.uid)) closePanel(p.pluginId, p.uid);
  else openPanel(p.pluginId, p.uid);
}

function onPluginCmd(cmd: string): void {
  if (!cmd) return;
  const kind = cmd[0] === "a" ? "action" : "panel";
  const uid = Number(cmd.slice(1));
  if (!Number.isFinite(uid)) return;
  const item: PluginMenuChild | null =
    kind === "action"
      ? (pluginActions
          .filter((a) => a.uid === uid)
          .map((a) => ({
            kind: "action" as const,
            uid: a.uid,
            label: localeText(a.def.label),
            open: false,
          }))[0] ?? null)
      : (pluginPanels
          .filter((p) => p.uid === uid)
          .map((p) => ({
            kind: "panel" as const,
            uid: p.uid,
            label: localeText(p.def.title),
            open: isPanelOpen(p.pluginId, p.uid),
          }))[0] ?? null);
  if (item) onPluginItem(item);
}

const dirtyTitle = computed(() =>
  store.project.dirty ? ` • ${t("toolbar.unsavedDot")}` : "",
);

const recents = ref<Array<{ path: string; title: string }>>([]);

async function loadRecents(): Promise<void> {
  recents.value = await window.api.getRecents();
}

function onCmd(cmd: string): void {
  if (cmd.startsWith("recent-")) {
    const idx = Number(cmd.slice("recent-".length));
    const item = recents.value[idx];
    if (item) void openProject(item.path);
    return;
  }
  switch (cmd) {
    case "new":
      newProject();
      break;
    case "open-project":
      void openProject();
      break;
    case "save":
      void saveProjectQuick();
      break;
    case "save-as":
      void saveProject(true);
      break;
    case "undo":
      undo();
      break;
    case "redo":
      redo();
      break;
    case "copy":
      copyMarkerGroup();
      break;
    case "cut":
      if (copyMarkerGroup()) removeSelectedMarkers();
      break;
    case "paste":
      pasteMarkerGroup();
      break;
    case "select-all":
      selectAllMarkers();
      break;
    case "export":
      void exportTimestamps();
      break;
    case "export-edl":
      void exportEDL();
      break;
  }
}

function onFit(): void {
  fitZoom(window.innerWidth * 0.62);
}

const zoomInDisabled = computed(() => store.ui.pxPerSec >= 4000);
const zoomOutDisabled = computed(() => store.ui.pxPerSec <= 6);
onMounted(() => {
  void loadRecents();
});
</script>

<template>
  <header class="topbar">
    <el-dropdown
      trigger="click"
      @command="onCmd"
      @visible-change="(v: boolean) => v && loadRecents()"
    >
      <button class="menu-btn">
        <el-icon><DocumentAdd /></el-icon>{{ t("menu.file") }}
        <el-icon class="caret"><CaretBottom /></el-icon>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="new">
            <el-icon><DocumentAdd /></el-icon>{{ t("menu.new") }}
          </el-dropdown-item>
          <el-dropdown-item command="open-project">
            <el-icon><FolderOpened /></el-icon>{{ t("menu.openProject") }}
          </el-dropdown-item>
          <el-dropdown-item
            v-for="(r, i) in recents"
            :key="r.path"
            :command="`recent-${i}`"
            class="recent-item"
          >
            <el-icon><Files /></el-icon>
            <span class="recent-title" :title="r.path">{{ r.title }}</span>
          </el-dropdown-item>
          <el-dropdown-item command="save" divided>
            <el-icon><Document /></el-icon>{{ t("menu.saveProject") }}
          </el-dropdown-item>
          <el-dropdown-item command="save-as">
            <el-icon><CopyDocument /></el-icon>{{ t("menu.saveProjectAs") }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-dropdown trigger="click" @command="onCmd">
      <button class="menu-btn">
        <el-icon><CopyDocument /></el-icon>{{ t("menu.edit") }}
        <el-icon class="caret"><CaretBottom /></el-icon>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="undo">
            <el-icon><RefreshLeft /></el-icon>{{ t("menu.undo") }}
          </el-dropdown-item>
          <el-dropdown-item command="redo">
            <el-icon><RefreshRight /></el-icon>{{ t("menu.redo") }}
          </el-dropdown-item>
          <el-dropdown-item command="cut" divided>
            <el-icon><Remove /></el-icon>{{ t("menu.cut") }}
          </el-dropdown-item>
          <el-dropdown-item command="copy">
            <el-icon><CopyDocument /></el-icon>{{ t("menu.copy") }}
          </el-dropdown-item>
          <el-dropdown-item command="paste">
            <el-icon><Files /></el-icon>{{ t("menu.paste") }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-dropdown trigger="click" @command="onCmd">
      <button class="menu-btn">
        <el-icon><Select /></el-icon>{{ t("menu.select") }}
        <el-icon class="caret"><CaretBottom /></el-icon>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="select-all">
            <el-icon><Select /></el-icon>{{ t("menu.selectAll") }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-dropdown
      v-if="pluginMenu.length"
      trigger="click"
      @command="onPluginCmd"
    >
      <button class="menu-btn">
        <el-icon><Grid /></el-icon>{{ t("menu.plugins") }}
        <el-icon class="caret"><CaretBottom /></el-icon>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <template v-for="g in pluginMenu" :key="g.pluginId">
            <el-dropdown-item disabled class="plug-head">
              {{ g.name }}
            </el-dropdown-item>
            <el-dropdown-item
              v-for="ch in g.children"
              :key="`${g.pluginId}-${ch.uid}`"
              :command="(ch.kind === 'action' ? 'a' : 'p') + ch.uid"
              :class="{ 'plug-open': ch.kind === 'panel' && ch.open }"
            >
              <span v-if="ch.kind === 'panel'" class="plug-check"
                >{{ ch.open ? "●" : "○" }}</span
              >
              <span v-else class="plug-check">▸</span>
              <span class="plug-label">{{ ch.label }}</span>
            </el-dropdown-item>
          </template>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-dropdown trigger="click" @command="onCmd">
      <button class="menu-btn">
        <el-icon><Download /></el-icon>{{ t("menu.exportMenu") }}
        <el-icon class="caret"><CaretBottom /></el-icon>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="export">
            <el-icon><Download /></el-icon>{{ t("menu.export") }}
          </el-dropdown-item>
          <el-dropdown-item command="export-edl">
            <el-icon><Collection /></el-icon>{{ t("menu.exportEdl") }}
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <span
      v-if="dirtyTitle"
      class="top-dirty"
      :title="t('toolbar.unsavedDot')"
      >●</span
    >

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

    <el-tooltip :content="t('settings.title')" placement="bottom">
      <el-button class="help-btn" size="small" text @click="setSettingsOpen(true)">
        <el-icon><Setting /></el-icon>
      </el-button>
    </el-tooltip>
  </header>
</template>

<style scoped>
.topbar {
  height: var(--bdg-toolbar-h);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  background: linear-gradient(180deg, #1a1f27, #161a21);
  border-bottom: 1px solid var(--bdg-border);
  flex: none;
}
.top-dirty {
  color: #fbbf24;
  font-size: 10px;
  line-height: 1;
  cursor: default;
}
.menu-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  color: var(--bdg-text);
  border: none;
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12.5px;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}
.menu-btn:hover {
  background: rgba(148, 163, 184, 0.12);
}
.caret {
  font-size: 9px;
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
.recent-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.plug-head {
  opacity: 0.55;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  cursor: default;
}
.plug-check {
  display: inline-flex;
  width: 14px;
  font-size: 9px;
  color: var(--bdg-accent);
}
.plug-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}
.plug-open {
  color: var(--bdg-accent);
}
.recent-title {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
