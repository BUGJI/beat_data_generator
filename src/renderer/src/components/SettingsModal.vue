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
import {
  settingsSavedAt,
  settingsSaving,
} from "../services/settingsPersistence";
import SettingsCategorySection from "./settings/SettingsCategorySection.vue";
import SettingsPage from "./settings/SettingsPage.vue";
import ShortcutsPanel from "./settings/ShortcutsPanel.vue";
import NetworkPanel from "./settings/NetworkPanel.vue";
import PluginsPanel from "./settings/PluginsPanel.vue";
import ThemePanel from "./settings/ThemePanel.vue";
import AboutBlock from "./settings/custom/AboutBlock.vue";
import { useSettingsRowsStore } from "./settings/useSettingsRows";
import { useSettingsLayout } from "./settings/useSettingsLayout";
import { useSettingsSearch } from "./settings/useSettingsSearch";
import { animationsEnabled } from "../services/motion";
import type { CatKey } from "./settings/types";
import UiButton from "./ui/UiButton.vue";

const settings = useSettingsStore();
const rows = useSettingsRowsStore();
const { simpleMode, uiMotion } = storeToRefs(rows);
const panelMotion = computed(() => uiMotion.value && animationsEnabled());
const { groupsOf, rowsInGroup, activeGroup, setSubCat, fieldCats } = rows;
const { t, locale } = useI18n();
const cat = ref<CatKey>("general");

type NavSection = "app" | "edit" | "extras";
type NavCat = CatKey;
type NavItem = { key: NavCat; icon: Component };

/** Every navigable category; the record makes a new category fail to compile. */
const NAV_ICONS: Record<NavCat, Component> = {
  general: SlidersHorizontal,
  display: Monitor,
  theme: Palette,
  edit: Pencil,
  audio: Music,
  shortcuts: Keyboard,
  plugins: Blocks,
  network: Network,
  advanced: Wrench,
  about: Info,
};
const NAV_GROUP_OF: Record<NavCat, NavSection> = {
  general: "app",
  display: "app",
  theme: "app",
  edit: "edit",
  audio: "edit",
  shortcuts: "edit",
  plugins: "extras",
  network: "extras",
  advanced: "extras",
  about: "extras",
};
const NAV_SECTIONS: Array<{ key: NavSection; titleKey: string }> = [
  { key: "app", titleKey: "settings.nav.app" },
  { key: "edit", titleKey: "settings.nav.edit" },
  { key: "extras", titleKey: "settings.nav.extras" },
];
const NAV_GROUPS: Array<{ titleKey: string; items: NavItem[] }> =
  NAV_SECTIONS.map((section) => ({
    titleKey: section.titleKey,
    items: (Object.keys(NAV_ICONS) as NavCat[])
      .filter((key) => NAV_GROUP_OF[key] === section.key)
      .map((key) => ({ key, icon: NAV_ICONS[key] })),
  }));

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
  navObserver?.disconnect();
  navObserver = null;
  if (savedTimer !== undefined) window.clearTimeout(savedTimer);
});

watch(
  () => settings.settingsOpen,
  async (open) => {
    if (!open) {
      search.value = "";
      // hand focus back to whatever opened the dialog
      lastFocused?.focus?.();
      lastFocused = null;
      navObserver?.disconnect();
      navObserver = null;
      navCanLeft.value = false;
      navCanRight.value = false;
      return;
    }
    lastFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    await nextTick();
    (searchEl.value ?? panelEl.value)?.focus();
    observeNav();
    refreshNav("auto");
  },
);

/** Navigation groups with expert categories dropped in simple mode. */
const navGroups = computed(() =>
  NAV_GROUPS.map((group) => ({
    ...group,
    items: simpleMode.value
      ? group.items.filter((c) => !SIMPLE_HIDDEN_CATS.includes(c.key))
      : group.items,
  })).filter((group) => group.items.length > 0),
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
const navEl = ref<HTMLElement | null>(null);
let lastFocused: HTMLElement | null = null;

// Narrow panels turn the category list into a horizontal strip. Track whether
// it can still scroll in each direction so the edges can advertise it.
const navCanLeft = ref(false);
const navCanRight = ref(false);
let navObserver: ResizeObserver | null = null;

// Settings persist a moment after the change; surface that briefly in the
// footer instead of only showing the static auto-save wording.
const showSaved = ref(false);
let savedTimer: number | undefined;
watch(settingsSavedAt, () => {
  showSaved.value = true;
  if (savedTimer !== undefined) window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => {
    showSaved.value = false;
  }, 1600);
});
const autoSaveText = computed(() => {
  if (settingsSaving.value) return t("settings.saving");
  if (showSaved.value) return t("settings.saved");
  return t("settings.autoSave");
});

function updateNavScroll(): void {
  const nav = navEl.value;
  if (!nav) return;
  const max = nav.scrollWidth - nav.clientWidth;
  navCanLeft.value = max > 1 && nav.scrollLeft > 1;
  navCanRight.value = max > 1 && nav.scrollLeft < max - 1;
}

/** Centre the active category inside a horizontal nav without moving ancestors. */
function revealActiveNav(behavior: ScrollBehavior = "smooth"): void {
  const nav = navEl.value;
  if (!nav || nav.scrollWidth <= nav.clientWidth + 1) return;
  const active = nav.querySelector<HTMLElement>(".nav-item.active");
  if (!active) return;
  const navRect = nav.getBoundingClientRect();
  const activeRect = active.getBoundingClientRect();
  // Leave an already visible item alone; only fetch it when it is clipped.
  if (
    activeRect.left >= navRect.left - 1 &&
    activeRect.right <= navRect.right + 1
  )
    return;
  const centered =
    activeRect.left -
    navRect.left +
    nav.scrollLeft -
    (nav.clientWidth - activeRect.width) / 2;
  nav.scrollTo({
    left: Math.max(0, centered),
    behavior: animationsEnabled() ? behavior : "auto",
  });
}

function refreshNav(behavior: ScrollBehavior = "smooth"): void {
  updateNavScroll();
  revealActiveNav(behavior);
}

function observeNav(): void {
  navObserver?.disconnect();
  const nav = navEl.value;
  if (!nav || typeof ResizeObserver === "undefined") return;
  navObserver = new ResizeObserver(() => updateNavScroll());
  navObserver.observe(nav);
}

// Switching categories starts the new page at the top. Search-driven jumps
// still scroll to their target afterwards.
watch(cat, () => {
  if (contentEl.value) contentEl.value.scrollTop = 0;
  void nextTick(() => refreshNav());
});

// The strip appears/disappears with layout and simple-mode changes; re-evaluate
// the edge fades and bring the active item back into view.
watch([layout, simpleMode], () => {
  void nextTick(() => refreshNav("auto"));
});
// Label width changes as well, so the overflow state may change with them.
watch([locale, () => settings.settings.uiFontScale], () => {
  void nextTick(() => refreshNav("auto"));
});

const {
  search,
  searchQuery,
  searchResults,
  searchGroups,
  activeIndex,
  highlightParts,
  goToSetting,
  onSearchKeydown,
  catLabel,
} = useSettingsSearch({ cat, contentEl, searchEl });

const searching = computed(() => search.value.trim().length > 0);

/** Clear the query and keep focus in the search box (the clear button vanishes). */
function clearSearch(): void {
  search.value = "";
  void nextTick(() => searchEl.value?.focus());
}

/** Escape closes the dialog (or clears an active search first). Handled on the
 *  window so it works regardless of which element currently holds focus. */
function onWindowKeydown(e: KeyboardEvent): void {
  if (!settings.settingsOpen || e.key !== "Escape") return;
  if (e.isComposing) return;
  e.preventDefault();
  if (search.value.trim()) {
    clearSearch();
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
  ).filter((el) => el.offsetParent !== null && !el.closest("[inert]"));
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
    <Transition :name="transitionName" :css="panelMotion">
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
                role="combobox"
                aria-autocomplete="list"
                :aria-expanded="searching"
                :aria-controls="
                  searching ? 'settings-search-results' : undefined
                "
                :aria-activedescendant="
                  searching && searchResults.length
                    ? `settings-hit-${activeIndex}`
                    : undefined
                "
                :placeholder="t('settings.searchPlaceholder')"
                :aria-label="t('settings.searchPlaceholder')"
                @keydown="onSearchKeydown"
              />
              <button
                v-if="search"
                class="search-clear"
                :title="t('settings.searchClear')"
                :aria-label="t('settings.searchClear')"
                @click="clearSearch()"
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
            <div
              v-if="searching"
              id="settings-search-results"
              class="search-results"
              role="listbox"
              :aria-label="t('settings.searchResults')"
            >
              <template v-for="group in searchGroups" :key="group.cat">
                <div class="sr-group" role="presentation">
                  <span>{{ group.label }}</span>
                  <span class="sr-count">{{ group.hits.length }}</span>
                </div>
                <button
                  v-for="{ hit, index } in group.hits"
                  :id="`settings-hit-${index}`"
                  :key="`${hit.cat}.${hit.key}`"
                  type="button"
                  role="option"
                  class="search-result"
                  :class="{ active: index === activeIndex }"
                  :aria-selected="index === activeIndex"
                  @click="goToSetting(hit)"
                  @mouseenter="activeIndex = index"
                >
                  <span class="sr-head">
                    <span class="sr-label">
                      <template
                        v-for="(p, pi) in highlightParts(
                          hit.label,
                          searchQuery,
                        )"
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
              </template>
              <div v-if="searchResults.length === 0" class="search-empty">
                {{ t("settings.searchNoResults") }}
              </div>
            </div>

            <nav
              ref="navEl"
              class="nav"
              :class="{
                'can-left': navCanLeft,
                'can-right': navCanRight,
              }"
              :aria-label="t('settings.navLabel')"
              :inert="searching"
              :aria-hidden="searching || undefined"
              @scroll.passive="updateNavScroll"
            >
              <template v-for="group in navGroups" :key="group.titleKey">
                <div class="nav-group-title">{{ t(group.titleKey) }}</div>
                <button
                  v-for="c in group.items"
                  :key="c.key"
                  class="nav-item"
                  :class="{ active: cat === c.key }"
                  :aria-current="cat === c.key ? 'page' : undefined"
                  @click="cat = c.key"
                >
                  <span class="nav-icon">
                    <component :is="c.icon" class="size-3.5" />
                  </span>
                  <span class="nav-label">{{ catLabel(c.key) }}</span>
                </button>
              </template>
              <button
                v-if="simpleMode"
                class="nav-note"
                @click="simpleMode = false"
              >
                {{ t("settings.simpleModeHint") }}
              </button>
            </nav>

            <main
              ref="contentEl"
              class="content"
              :inert="searching"
              :aria-hidden="searching || undefined"
            >
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

              <!-- 关于 -->
              <SettingsPage
                v-if="cat === 'about'"
                :title="t('settings.cats.about')"
              >
                <AboutBlock />
              </SettingsPage>
            </main>
          </div>

          <footer class="foot">
            <span class="autosave" role="status" aria-live="polite">
              {{ autoSaveText }}
            </span>
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
  transition: opacity calc(0.28s * var(--bdg-panel-motion-scale, 1)) ease;
}
.settings-drawer-enter-active::before,
.settings-drawer-leave-active::before {
  transition:
    opacity calc(0.24s * var(--bdg-panel-motion-scale, 1)) ease,
    backdrop-filter calc(0.24s * var(--bdg-panel-motion-scale, 1)) ease;
}
.settings-drawer-enter-active .panel,
.settings-drawer-leave-active .panel {
  transition: transform calc(0.28s * var(--bdg-panel-motion-scale, 1))
    cubic-bezier(0.22, 1, 0.36, 1);
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
  transition: opacity calc(0.22s * var(--bdg-panel-motion-scale, 1)) ease;
}
.settings-full-enter-active::before,
.settings-full-leave-active::before {
  transition:
    opacity calc(0.2s * var(--bdg-panel-motion-scale, 1)) ease,
    backdrop-filter calc(0.2s * var(--bdg-panel-motion-scale, 1)) ease;
}
.settings-full-enter-active .panel,
.settings-full-leave-active .panel {
  transition:
    transform calc(0.22s * var(--bdg-panel-motion-scale, 1)) ease,
    opacity calc(0.22s * var(--bdg-panel-motion-scale, 1)) ease;
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
  container-type: inline-size;
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
  /* Never let the minimum exceed the viewport on narrow windows. */
  min-width: min(440px, 90vw);
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
/* The dialog removes the native outline globally; give the keyboard focus a
   visible ring so the search field is clearly the active control. */
.search-input:focus-visible {
  outline: 2px solid var(--bdg-accent);
  outline-offset: 1px;
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
.search-result:hover,
.search-result.active {
  background: rgb(var(--bdg-accent-rgb) / 0.12);
}
.sr-group {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 18px 4px;
  background: var(--bdg-bg-raised);
  border-bottom: 1px solid var(--bdg-border);
  font-size: var(--bdg-fs-10);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bdg-text-faint);
}
.sr-count {
  font-variant-numeric: tabular-nums;
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
  animation: searchHit calc(1.6s * var(--bdg-menu-motion-scale, 1)) ease;
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
  min-height: 0;
  overflow-y: auto;
  border-right: 1px solid var(--bdg-border);
  padding: 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-group-title {
  padding: 10px 12px 4px;
  font-size: var(--bdg-fs-10);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--bdg-text-faint);
}
.nav-group-title:first-child {
  padding-top: 2px;
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
/* Narrow panels: the side navigation turns into a horizontal strip so the
   content keeps the full panel width. */
@container (max-width: 640px) {
  .body {
    flex-direction: column;
  }
  .nav {
    width: auto;
    flex-direction: row;
    align-items: center;
    gap: 2px;
    border-right: none;
    border-bottom: 1px solid var(--bdg-border);
    padding: 6px 8px;
    overflow-x: auto;
    overflow-y: hidden;
  }
  /* Fade the edge that still has off-screen categories so the strip reads as
     horizontally scrollable; classes are toggled from the scroll handler. */
  .nav.can-left:not(.can-right) {
    mask-image: linear-gradient(to right, transparent 0, #000 28px);
  }
  .nav.can-right:not(.can-left) {
    mask-image: linear-gradient(to left, transparent 0, #000 28px);
  }
  .nav.can-left.can-right {
    mask-image: linear-gradient(
      to right,
      transparent 0,
      #000 28px,
      #000 calc(100% - 28px),
      transparent 100%
    );
  }
  .nav-group-title {
    display: none;
  }
  .nav-item {
    flex: none;
    padding: 7px 10px;
  }
  .nav-note {
    margin-top: 0;
    margin-left: auto;
    flex: none;
    white-space: nowrap;
  }
  .content {
    padding: 14px;
  }
}
@container (max-width: 480px) {
  .head {
    gap: 6px;
    padding: 10px 12px;
  }
  .title {
    display: block;
    flex: none;
    font-size: var(--bdg-fs-12);
    font-weight: 600;
    color: var(--bdg-text-dim);
    white-space: nowrap;
  }
  .search {
    margin: 0 8px 0 0;
  }
  .foot {
    flex-wrap: wrap;
    gap: 8px;
  }
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
