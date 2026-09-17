<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  Activity,
  ChevronDown,
  Copy,
  Download,
  FilePlus,
  FileText,
  Files,
  FolderOpen,
  LayoutGrid,
  LibraryBig,
  Maximize,
  Redo2,
  Scissors,
  Settings,
  SquareDashedMousePointer,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "@lucide/vue";
import {
  actions as pluginActions,
  panels as pluginPanels,
  importers as pluginImporters,
  exporters as pluginExporters,
  localeText,
  openPanel,
  closePanel,
  isPanelOpen,
} from "../plugins/registry";
import { pluginEntries, pluginName } from "../plugins/host";
import {
  newProject,
  openProject,
  saveProject,
  saveProjectQuick,
  exportTimestamps,
  exportEDL,
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
import { useProjectStore } from "../stores/project";
import { useViewStore } from "../stores/view";
import { useSettingsStore } from "../stores/settings";
import { useUiStore } from "../stores/ui";
import UiButton from "./ui/UiButton.vue";
import UiDropdownItem from "./ui/UiDropdownItem.vue";
import UiDropdownLabel from "./ui/UiDropdownLabel.vue";
import UiDropdownMenu from "./ui/UiDropdownMenu.vue";
import UiDropdownSeparator from "./ui/UiDropdownSeparator.vue";
import UiTooltip from "./ui/UiTooltip.vue";

const { t } = useI18n();
const project = useProjectStore();
const view = useViewStore();
const settings = useSettingsStore();
const ui = useUiStore();

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

function runPluginDef(
  run: () => void | Promise<void>,
  labelForErr?: string,
): void {
  try {
    const r = run();
    if (r && typeof (r as Promise<void>).then === "function") void r;
  } catch (err) {
    console.error(`[plugins] ${labelForErr ?? "contribution"} failed`, err);
  }
}

function onPluginItem(item: PluginMenuChild): void {
  if (item.kind === "action") {
    const a = pluginActions.find((x) => x.uid === item.uid);
    if (a) runPluginDef(a.def.run);
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
  project.dirty ? ` • ${t("toolbar.unsavedDot")}` : "",
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
  if (cmd.startsWith("exp-")) {
    const uid = Number(cmd.slice("exp-".length));
    const e = pluginExporters.find((x) => x.uid === uid);
    if (e) runPluginDef(e.def.run);
    return;
  }
  if (cmd.startsWith("imp-")) {
    const uid = Number(cmd.slice("imp-".length));
    const im = pluginImporters.find((x) => x.uid === uid);
    if (im) runPluginDef(im.def.run);
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

const zoomInDisabled = computed(() => view.pxPerSec >= 4000);
const zoomOutDisabled = computed(() => view.pxPerSec <= 6);
onMounted(() => {
  void loadRecents();
});
</script>

<template>
  <header class="topbar">
    <UiDropdownMenu
      @select="onCmd"
      @update:open="(v: boolean) => v && loadRecents()"
    >
      <template #trigger>
        <button class="menu-btn">
          <FilePlus class="size-3.5" />{{ t("menu.file") }}
          <ChevronDown class="caret" />
        </button>
      </template>
      <UiDropdownItem value="new">
        <FilePlus class="size-3.5" />{{ t("menu.new") }}
      </UiDropdownItem>
      <UiDropdownItem value="open-project">
        <FolderOpen class="size-3.5" />{{ t("menu.openProject") }}
      </UiDropdownItem>
      <UiDropdownItem
        v-for="(r, i) in recents"
        :key="r.path"
        :value="`recent-${i}`"
      >
        <Files class="size-3.5" />
        <span class="recent-title" :title="r.path">{{ r.title }}</span>
      </UiDropdownItem>
      <UiDropdownSeparator />
      <UiDropdownItem value="save">
        <FileText class="size-3.5" />{{ t("menu.saveProject") }}
      </UiDropdownItem>
      <UiDropdownItem value="save-as">
        <Copy class="size-3.5" />{{ t("menu.saveProjectAs") }}
      </UiDropdownItem>
      <template v-if="pluginImporters.length">
        <UiDropdownSeparator />
        <UiDropdownLabel>{{ t("menu.import") }}</UiDropdownLabel>
        <UiDropdownItem
          v-for="im in pluginImporters"
          :key="`imp-${im.uid}`"
          :value="`imp-${im.uid}`"
        >
          <Upload class="size-3.5" />
          <span class="plug-label">{{ localeText(im.def.label) }}</span>
        </UiDropdownItem>
      </template>
    </UiDropdownMenu>

    <UiDropdownMenu @select="onCmd">
      <template #trigger>
        <button class="menu-btn">
          <Copy class="size-3.5" />{{ t("menu.edit") }}
          <ChevronDown class="caret" />
        </button>
      </template>
      <UiDropdownItem value="undo">
        <Undo2 class="size-3.5" />{{ t("menu.undo") }}
      </UiDropdownItem>
      <UiDropdownItem value="redo">
        <Redo2 class="size-3.5" />{{ t("menu.redo") }}
      </UiDropdownItem>
      <UiDropdownSeparator />
      <UiDropdownItem value="cut">
        <Scissors class="size-3.5" />{{ t("menu.cut") }}
      </UiDropdownItem>
      <UiDropdownItem value="copy">
        <Copy class="size-3.5" />{{ t("menu.copy") }}
      </UiDropdownItem>
      <UiDropdownItem value="paste">
        <Files class="size-3.5" />{{ t("menu.paste") }}
      </UiDropdownItem>
    </UiDropdownMenu>

    <UiDropdownMenu @select="onCmd">
      <template #trigger>
        <button class="menu-btn">
          <SquareDashedMousePointer class="size-3.5" />{{ t("menu.select") }}
          <ChevronDown class="caret" />
        </button>
      </template>
      <UiDropdownItem value="select-all">
        <SquareDashedMousePointer class="size-3.5" />{{ t("menu.selectAll") }}
      </UiDropdownItem>
    </UiDropdownMenu>

    <UiDropdownMenu v-if="pluginMenu.length" @select="onPluginCmd">
      <template #trigger>
        <button class="menu-btn">
          <LayoutGrid class="size-3.5" />{{ t("menu.plugins") }}
          <ChevronDown class="caret" />
        </button>
      </template>
      <template v-for="g in pluginMenu" :key="g.pluginId">
        <UiDropdownLabel>{{ g.name }}</UiDropdownLabel>
        <UiDropdownItem
          v-for="ch in g.children"
          :key="`${g.pluginId}-${ch.uid}`"
          :value="(ch.kind === 'action' ? 'a' : 'p') + ch.uid"
          :class="{ 'plug-open': ch.kind === 'panel' && ch.open }"
        >
          <span v-if="ch.kind === 'panel'" class="plug-check">{{
            ch.open ? "●" : "○"
          }}</span>
          <span v-else class="plug-check">▸</span>
          <span class="plug-label">{{ ch.label }}</span>
        </UiDropdownItem>
      </template>
    </UiDropdownMenu>

    <UiDropdownMenu @select="onCmd">
      <template #trigger>
        <button class="menu-btn">
          <Download class="size-3.5" />{{ t("menu.exportMenu") }}
          <ChevronDown class="caret" />
        </button>
      </template>
      <UiDropdownItem value="export">
        <Download class="size-3.5" />{{ t("menu.export") }}
      </UiDropdownItem>
      <UiDropdownItem value="export-edl">
        <LibraryBig class="size-3.5" />{{ t("menu.exportEdl") }}
      </UiDropdownItem>
      <template v-if="pluginExporters.length">
        <UiDropdownSeparator />
        <UiDropdownLabel>{{ t("menu.pluginExports") }}</UiDropdownLabel>
        <UiDropdownItem
          v-for="ex in pluginExporters"
          :key="`exp-${ex.uid}`"
          :value="`exp-${ex.uid}`"
        >
          <Download class="size-3.5" />
          <span class="plug-label">{{ localeText(ex.def.label) }}</span>
        </UiDropdownItem>
      </template>
    </UiDropdownMenu>

    <span v-if="dirtyTitle" class="top-dirty" :title="t('toolbar.unsavedDot')"
      >●</span
    >

    <div class="grow" />

    <div class="zoom-group">
      <UiTooltip :content="t('menu.zoomOut')">
        <UiButton
          size="sm"
          :disabled="zoomOutDisabled"
          @click="zoomBy(1 / 1.3)"
        >
          <ZoomOut class="size-4" />
        </UiButton>
      </UiTooltip>
      <UiTooltip :content="t('menu.zoomIn')">
        <UiButton size="sm" :disabled="zoomInDisabled" @click="zoomBy(1.3)">
          <ZoomIn class="size-4" />
        </UiButton>
      </UiTooltip>
      <UiTooltip :content="t('menu.zoomFit')">
        <UiButton size="sm" @click="onFit">
          <Maximize class="size-4" />
        </UiButton>
      </UiTooltip>
    </div>

    <UiTooltip
      v-if="settings.settings.audioPanel"
      :content="t('settings.cats.audio')"
    >
      <UiButton
        class="ana-btn"
        size="sm"
        :variant="ui.analysisOpen ? 'soft' : 'ghost'"
        @click="ui.analysisOpen = !ui.analysisOpen"
      >
        <Activity class="size-4" />
      </UiButton>
    </UiTooltip>

    <UiTooltip :content="t('settings.title')">
      <UiButton class="help-btn" size="sm" @click="setSettingsOpen(true)">
        <Settings class="size-4" />
      </UiButton>
    </UiTooltip>
  </header>
</template>

<style scoped>
.topbar {
  height: var(--bdg-toolbar-h);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  background: linear-gradient(
    180deg,
    var(--bdg-bg-raised),
    var(--bdg-bg-panel)
  );
  border-bottom: 1px solid var(--bdg-border);
  flex: none;
}
.top-dirty {
  color: var(--bdg-amber);
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
  background: rgb(var(--bdg-neutral) / 0.12);
}
.caret {
  width: 10px;
  height: 10px;
  opacity: 0.7;
}
.grow {
  flex: 1;
}
.zoom-group {
  display: flex;
  align-items: center;
  background: rgb(var(--bdg-neutral) / 0.06);
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
