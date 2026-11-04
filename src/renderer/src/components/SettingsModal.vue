<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import type { Component } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import {
  Blocks,
  Info,
  Keyboard,
  Maximize,
  Minimize,
  Monitor,
  Music,
  Network,
  Palette,
  Pencil,
  Search,
  SlidersHorizontal,
  Wrench,
  X,
} from "@lucide/vue";
import { setSettingsOpen, useSettingsStore } from "../stores/settings";
import SettingsCategorySection from "./settings/SettingsCategorySection.vue";
import ShortcutsPanel from "./settings/ShortcutsPanel.vue";
import NetworkPanel from "./settings/NetworkPanel.vue";
import PluginsPanel from "./settings/PluginsPanel.vue";
import ThemePanel from "./settings/ThemePanel.vue";
import { useSettingsRowsStore } from "./settings/useSettingsRows";
import { useSettingsLayout } from "./settings/useSettingsLayout";
import { useSettingsSearch } from "./settings/useSettingsSearch";
import type { CatKey } from "./settings/types";
import UiButton from "./ui/UiButton.vue";

const settings = useSettingsStore();
const rows = useSettingsRowsStore();
const { simpleMode, uiMotion } = storeToRefs(rows);
const { groupsOf, rowsInGroup, activeGroup, setSubCat, fieldCats } = rows;
const { t } = useI18n();
const cat = ref<CatKey>("general");

const cats: Array<{ key: CatKey; icon: Component }> = [
  { key: "general", icon: SlidersHorizontal },
  { key: "edit", icon: Pencil },
  { key: "audio", icon: Music },
  { key: "display", icon: Monitor },
  { key: "theme", icon: Palette },
  { key: "plugins", icon: Blocks },
  { key: "shortcuts", icon: Keyboard },
  { key: "network", icon: Network },
  { key: "advanced", icon: Wrench },
  { key: "about", icon: Info },
];

/** Whole categories hidden while simple mode is on. */
const SIMPLE_HIDDEN_CATS: CatKey[] = ["advanced"];

// ---- layout: docked drawer ↔ full screen (persisted) ----
const { layout, panelStyle, transitionName, toggleLayout, startResize } =
  useSettingsLayout();

onMounted(() => {
  window.addEventListener("keydown", onWindowKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onWindowKeydown);
});

watch(
  () => settings.settingsOpen,
  async (open) => {
    if (!open) {
      // hand focus back to whatever opened the dialog
      lastFocused?.focus?.();
      lastFocused = null;
      return;
    }
    lastFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    await nextTick();
    (searchEl.value ?? panelEl.value)?.focus();
  },
);

/** Categories shown in the nav; expert categories are hidden in simple mode. */
const visibleCats = computed(() =>
  simpleMode.value
    ? cats.filter((c) => !SIMPLE_HIDDEN_CATS.includes(c.key))
    : cats,
);

// Never leave the user stranded on a category that simple mode just hid.
watch(simpleMode, (on) => {
  if (on && SIMPLE_HIDDEN_CATS.includes(cat.value)) cat.value = "general";
});

// ---- settings search ----
// The index (derived from FIELD_GROUPS plus theme colors) lives in
// useSettingsRowsStore so rendering and search share a single source of truth.
const contentEl = ref<HTMLElement | null>(null);
const searchEl = ref<HTMLInputElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
let lastFocused: HTMLElement | null = null;

const {
  search,
  searchQuery,
  searchResults,
  highlightParts,
  goToSetting,
  onSearchEnter,
  catLabel,
} = useSettingsSearch({ cat, contentEl, searchEl });

/** Escape closes the dialog (or clears an active search first). Handled on the
 *  window so it works regardless of which element currently holds focus. */
function onWindowKeydown(e: KeyboardEvent): void {
  if (!settings.settingsOpen || e.key !== "Escape") return;
  e.preventDefault();
  if (document.activeElement === searchEl.value && search.value.trim()) {
    search.value = "";
    return;
  }
  setSettingsOpen(false);
}

/** Trap Tab inside the panel so focus can never leave the modal. */
function onPanelKeydown(e: KeyboardEvent): void {
  if (e.key !== "Tab") return;
  const panel = panelEl.value;
  if (!panel) return;
  const items = Array.from(
    panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  const active = document.activeElement;
  // The panel itself is focusable (tabindex=-1) but is not a real stop.
  const inside =
    active instanceof HTMLElement && active !== panel && panel.contains(active);
  if (e.shiftKey) {
    if (!inside || active === first) {
      e.preventDefault();
      last.focus();
    }
  } else if (!inside || active === last) {
    e.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <teleport to="body">
    <Transition :name="transitionName" :css="uiMotion">
      <div
        v-if="settings.settingsOpen"
        class="mask"
        :class="layout"
        @click.self="setSettingsOpen(false)"
      >
        <div
          ref="panelEl"
          class="panel settings-panel"
          :class="layout"
          :style="panelStyle"
          role="dialog"
          aria-modal="true"
          :aria-label="t('settings.title')"
          tabindex="-1"
          @keydown="onPanelKeydown"
        >
          <div
            v-if="layout === 'drawer'"
            class="resize-handle"
            @pointerdown="startResize"
          />
          <header class="head">
            <span class="title">{{ t("settings.title") }}</span>
            <div class="search" role="search">
              <Search class="search-icon size-3.5" />
              <input
                ref="searchEl"
                v-model="search"
                class="search-input"
                :placeholder="t('settings.searchPlaceholder')"
                :aria-label="t('settings.searchPlaceholder')"
                @keydown.enter.prevent="onSearchEnter()"
              />
              <button
                v-if="search"
                class="search-clear"
                :title="t('settings.searchClear')"
                :aria-label="t('settings.searchClear')"
                @click="search = ''"
              >
                <X class="size-3.5" />
              </button>
            </div>
            <div class="head-actions">
              <button
                class="icon-btn"
                :title="
                  layout === 'drawer'
                    ? t('settings.expand')
                    : t('settings.collapse')
                "
                :aria-label="
                  layout === 'drawer'
                    ? t('settings.expand')
                    : t('settings.collapse')
                "
                @click="toggleLayout()"
              >
                <Minimize v-if="layout === 'full'" class="size-3.5" />
                <Maximize v-else class="size-3.5" />
              </button>
              <button
                class="close-x"
                :aria-label="t('settings.close')"
                @click="setSettingsOpen(false)"
              >
                <X class="size-3.5" />
              </button>
            </div>
          </header>

          <div class="body">
            <div v-if="search.trim()" class="search-results">
              <button
                v-for="hit in searchResults"
                :key="`${hit.cat}.${hit.key}`"
                class="search-result"
                @click="goToSetting(hit)"
              >
                <span class="sr-head">
                  <span class="sr-label">
                    <template
                      v-for="(p, pi) in highlightParts(hit.label, searchQuery)"
                      :key="pi"
                    >
                      <mark v-if="p.hit">{{ p.text }}</mark>
                      <template v-else>{{ p.text }}</template>
                    </template>
                  </span>
                  <span class="sr-cat">{{ catLabel(hit.cat) }}</span>
                </span>
                <span v-if="hit.desc" class="sr-desc">
                  <template
                    v-for="(p, pi) in highlightParts(hit.desc, searchQuery)"
                    :key="pi"
                  >
                    <mark v-if="p.hit">{{ p.text }}</mark>
                    <template v-else>{{ p.text }}</template>
                  </template>
                </span>
              </button>
              <div v-if="searchResults.length === 0" class="search-empty">
                {{ t("settings.searchNoResults") }}
              </div>
            </div>

            <nav class="nav" :aria-label="t('settings.title')">
              <button
                v-for="c in visibleCats"
                :key="c.key"
                class="nav-item"
                :class="{ active: cat === c.key }"
                @click="cat = c.key"
              >
                <span class="nav-icon">
                  <component :is="c.icon" class="size-3.5" />
                </span>
                <span class="nav-label">{{ catLabel(c.key) }}</span>
              </button>
              <button
                v-if="simpleMode"
                class="nav-note"
                @click="simpleMode = false"
              >
                {{ t("settings.simpleModeHint") }}
              </button>
            </nav>

            <main ref="contentEl" class="content">
              <!-- 由 FIELD_GROUPS 声明的分类 -->
              <template v-for="key in fieldCats" :key="key">
                <SettingsCategorySection
                  v-if="cat === key"
                  :cat-key="key"
                  :groups="groupsOf(key)"
                  :active-group="activeGroup(key)"
                  :rows="rowsInGroup(key)"
                  @select-group="(g) => setSubCat(key, g)"
                />
              </template>

              <!-- 主题 -->
              <ThemePanel v-if="cat === 'theme'" />

              <!-- 快捷键 -->
              <ShortcutsPanel v-if="cat === 'shortcuts'" />

              <!-- 插件 -->
              <PluginsPanel v-if="cat === 'plugins'" />

              <!-- 网络 -->
              <NetworkPanel v-if="cat === 'network'" />
            </main>
          </div>

          <footer class="foot">
            <span class="autosave">{{ t("settings.autoSave") }}</span>
            <UiButton variant="solid" size="sm" @click="setSettingsOpen(false)">
              {{ t("settings.done") }}
            </UiButton>
          </footer>
        </div>
      </div>
    </Transition>
  </teleport>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: var(--bdg-z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
}
/* Dim + blur live on a pseudo-element so both can animate on their own without
   fading the panel along with them. */
.mask::before {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--bdg-mask);
  backdrop-filter: var(--bdg-blur);
}
.mask.drawer {
  align-items: stretch;
  justify-content: flex-end;
}

/* enter/exit: mask opacity+blur fade while the panel slides/scales.
   The root itself carries a (visually inert) transition so <Transition> can read
   the duration from the root element and wait for the child/pseudo animations. */
.settings-drawer-enter-active,
.settings-drawer-leave-active {
  transition: opacity 0.28s ease;
}
.settings-drawer-enter-active::before,
.settings-drawer-leave-active::before {
  transition:
    opacity 0.24s ease,
    backdrop-filter 0.24s ease;
}
.settings-drawer-enter-active .panel,
.settings-drawer-leave-active .panel {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}
.settings-drawer-enter-from::before,
.settings-drawer-leave-to::before {
  opacity: 0;
  backdrop-filter: blur(0);
}
.settings-drawer-enter-from .panel,
.settings-drawer-leave-to .panel {
  transform: translateX(100%);
}

.settings-full-enter-active,
.settings-full-leave-active {
  transition: opacity 0.22s ease;
}
.settings-full-enter-active::before,
.settings-full-leave-active::before {
  transition:
    opacity 0.2s ease,
    backdrop-filter 0.2s ease;
}
.settings-full-enter-active .panel,
.settings-full-leave-active .panel {
  transition:
    transform 0.22s ease,
    opacity 0.22s ease;
}
.settings-full-enter-from::before,
.settings-full-leave-to::before {
  opacity: 0;
  backdrop-filter: blur(0);
}
.settings-full-enter-from .panel,
.settings-full-leave-to .panel {
  transform: scale(0.97);
  opacity: 0;
}
.panel {
  position: relative;
  z-index: 1;
  background: var(--bdg-bg-panel);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.panel.full {
  width: min(1200px, 96vw);
  height: min(860px, 94vh);
  border: 1px solid var(--bdg-border-strong);
  border-radius: calc(var(--bdg-radius, 6px) * 2);
  box-shadow: 0 18px 60px var(--bdg-shadow);
}
.panel.drawer {
  position: relative;
  height: 100%;
  min-width: 440px;
  max-width: 90vw;
  border-left: 1px solid var(--bdg-border-strong);
  box-shadow: -18px 0 60px var(--bdg-shadow);
}
.resize-handle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 1;
}
.resize-handle:hover {
  background: rgb(var(--bdg-accent-rgb) / 0.25);
}
.head {
  position: relative;
  z-index: 3;
  flex: none;
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--bdg-border);
}
.title {
  font-weight: 700;
  flex: none;
}
.search {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  max-width: 340px;
  margin: 0 12px;
}
.search-icon {
  position: absolute;
  left: 9px;
  color: var(--bdg-text-dim);
  pointer-events: none;
}
.search-input {
  width: 100%;
  height: 30px;
  padding: 0 28px 0 30px;
  border-radius: var(--bdg-radius, 6px);
  border: 1px solid var(--bdg-border);
  background: var(--bdg-bg-sunken);
  color: var(--bdg-text);
  font-size: var(--bdg-fs-13);
  font-family: inherit;
  outline: none;
}
.search-input:focus {
  border-color: var(--bdg-border-strong);
}
.search-input::placeholder {
  color: var(--bdg-text-faint);
}
.search-clear {
  position: absolute;
  right: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--bdg-ctl-xs);
  height: var(--bdg-ctl-xs);
  border: none;
  background: none;
  color: var(--bdg-text-dim);
  border-radius: var(--bdg-radius-md);
  cursor: pointer;
}
.search-clear:hover {
  background: rgb(var(--bdg-neutral) / 0.15);
  color: var(--bdg-text);
}
.search-results {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  /* above the nav and content inside .body so the results are never covered */
  z-index: 20;
  max-height: 60vh;
  overflow: auto;
  background: var(--bdg-bg-raised);
  border-bottom: 1px solid var(--bdg-border-strong);
  box-shadow: 0 16px 40px var(--bdg-shadow);
}
.search-result {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 3px;
  width: 100%;
  padding: 10px 18px;
  border: none;
  background: none;
  color: var(--bdg-text);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: var(--bdg-fs-13);
}
.search-result:hover {
  background: rgb(var(--bdg-accent-rgb) / 0.12);
}
.search-result mark {
  background: rgb(var(--bdg-accent-rgb) / 0.3);
  color: inherit;
  border-radius: var(--bdg-radius-2xs);
}
.sr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sr-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sr-cat {
  flex: none;
  font-size: var(--bdg-fs-11);
  color: var(--bdg-text-dim);
}
.sr-desc {
  font-size: var(--bdg-fs-11);
  color: var(--bdg-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-empty {
  padding: 16px 18px;
  font-size: var(--bdg-fs-12);
  color: var(--bdg-text-dim);
}
.search-hit {
  animation: searchHit 1.6s ease;
}
@keyframes searchHit {
  0% {
    background: rgb(var(--bdg-accent-rgb) / 0.28);
  }
  100% {
    background: transparent;
  }
}
.head-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--bdg-ctl-sm);
  height: var(--bdg-ctl-sm);
  border: none;
  background: none;
  color: var(--bdg-text-dim);
  border-radius: var(--bdg-radius, 6px);
  cursor: pointer;
}
.icon-btn:hover {
  background: rgb(var(--bdg-neutral) / 0.12);
  color: var(--bdg-text);
}
.close-x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--bdg-ctl-sm);
  height: var(--bdg-ctl-sm);
  background: none;
  border: none;
  color: var(--bdg-text-dim);
  border-radius: var(--bdg-radius, 6px);
  cursor: pointer;
}
.close-x:hover {
  background: rgb(var(--bdg-neutral) / 0.12);
  color: var(--bdg-text);
}
.body {
  position: relative;
  z-index: 0;
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
.nav-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  color: var(--bdg-text);
  padding: 9px 12px;
  border-radius: var(--bdg-radius, 6px);
  cursor: pointer;
  font-size: var(--bdg-fs-13);
  text-align: left;
  font-family: inherit;
}
.nav-item:hover {
  background: rgb(var(--bdg-neutral) / 0.1);
}
.nav-item.active {
  background: rgb(var(--bdg-accent-rgb) / 0.16);
  color: var(--bdg-accent);
  font-weight: 600;
}
.nav-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  opacity: 0.9;
}
.nav-note {
  margin-top: auto;
  padding: 8px 12px;
  border: none;
  border-radius: var(--bdg-radius, 6px);
  background: transparent;
  color: var(--bdg-text-dim);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--bdg-fs-11);
  line-height: 1.4;
  text-align: left;
}
.nav-note:hover {
  background: rgb(var(--bdg-neutral) / 0.1);
  color: var(--bdg-text);
}
.content {
  flex: 1;
  overflow: auto;
  padding: 18px 22px;
  /* Reserve the scrollbar on both edges so the centered sections keep the same
     axis whether or not this tab is tall enough to scroll. */
  scrollbar-gutter: stable both-edges;
}
.panel.drawer .content {
  padding: 14px 16px;
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
  font-size: var(--bdg-fs-11);
  color: var(--bdg-text-dim);
}
/* Keep settings button labels from breaking mid-word (notably CJK). */
.panel button {
  word-break: keep-all;
}
/* Honour the OS "reduce motion" preference for the panel animations and the
   search-hit flash, independently of the in-app Interface motion setting. */
@media (prefers-reduced-motion: reduce) {
  .settings-drawer-enter-active,
  .settings-drawer-leave-active,
  .settings-full-enter-active,
  .settings-full-leave-active,
  .settings-drawer-enter-active .panel,
  .settings-drawer-leave-active .panel,
  .settings-full-enter-active .panel,
  .settings-full-leave-active .panel,
  .settings-drawer-enter-active::before,
  .settings-drawer-leave-active::before,
  .settings-full-enter-active::before,
  .settings-full-leave-active::before {
    transition: none;
  }
  .search-hit {
    animation: none;
  }
}
</style>
