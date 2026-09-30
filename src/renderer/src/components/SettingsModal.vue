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
import {
  setSettingsOpen,
  patchSettings,
  useSettingsStore,
} from "../stores/settings";
import SettingsCategorySection from "./settings/SettingsCategorySection.vue";
import ShortcutsPanel from "./settings/ShortcutsPanel.vue";
import NetworkPanel from "./settings/NetworkPanel.vue";
import PluginsPanel from "./settings/PluginsPanel.vue";
import ThemePanel from "./settings/ThemePanel.vue";
import {
  useSettingsRowsStore,
  type SearchEntry,
} from "./settings/useSettingsRows";
import type { CatKey } from "./settings/types";
import UiButton from "./ui/UiButton.vue";

const settings = useSettingsStore();
const rows = useSettingsRowsStore();
const { simpleMode, uiMotion } = storeToRefs(rows);
const { groupsOf, rowsInGroup, activeGroup, setSubCat, fieldCats } = rows;
const { t, te } = useI18n();
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
const layout = computed<"drawer" | "full">({
  get: () => settings.settings.settingsLayout,
  set: (v) => void patchSettings({ settingsLayout: v }),
});

const DRAWER_MIN = 440;
/** Default drawer = 40% of the window; resizing is capped at 90%. */
const DRAWER_AUTO_RATIO = 0.4;
const DRAWER_MAX_RATIO = 0.9;
function maxDrawerWidth(): number {
  return window.innerWidth * DRAWER_MAX_RATIO;
}
function autoDrawerWidth(): number {
  return Math.max(
    DRAWER_MIN,
    Math.round(window.innerWidth * DRAWER_AUTO_RATIO),
  );
}

// While dragging we use a local pixel width; otherwise a stored 0 means "auto"
// (40% of the window, resolved by CSS). Local width avoids a full settings
// sanitize + persist on every pointermove; committed once on release.
const dragging = ref(false);
const dragWidth = ref(0);
const panelStyle = computed<Record<string, string> | undefined>(() => {
  if (layout.value !== "drawer") return undefined;
  if (dragging.value) return { width: `${dragWidth.value}px` };
  const stored = settings.settings.settingsDrawerWidth;
  return { width: stored > 0 ? `${stored}px` : "40%" };
});

// Interface motion (Settings → Display). Off = panels appear/disappear instantly.
const transitionName = computed(() =>
  layout.value === "drawer" ? "settings-drawer" : "settings-full",
);

function toggleLayout(): void {
  layout.value = layout.value === "drawer" ? "full" : "drawer";
}

function startResize(e: PointerEvent): void {
  if (layout.value !== "drawer") return;
  e.preventDefault();
  const startX = e.clientX;
  const startW =
    (e.currentTarget as HTMLElement).parentElement?.offsetWidth ??
    autoDrawerWidth();
  dragging.value = true;
  dragWidth.value = startW;
  const move = (ev: PointerEvent): void => {
    const next = startW - (ev.clientX - startX);
    dragWidth.value = Math.max(DRAWER_MIN, Math.min(next, maxDrawerWidth()));
  };
  const up = (): void => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    dragging.value = false;
    void patchSettings({ settingsDrawerWidth: Math.round(dragWidth.value) });
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

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

function catLabel(key: string): string {
  return t(`settings.cats.${key}`);
}

// ---- settings search ----
// The index (derived from FIELD_GROUPS plus theme colors) lives in
// useSettingsRowsStore so rendering and search share a single source of truth.
const search = ref("");
const contentEl = ref<HTMLElement | null>(null);
const searchEl = ref<HTMLInputElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
let lastFocused: HTMLElement | null = null;

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

/** Normalized query, reused by matching and highlighting. */
const searchQuery = computed(() => search.value.trim().toLowerCase());

function labelKeyOf(entry: SearchEntry): string {
  return `settings.${entry.cat}.${entry.key}`;
}

const searchResults = computed<
  Array<SearchEntry & { label: string; desc: string }>
>(() => {
  const q = searchQuery.value;
  if (!q) return [];
  const hits: Array<SearchEntry & { label: string; desc: string }> = [];
  for (const entry of rows.searchIndex) {
    if (simpleMode.value && entry.expert) continue;
    const key = labelKeyOf(entry);
    const label = t(key);
    const descKey = `${key}Desc`;
    const desc = te(descKey) ? t(descKey) : "";
    const haystack = [
      label,
      desc,
      catLabel(entry.cat),
      ...(entry.keywords ?? []),
    ]
      .join(" ")
      .toLowerCase();
    if (haystack.includes(q)) {
      hits.push({ ...entry, label, desc });
    }
  }
  return hits;
});

/** Split `text` into segments so the matched query can be marked in the list. */
function highlightParts(
  text: string,
  q: string,
): Array<{ text: string; hit: boolean }> {
  if (!q) return [{ text, hit: false }];
  const idx = text.toLowerCase().indexOf(q);
  if (idx < 0) return [{ text, hit: false }];
  const parts: Array<{ text: string; hit: boolean }> = [];
  if (idx > 0) parts.push({ text: text.slice(0, idx), hit: false });
  parts.push({ text: text.slice(idx, idx + q.length), hit: true });
  if (idx + q.length < text.length)
    parts.push({ text: text.slice(idx + q.length), hit: false });
  return parts;
}

function goToSetting(hit: SearchEntry & { label: string }): void {
  cat.value = hit.cat;
  if (hit.cat === "theme")
    rows.themeSub = hit.group === "appearance" ? "appearance" : "custom";
  else if (hit.group) setSubCat(hit.cat, hit.group);
  search.value = "";
  void nextTick(() => {
    const fieldRows = contentEl.value?.querySelectorAll(".field-row");
    if (!fieldRows) return;
    for (const row of fieldRows) {
      if (row.textContent?.includes(hit.label)) {
        row.scrollIntoView({
          block: "center",
          behavior: uiMotion.value ? "smooth" : "auto",
        });
        row.classList.add("search-hit");
        window.setTimeout(() => row.classList.remove("search-hit"), 1600);
        break;
      }
    }
  });
}

function onSearchEnter(): void {
  const first = searchResults.value[0];
  if (first) goToSetting(first);
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
