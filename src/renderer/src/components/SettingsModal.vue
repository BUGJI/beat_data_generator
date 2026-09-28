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
import { useI18n } from "vue-i18n";
import {
  Blocks,
  Check,
  Info,
  Keyboard,
  Maximize,
  Minimize,
  Monitor,
  Music,
  Network,
  Palette,
  Pencil,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Wrench,
  X,
} from "@lucide/vue";
import {
  setSettingsOpen,
  patchSettings,
  openDevTools,
  loadMetronome,
  previewMetronome,
  setThemePreset,
  setThemeToken,
  previewThemeToken,
  resetThemeTokens,
  exportThemeCode,
  importThemeCode,
  applyAppName,
  appDisplayName,
} from "../store";
import { setLocale, LOCALES } from "../i18n";
import { toast } from "../ui/toast";
import {
  THEME_PRESETS,
  THEME_TOKEN_ORDER,
  isLightColor,
  resolveTheme,
  themeContrastIssues,
  type ThemeOverrides,
  type ThemeSpec,
} from "../theme";
import {
  pluginEntries,
  pluginName,
  pluginDescription,
  setPluginEnabled,
  reloadPlugins,
  refreshPlugins,
} from "../plugins/host";
import type { PluginEntry } from "../../../shared/plugin";
import {
  MARKET_CATEGORIES,
  type MarketPluginView,
  type MarketProgress,
} from "../../../shared/market";
import type { CloseMode, MetronomeFile } from "../../../shared/ipc";
import type {
  AlignRounding,
  BackgroundFit,
  MarketCacheTtl,
  ProxyMode,
  StretchEngine,
} from "../../../shared/settings";
import { GH_PROXY_PRESETS, type PingResult } from "../../../shared/network";
import { backgroundImageUrl, useSettingsStore } from "../stores/settings";
import ThemePreview from "./ThemePreview.vue";
import UiButton from "./ui/UiButton.vue";
import UiColorField from "./ui/UiColorField.vue";
import UiInput from "./ui/UiInput.vue";
import UiNumberInput from "./ui/UiNumberInput.vue";
import UiRadioGroup from "./ui/UiRadioGroup.vue";
import UiSlider from "./ui/UiSlider.vue";
import UiSwitch from "./ui/UiSwitch.vue";

const settings = useSettingsStore();
const { t, te, locale } = useI18n();
const pv =
  typeof process !== "undefined" && process.versions ? process.versions : null;
const runtime = Object.freeze({
  node: pv?.node ?? "--",
  chrome: pv?.chrome ?? "--",
  electron: pv?.electron ?? "--",
});
const appVersion = __APP_VERSION__;
const cat = ref<
  | "general"
  | "edit"
  | "audio"
  | "display"
  | "theme"
  | "shortcuts"
  | "plugins"
  | "network"
  | "advanced"
  | "about"
>("general");

type CatKey =
  | "general"
  | "edit"
  | "audio"
  | "display"
  | "theme"
  | "shortcuts"
  | "plugins"
  | "network"
  | "advanced"
  | "about";

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

// ---- theme editor ----
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
const themeSub = ref<"preset" | "custom" | "appearance">("preset");
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
  patchSettings({ themeOverrides: next });
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

// ---- plugin marketplace ----
const pluginsTab = ref<"installed" | "market">("installed");
const market = ref<MarketPluginView[]>([]);
const marketLoading = ref(false);
const marketError = ref("");
const marketQuery = ref("");
const marketCategory = ref("");
const marketBusy = ref<string | null>(null);
const trustFor = ref<string | null>(null);
const marketProgress = ref<Record<string, MarketProgress>>({});

const marketCacheTtl = computed<string>({
  get: () => settings.settings.marketCacheTtl,
  set: (v) => void patchSettings({ marketCacheTtl: v as MarketCacheTtl }),
});
const ttlOptions = computed(() =>
  (["1d", "3d", "7d", "30d"] as const).map((v) => ({
    value: v,
    label: t(`settings.plugins.ttl.${v}`),
  })),
);

async function onInstallZip(): Promise<void> {
  try {
    const res = await window.api.installPluginZip();
    if (!res) return; // canceled
    if (res.ok) toast.success(t("settings.plugins.zipOk", { name: res.id }));
    else
      toast.error(
        t("settings.plugins.installFail", { error: res.error ?? "" }),
      );
  } catch (err) {
    toast.error(t("settings.plugins.installFail", { error: String(err) }));
  } finally {
    await loadMarket(false);
  }
}

// ---- network settings ----
const proxyOptions = computed(() => [
  { value: "system", label: t("settings.network.proxySystem") },
  { value: "env", label: t("settings.network.proxyEnv") },
  { value: "off", label: t("settings.network.proxyOff") },
]);

function onProxyMode(v: string): void {
  void patchSettings({ proxyMode: v as ProxyMode });
}
function onGithubProxy(v: boolean): void {
  void patchSettings({ githubProxy: v });
}
function onGithubProxyHost(v: string): void {
  void patchSettings({ githubProxyHost: v });
}

const proxyLatency = ref<Record<string, PingResult | "testing">>({});
const pinging = ref(false);

function hostOf(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

function ghProxyLatencyText(u: string): string {
  const r = proxyLatency.value[u];
  if (r === "testing") return t("settings.network.pingTesting");
  if (r?.ok) return `${r.ms} ms`;
  if (r && !r.ok) return t("settings.network.pingFail");
  return "";
}

const isCustomProxy = computed(
  () =>
    !(GH_PROXY_PRESETS as readonly string[]).includes(
      settings.settings.githubProxyHost,
    ),
);

function useCustomProxy(): void {
  if (!isCustomProxy.value) onGithubProxyHost("");
}

async function testProxies(): Promise<void> {
  if (pinging.value) return;
  pinging.value = true;
  const targets = new Set<string>(GH_PROXY_PRESETS);
  const custom = settings.settings.githubProxyHost.trim();
  if (custom) targets.add(custom);
  const next: Record<string, PingResult | "testing"> = {
    ...proxyLatency.value,
  };
  for (const u of targets) next[u] = "testing";
  proxyLatency.value = next;
  try {
    await Promise.all(
      [...targets].map(async (u) => {
        const r = await window.api.pingHost(u);
        proxyLatency.value = { ...proxyLatency.value, [u]: r };
      }),
    );
  } finally {
    pinging.value = false;
  }
}

function marketName(v: MarketPluginView): string {
  return v.names[locale.value] || v.displayName || v.id;
}

function marketDesc(v: MarketPluginView): string {
  return v.descriptions[locale.value] || v.description || v.id;
}

const marketCategories = computed<string[]>(() => {
  const set = new Set<string>();
  for (const p of market.value) for (const c of p.categories) set.add(c);
  // Known slugs first, in curated order; unknown slugs after, alphabetically.
  const known = MARKET_CATEGORIES.filter((c) => set.has(c));
  const unknown = [...set]
    .filter((c) => !(MARKET_CATEGORIES as readonly string[]).includes(c))
    .sort();
  return [...known, ...unknown];
});

const marketCategoryCounts = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {};
  for (const p of market.value)
    for (const c of p.categories) counts[c] = (counts[c] ?? 0) + 1;
  return counts;
});

// A category can disappear after a refresh; never leave the filter stranded.
watch(marketCategories, (cats) => {
  if (marketCategory.value && !cats.includes(marketCategory.value))
    marketCategory.value = "";
});

const marketFiltered = computed<MarketPluginView[]>(() => {
  const q = marketQuery.value.trim().toLowerCase();
  const cat = marketCategory.value;
  return market.value.filter((p) => {
    if (cat && !p.categories.includes(cat)) return false;
    if (!q) return true;
    const hay = [
      marketName(p),
      marketDesc(p),
      p.id,
      p.author ?? "",
      ...p.tags,
      ...p.categories,
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
});

function categoryLabel(c: string): string {
  const key = `settings.plugins.cats.${c}`;
  if (te(key)) return t(key);
  // Unknown slug: prettify instead of leaking the raw id.
  return c
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type MarketAction = "install" | "update" | "installed" | "incompatible";

function marketAction(v: MarketPluginView): MarketAction {
  if (!v.compatible) return "incompatible";
  if (v.installedVersion && v.updateAvailable) return "update";
  if (v.installedVersion) return "installed";
  return "install";
}

function progressPhase(p: MarketProgress | undefined): string {
  switch (p?.phase) {
    case "queued":
      return t("settings.plugins.phaseQueued");
    case "download":
      return t("settings.plugins.phaseDownload");
    case "verify":
      return t("settings.plugins.phaseVerify");
    case "extract":
      return t("settings.plugins.phaseExtract");
    default:
      return t("settings.plugins.installing");
  }
}

function progressPercent(p: MarketProgress | undefined): number | null {
  if (!p || p.phase !== "download" || !p.total || p.total <= 0) return null;
  return Math.min(100, Math.round(((p.received ?? 0) / p.total) * 100));
}

async function loadMarket(force: boolean): Promise<void> {
  marketLoading.value = true;
  marketError.value = "";
  try {
    market.value = force
      ? await window.api.marketRefresh()
      : await window.api.marketList();
  } catch (err) {
    marketError.value = String(err instanceof Error ? err.message : err);
  } finally {
    marketLoading.value = false;
  }
}

async function runInstall(v: MarketPluginView): Promise<void> {
  trustFor.value = null;
  marketBusy.value = v.id;
  marketProgress.value = {
    ...marketProgress.value,
    [v.id]: { id: v.id, version: v.latest, phase: "queued" },
  };
  try {
    const res = await window.api.marketInstall(v.id, v.latest);
    if (res.ok) {
      toast.success(t("settings.plugins.installOk", { name: marketName(v) }));
    } else {
      toast.error(
        t("settings.plugins.installFail", { error: res.error ?? "" }),
      );
    }
  } catch (err) {
    toast.error(t("settings.plugins.installFail", { error: String(err) }));
  } finally {
    marketBusy.value = null;
    await loadMarket(false);
  }
}

async function onUninstall(v: MarketPluginView): Promise<void> {
  marketBusy.value = v.id;
  try {
    const ok = await window.api.marketUninstall(v.id);
    if (ok)
      toast.success(t("settings.plugins.uninstallOk", { name: marketName(v) }));
    else toast.error(t("settings.plugins.uninstallFail"));
  } catch {
    toast.error(t("settings.plugins.uninstallFail"));
  } finally {
    marketBusy.value = null;
    await loadMarket(false);
  }
}

let offMarketProgress: (() => void) | null = null;
onMounted(() => {
  offMarketProgress = window.api.onMarketProgress((p) => {
    marketProgress.value = { ...marketProgress.value, [p.id]: p };
    if (p.phase === "error" && p.error) {
      marketError.value = t("settings.plugins.installFail", { error: p.error });
    }
  });
});
onBeforeUnmount(() => {
  offMarketProgress?.();
  offMarketProgress = null;
});

watch(pluginsTab, (tab) => {
  if (tab === "market" && market.value.length === 0 && !marketLoading.value) {
    void loadMarket(false);
  }
});

watch(
  () => settings.settingsOpen,
  (open) => {
    if (!open) return;
    void refreshPlugins();
    void refreshMetronomeFiles();
    if (pluginsTab.value === "market") void loadMarket(false);
  },
);

const closeMode = computed<CloseMode>({
  get: () => settings.settings.closeMode,
  set: (v: CloseMode) => {
    void patchSettings({ closeMode: v });
  },
});

const simpleMode = computed<boolean>({
  get: () => settings.settings.simpleMode,
  set: (v: boolean) => {
    void patchSettings({ simpleMode: v });
  },
});

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

const devEnabled = computed({
  get: () => settings.settings.devEnabled,
  set: (v: boolean) => {
    void patchSettings({ devEnabled: v });
  },
});

const devFreeInput = computed({
  get: () => settings.settings.devFreeInput,
  set: (v: boolean) => {
    void patchSettings({ devFreeInput: v });
  },
});

const logToFile = computed({
  get: () => settings.settings.logToFile,
  set: (v: boolean) => {
    void patchSettings({ logToFile: v });
  },
});

const stretchEngine = computed<string>({
  get: () => settings.settings.stretchEngine,
  set: (v: string) => {
    void patchSettings({ stretchEngine: v as StretchEngine });
  },
});

const stretchEngineOptions = computed<Array<{ value: string; label: string }>>(
  () => [
    { value: "soundtouch", label: t("settings.audio.engineSoundtouch") },
    { value: "signalsmith", label: t("settings.audio.engineSignalsmith") },
  ],
);

const language = computed<string>({
  get: () => locale.value,
  set: (v: string) => {
    setLocale(v === "en" ? "en" : "zh");
    applyAppName();
  },
});

const appName = computed<string>({
  // Empty means "use the localized default"; show that default in the field.
  get: () => settings.settings.appName.trim() || appDisplayName(),
  set: (v) => patchSettings({ appName: v.trim() }),
});

const languageOptions = computed(() =>
  LOCALES.map((l) => ({ value: l.value as string, label: l.label })),
);
const closeModeOptions = computed<Array<{ value: string; label: string }>>(
  () => [
    { value: "ask", label: t("settings.general.modeAsk") },
    { value: "minimize", label: t("settings.general.modeMinimize") },
    { value: "close", label: t("settings.general.modeClose") },
  ],
);

const animEnabled = computed({
  get: () => settings.settings.animEnabled,
  set: (v: boolean) => {
    void patchSettings({ animEnabled: v });
  },
});

const gridAutoHide = computed({
  get: () => settings.settings.gridAutoHide,
  set: (v: boolean) => {
    void patchSettings({ gridAutoHide: v });
  },
});

const uiMotion = computed({
  get: () => settings.settings.uiMotion,
  set: (v: boolean) => {
    void patchSettings({ uiMotion: v });
  },
});

// Page zoom reflows the whole UI (including this panel), so applying it on
// every tick would make the slider jump under the pointer. Hold the value
// locally while dragging and commit once on release.
const uiZoomDraft = ref(settings.settings.uiZoom);
watch(
  () => settings.settings.uiZoom,
  (v) => {
    uiZoomDraft.value = v;
  },
);
function commitUiZoom(v: number): void {
  if (v !== settings.settings.uiZoom) void patchSettings({ uiZoom: v });
}

const uiFontScale = computed({
  get: () => settings.settings.uiFontScale,
  set: (v: number) => {
    void patchSettings({ uiFontScale: v });
  },
});

const uiBlur = computed({
  get: () => settings.settings.uiBlur,
  set: (v: boolean) => {
    void patchSettings({ uiBlur: v });
  },
});

const uiBlurAmount = computed({
  get: () => settings.settings.uiBlurAmount,
  set: (v: number) => {
    void patchSettings({ uiBlurAmount: v });
  },
});

const uiRadius = computed({
  get: () => settings.settings.uiRadius,
  set: (v: number) => {
    void patchSettings({ uiRadius: v });
  },
});

const uiShadow = computed({
  get: () => settings.settings.uiShadow,
  set: (v: number) => {
    void patchSettings({ uiShadow: v });
  },
});

const backgroundImage = computed({
  get: () => settings.settings.backgroundImage,
  set: (v: string) => void patchSettings({ backgroundImage: v }),
});
const backgroundName = computed(() => {
  const p = settings.settings.backgroundImage;
  if (!p) return "";
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
});
const BG_IMAGE_FILTERS = [
  { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] },
];
async function pickBackgroundImage(): Promise<void> {
  const path = await window.api.pickFile(
    t("settings.theme.appearance.bgPick"),
    BG_IMAGE_FILTERS,
  );
  if (path) backgroundImage.value = path;
}
function clearBackgroundImage(): void {
  backgroundImage.value = "";
}
const backgroundFit = computed<string>({
  get: () => settings.settings.backgroundFit,
  set: (v: string) => void patchSettings({ backgroundFit: v as BackgroundFit }),
});
const backgroundFitOptions = computed(() => [
  { value: "cover", label: t("settings.theme.appearance.fitCover") },
  { value: "contain", label: t("settings.theme.appearance.fitContain") },
  { value: "tile", label: t("settings.theme.appearance.fitTile") },
]);
const backgroundBlur = computed({
  get: () => settings.settings.backgroundBlur,
  set: (v: number) => void patchSettings({ backgroundBlur: v }),
});
const backgroundDim = computed({
  get: () => settings.settings.backgroundDim,
  set: (v: number) => void patchSettings({ backgroundDim: v }),
});
const surfaceOpacity = computed({
  get: () => settings.settings.surfaceOpacity,
  set: (v: number) => void patchSettings({ surfaceOpacity: v }),
});

const followScroll = computed({
  get: () => settings.settings.followScroll,
  set: (v: boolean) => {
    void patchSettings({ followScroll: v });
  },
});
const followPercent = computed({
  get: () => settings.settings.followPercent,
  set: (v: number) => {
    void patchSettings({ followPercent: v });
  },
});
const rememberWindow = computed({
  get: () => settings.settings.rememberWindow,
  set: (v: boolean) => {
    void patchSettings({ rememberWindow: v });
  },
});
const showWelcome = computed({
  get: () => settings.settings.showWelcome,
  set: (v: boolean) => {
    void patchSettings({ showWelcome: v });
  },
});
const autoSave = computed({
  get: () => settings.settings.autoSave,
  set: (v: boolean) => {
    void patchSettings({ autoSave: v });
  },
});
const checkUpdates = computed({
  get: () => settings.settings.checkUpdates,
  set: (v: boolean) => {
    void patchSettings({ checkUpdates: v });
  },
});
const autoSaveMinutes = computed({
  get: () => settings.settings.autoSaveMinutes,
  set: (v: number) => {
    void patchSettings({ autoSaveMinutes: v });
  },
});

const ctrlSpeedPlay = computed({
  get: () => settings.settings.ctrlSpeedPlay,
  set: (v: boolean) => {
    void patchSettings({ ctrlSpeedPlay: v });
  },
});

const alignDecimals = computed({
  get: () => settings.settings.alignDecimals,
  set: (v: number) => {
    void patchSettings({ alignDecimals: v });
  },
});

const alignRounding = computed<string>({
  get: () => settings.settings.alignRounding,
  set: (v: string) => {
    void patchSettings({ alignRounding: v as AlignRounding });
  },
});

const alignRoundingOptions = computed<Array<{ value: string; label: string }>>(
  () => [
    { value: "round", label: t("settings.edit.roundRound") },
    { value: "floor", label: t("settings.edit.roundFloor") },
    { value: "ceil", label: t("settings.edit.roundCeil") },
  ],
);

const metronomePath = computed(() => settings.settings.metronomePath);
const metronomeFollowMaster = computed({
  get: () => settings.settings.metronomeFollowMaster,
  set: (v: boolean) => void patchSettings({ metronomeFollowMaster: v }),
});
const metronomeVolume = computed({
  get: () => settings.settings.metronomeVolume,
  set: (v: number) => void patchSettings({ metronomeVolume: v }),
});

const audioAutoBpm = computed({
  get: () => settings.settings.audioAutoBpm,
  set: (v: boolean) => void patchSettings({ audioAutoBpm: v }),
});
const audioAutoBeats = computed({
  get: () => settings.settings.audioAutoBeats,
  set: (v: boolean) => void patchSettings({ audioAutoBeats: v }),
});
const audioLoopDetect = computed({
  get: () => settings.settings.audioLoopDetect,
  set: (v: boolean) => void patchSettings({ audioLoopDetect: v }),
});
const audioLiveBpm = computed({
  get: () => settings.settings.audioLiveBpm,
  set: (v: boolean) => void patchSettings({ audioLiveBpm: v }),
});
const audioSpectrum = computed({
  get: () => settings.settings.audioSpectrum,
  set: (v: boolean) => void patchSettings({ audioSpectrum: v }),
});
const audioPanel = computed({
  get: () => settings.settings.audioPanel,
  set: (v: boolean) => void patchSettings({ audioPanel: v }),
});

// ---- declarative setting rows ----
// Each category's rows are described once here. The template renders them and
// the search index is derived from the same list, so the two cannot drift:
// adding a row here is all it takes to both render and make it searchable.
type ColOption = { value: string; label: string };
type RefLike<T> = { value: T };
type FieldControl =
  | {
      type: "switch";
      get: () => boolean;
      set: (v: boolean) => void;
      disabled?: () => boolean;
    }
  | {
      type: "radio";
      get: () => string;
      set: (v: string) => void;
      options: () => ColOption[];
    }
  | {
      type: "number";
      get: () => number;
      set: (v: number) => void;
      min?: () => number | undefined;
      max?: () => number | undefined;
      step?: number;
      unitKey?: string;
    }
  | {
      type: "slider";
      get: () => number;
      set: (v: number) => void;
      min: number;
      max: number;
      step?: number;
      suffix?: string;
    };
type RowDef =
  | { kind: "subhead"; key: string }
  | { kind: "custom"; id: string; searchKey?: string }
  | {
      kind: "field";
      key: string;
      col?: boolean;
      showIf?: () => boolean;
      /** Hidden while simple mode is on. */
      expert?: boolean;
      control: FieldControl;
    };

const sw = (m: RefLike<boolean>, disabled?: () => boolean): FieldControl => ({
  type: "switch",
  get: () => m.value,
  set: (v) => {
    m.value = v;
  },
  disabled,
});
const radio = (
  m: RefLike<string>,
  options: () => ColOption[],
): FieldControl => ({
  type: "radio",
  get: () => m.value,
  set: (v) => {
    m.value = v;
  },
  options,
});
const num = (
  m: RefLike<number>,
  opts: {
    min?: () => number | undefined;
    max?: () => number | undefined;
    step?: number;
    unitKey?: string;
  } = {},
): FieldControl => ({
  type: "number",
  get: () => m.value,
  set: (v) => {
    m.value = v;
  },
  ...opts,
});
const slider = (
  m: RefLike<number>,
  min: number,
  max: number,
  suffix?: string,
  step?: number,
): FieldControl => ({
  type: "slider",
  get: () => m.value,
  set: (v) => {
    m.value = v;
  },
  min,
  max,
  suffix,
  step,
});

// Typed setters: the discriminated union can't be narrowed inside a template
// event handler, so dispatch through these helpers.
function setSwitch(c: FieldControl, v: boolean): void {
  if (c.type === "switch") c.set(v);
}
function setRadio(c: FieldControl, v: string): void {
  if (c.type === "radio") c.set(v);
}
function setNumber(c: FieldControl, v: number): void {
  if (c.type === "number" || c.type === "slider") c.set(v);
}

/** Dev options gate: fields that only make sense when dev mode is on. */
const devOnly = (): boolean => !devEnabled.value;
const freeMin = (min: number) => (): number | undefined =>
  devFreeInput.value ? undefined : min;
const freeMax = (max: number) => (): number | undefined =>
  devFreeInput.value ? undefined : max;

// Each category is split into sub-groups shown as a second-level tab row. A
// category with a single group renders no tab row (e.g. General). Sub-head rows
// were replaced by these groups so a page no longer needs one long scroll.
type GroupDef = { key: string; rows: RowDef[]; expert?: boolean };

const FIELD_GROUPS: Partial<Record<CatKey, GroupDef[]>> = {
  general: [
    {
      key: "general",
      rows: [
        { kind: "field", key: "simpleMode", control: sw(simpleMode) },
        {
          kind: "field",
          key: "language",
          control: radio(language, () => languageOptions.value),
        },
        {
          kind: "field",
          key: "closeMode",
          control: radio(closeMode, () => closeModeOptions.value),
        },
      ],
    },
    {
      key: "window",
      rows: [
        { kind: "field", key: "showWelcome", control: sw(showWelcome) },
        { kind: "field", key: "rememberWindow", control: sw(rememberWindow) },
        { kind: "field", key: "checkUpdates", control: sw(checkUpdates) },
      ],
    },
  ],
  edit: [
    {
      key: "follow",
      rows: [
        { kind: "field", key: "autoFollow", control: sw(followScroll) },
        {
          kind: "field",
          key: "followPercent",
          col: true,
          showIf: () => followScroll.value,
          expert: true,
          control: slider(followPercent, 0, 100, "%"),
        },
      ],
    },
    {
      key: "playback",
      expert: true,
      rows: [
        { kind: "field", key: "ctrlSpeedPlay", control: sw(ctrlSpeedPlay) },
      ],
    },
    {
      key: "align",
      expert: true,
      rows: [
        {
          kind: "field",
          key: "alignDecimals",
          control: num(alignDecimals, {
            min: freeMin(0),
            max: freeMax(6),
            step: 1,
          }),
        },
        {
          kind: "field",
          key: "alignRounding",
          col: true,
          control: radio(alignRounding, () => alignRoundingOptions.value),
        },
      ],
    },
    {
      key: "autosave",
      rows: [
        { kind: "field", key: "autoSave", control: sw(autoSave) },
        {
          kind: "field",
          key: "autoSaveMinutes",
          col: true,
          showIf: () => autoSave.value,
          control: num(autoSaveMinutes, {
            min: freeMin(1),
            max: freeMax(60),
            step: 1,
            unitKey: "autoSaveMinutesUnit",
          }),
        },
      ],
    },
  ],
  audio: [
    {
      key: "analysis",
      rows: [
        { kind: "custom", id: "audio.tagline" },
        { kind: "field", key: "autoBpm", control: sw(audioAutoBpm) },
        { kind: "field", key: "autoBeats", control: sw(audioAutoBeats) },
        { kind: "field", key: "loopDetect", control: sw(audioLoopDetect) },
        { kind: "field", key: "liveBpm", control: sw(audioLiveBpm) },
        { kind: "field", key: "spectrum", control: sw(audioSpectrum) },
        { kind: "field", key: "panel", control: sw(audioPanel) },
      ],
    },
    {
      key: "metronome",
      rows: [{ kind: "custom", id: "audio.metronome", searchKey: "metronome" }],
    },
    {
      key: "playback",
      expert: true,
      rows: [
        {
          kind: "field",
          key: "stretchEngine",
          col: true,
          control: radio(stretchEngine, () => stretchEngineOptions.value),
        },
      ],
    },
  ],
  display: [
    {
      key: "grid",
      rows: [{ kind: "field", key: "autoHideGrid", control: sw(gridAutoHide) }],
    },
    {
      key: "motion",
      expert: true,
      rows: [
        { kind: "field", key: "editor", control: sw(animEnabled) },
        { kind: "field", key: "uiMotion", control: sw(uiMotion) },
      ],
    },
  ],
  advanced: [
    {
      key: "developer",
      expert: true,
      rows: [
        { kind: "field", key: "master", control: sw(devEnabled) },
        { kind: "field", key: "freeInput", control: sw(devFreeInput, devOnly) },
        { kind: "field", key: "logToFile", control: sw(logToFile, devOnly) },
        { kind: "custom", id: "advanced.devTools", searchKey: "openTools" },
      ],
    },
  ],
  about: [
    {
      key: "about",
      rows: [{ kind: "custom", id: "about.about" }],
    },
  ],
};

/** Categories rendered from FIELD_GROUPS. */
const fieldCats = Object.keys(FIELD_GROUPS) as CatKey[];

function groupsOf(key: CatKey): GroupDef[] {
  const groups = FIELD_GROUPS[key] ?? [];
  return simpleMode.value ? groups.filter((g) => !g.expert) : groups;
}

// Selected sub-tab per category; falls back to the first group when unset.
const subCat = ref<Partial<Record<CatKey, string>>>({});
function activeGroup(key: CatKey): string {
  const groups = groupsOf(key);
  if (!groups.length) return "";
  const cur = subCat.value[key];
  if (cur && groups.some((g) => g.key === cur)) return cur;
  return groups[0]!.key;
}
function setSubCat(key: CatKey, group: string): void {
  subCat.value = { ...subCat.value, [key]: group };
}
function rowsInGroup(key: CatKey): RowDef[] {
  const g = groupsOf(key).find((x) => x.key === activeGroup(key));
  const rows = g?.rows ?? [];
  return simpleMode.value
    ? rows.filter((r) => r.kind !== "field" || !r.expert)
    : rows;
}

// ---- metronome folder picker ----
const metronomeFiles = ref<MetronomeFile[]>([]);
const metronomeLoading = ref(false);

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
  patchSettings({ metronomePath: file });
  // clicking a sound previews it once (the "none" option just clears)
  if (file) previewMetronome();
}

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
  if (!settings.settings.devEnabled) return;
  devOpenBusy.value = true;
  await openDevTools();
  setTimeout(() => {
    devOpenBusy.value = false;
  }, 200);
}

const checkUpdateBusy = ref(false);
async function onCheckUpdates(): Promise<void> {
  checkUpdateBusy.value = true;
  try {
    const res = await window.api.checkForUpdates();
    if (res.status === "update")
      toast.success(
        t("settings.about.updateAvailable", { version: res.version ?? "" }),
      );
    else if (res.status === "current") toast.info(t("settings.about.upToDate"));
    else if (res.status === "unsupported")
      toast.info(t("settings.about.updateUnsupported"));
    else toast.error(t("settings.about.updateError"));
  } finally {
    checkUpdateBusy.value = false;
  }
}

function catLabel(key: string): string {
  return t(`settings.cats.${key}`);
}

// ---- settings search ----
// Index derived from FIELD_GROUPS (plus theme colors), so a row only has to be
// declared once to be both rendered and searchable. Theme color tokens are
// pulled from THEME_TOKEN_ORDER since they are rendered by their own loop.
type SearchEntry = {
  cat: CatKey;
  group?: string;
  key: string;
  keywords?: string[];
  /** Hidden from results while simple mode is on. */
  expert?: boolean;
};

// Extra synonyms per setting (keyed by `${cat}.${key}`) so beginners can find a
// setting with everyday words like “音量 / 加速 / 颜色” instead of its label.
const SEARCH_KEYWORDS: Record<string, string[]> = {
  "general.simpleMode": [
    "简化",
    "简单",
    "基础",
    "进阶",
    "全部",
    "simple",
    "advanced",
  ],
  "general.language": ["语言", "中文", "英文", "界面语言", "language", "lang"],
  "general.closeMode": ["关闭", "退出", "关闭按钮", "close", "exit", "quit"],
  "general.showWelcome": [
    "欢迎",
    "欢迎窗口",
    "启动",
    "welcome",
    "startup",
    "splash",
  ],
  "general.rememberWindow": [
    "窗口",
    "大小",
    "尺寸",
    "位置",
    "window",
    "size",
    "position",
  ],
  "general.checkUpdates": ["更新", "升级", "版本", "update", "upgrade"],
  "edit.autoFollow": ["滚动", "跟随", "scroll", "follow"],
  "edit.followPercent": ["触发位置", "触发点", "百分比", "percent", "trigger"],
  "edit.ctrlSpeedPlay": ["变速", "倍速", "快放", "speed", "playback"],
  "edit.alignDecimals": ["小数", "精度", "decimal", "precision", "align"],
  "edit.alignRounding": ["取整", "舍入", "rounding", "align"],
  "edit.autoSave": ["保存", "自动保存", "save", "autosave"],
  "edit.autoSaveMinutes": ["间隔", "分钟", "interval", "minutes", "save"],
  "audio.autoBpm": ["bpm", "速度", "节拍", "tempo", "detect"],
  "audio.autoBeats": ["节拍", "打点", "标记", "beat", "marker"],
  "audio.loopDetect": ["循环", "loop", "段落"],
  "audio.liveBpm": ["实时", "live", "bpm", "速度"],
  "audio.spectrum": ["频谱", "spectrum", "分析", "梅尔", "mel"],
  "audio.panel": ["面板", "panel", "分析"],
  "audio.metronome": [
    "节拍器",
    "打拍",
    "打拍音",
    "节拍",
    "音量",
    "click",
    "metronome",
  ],
  "audio.stretchEngine": ["变速", "音高", "拉伸", "stretch", "engine", "pitch"],
  "display.autoHideGrid": ["网格", "网格线", "grid", "隐藏", "细线"],
  "display.editor": ["动画", "动效", "时间轴", "editor", "animation", "zoom"],
  "display.uiMotion": [
    "动画",
    "动效",
    "过渡",
    "motion",
    "transition",
    "animation",
  ],
  "theme.appearance.uiZoom": [
    "缩放",
    "界面缩放",
    "整体缩放",
    "大小",
    "zoom",
    "scale",
    "dpi",
  ],
  "theme.appearance.uiFontScale": [
    "字号",
    "字体",
    "文字大小",
    "缩放",
    "font",
    "text",
    "scale",
  ],
  "theme.appearance.uiBlur": ["模糊", "毛玻璃", "blur", "背景"],
  "theme.appearance.uiBlurAmount": [
    "模糊",
    "模糊强度",
    "毛玻璃",
    "blur",
    "radius",
    "强度",
  ],
  "theme.appearance.uiRadius": [
    "圆角",
    "圆角半径",
    "radius",
    "corner",
    "外观",
    "appearance",
  ],
  "theme.appearance.uiShadow": [
    "阴影",
    "投影",
    "立体",
    "shadow",
    "elevation",
    "shadow",
  ],
  "theme.accentPick": ["强调色", "主题色", "高亮色", "accent", "color"],
  "theme.preview": ["预览", "外观预览", "preview", "theme"],
  "advanced.master": ["开发者", "调试", "dev", "debug", "developer"],
  "advanced.freeInput": ["输入", "限制", "上限", "下限", "input", "limit"],
  "advanced.logToFile": ["日志", "记录", "文件", "log", "file"],
  "advanced.openTools": ["调试", "开发者工具", "devtools", "debug", "console"],
  "network.proxy": ["代理", "proxy", "网络", "network"],
  "network.ghProxy": ["github", "加速", "镜像", "下载", "proxy", "ghproxy"],
  "network.ghProxyHost": ["加速地址", "镜像", "地址", "host", "mirror"],
};

// Hand-written entries for sections rendered outside FIELD_GROUPS (their label
// keys live under `settings.network.*`, so the same lookup still works).
const EXTRA_SEARCH: SearchEntry[] = [
  { cat: "network", key: "proxy", expert: true },
  { cat: "network", key: "ghProxy", expert: true },
  { cat: "network", key: "ghProxyHost", expert: true },
  { cat: "theme", key: "accentPick", group: "custom" },
  { cat: "theme", key: "appearance.uiZoom", group: "appearance" },
  { cat: "theme", key: "appearance.uiFontScale", group: "appearance" },
  { cat: "theme", key: "appearance.uiBlur", group: "appearance" },
  {
    cat: "theme",
    key: "appearance.uiBlurAmount",
    group: "appearance",
    expert: true,
  },
  { cat: "theme", key: "appearance.uiRadius", group: "appearance" },
  { cat: "theme", key: "appearance.uiShadow", group: "appearance" },
];

const SEARCH_INDEX: SearchEntry[] = [];
for (const [catKey, groups] of Object.entries(FIELD_GROUPS) as Array<
  [CatKey, GroupDef[]]
>) {
  for (const group of groups) {
    for (const row of group.rows) {
      const expert =
        group.expert === true ||
        (row.kind === "field" && row.expert === true) ||
        undefined;
      if (row.kind === "field")
        SEARCH_INDEX.push({
          cat: catKey,
          group: group.key,
          key: row.key,
          keywords: SEARCH_KEYWORDS[`${catKey}.${row.key}`],
          expert,
        });
      else if (row.kind === "custom" && row.searchKey)
        SEARCH_INDEX.push({
          cat: catKey,
          group: group.key,
          key: row.searchKey,
          keywords: SEARCH_KEYWORDS[`${catKey}.${row.searchKey}`],
          expert,
        });
    }
  }
}
for (const token of THEME_TOKEN_ORDER) {
  SEARCH_INDEX.push({
    cat: "theme",
    group: "custom",
    key: `tokens.${token}`,
    keywords: [token, "颜色", "color"],
  });
}
SEARCH_INDEX.push(...EXTRA_SEARCH);

const search = ref("");
const contentEl = ref<HTMLElement | null>(null);

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
  for (const entry of SEARCH_INDEX) {
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
    themeSub.value = hit.group === "appearance" ? "appearance" : "custom";
  else if (hit.group) setSubCat(hit.cat, hit.group);
  search.value = "";
  void nextTick(() => {
    const rows = contentEl.value?.querySelectorAll(".field-row");
    if (!rows) return;
    for (const row of rows) {
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
        <div class="panel" :class="layout" :style="panelStyle">
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
                v-model="search"
                class="search-input"
                :placeholder="t('settings.searchPlaceholder')"
                :aria-label="t('settings.searchPlaceholder')"
                @keydown.enter.prevent="onSearchEnter()"
                @keydown.esc="search = ''"
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
                ✕
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
                <section v-if="cat === key">
                  <h3>{{ catLabel(key) }}</h3>
                  <nav
                    v-if="groupsOf(key).length > 1"
                    class="subnav"
                    :aria-label="catLabel(key)"
                  >
                    <button
                      v-for="g in groupsOf(key)"
                      :key="g.key"
                      class="subnav-item"
                      :class="{ active: activeGroup(key) === g.key }"
                      @click="setSubCat(key, g.key)"
                    >
                      {{ t(`settings.subcats.${key}.${g.key}`) }}
                    </button>
                  </nav>
                  <template v-for="(row, i) in rowsInGroup(key)" :key="i">
                    <div v-if="row.kind === 'subhead'" class="sub-head">
                      {{ t(`settings.${key}.${row.key}`) }}
                    </div>

                    <p
                      v-else-if="
                        row.kind === 'custom' && row.id === 'audio.tagline'
                      "
                      class="muted audio-tagline"
                    >
                      {{ t("settings.audio.tagline") }}
                    </p>

                    <div
                      v-else-if="
                        row.kind === 'custom' && row.id === 'audio.metronome'
                      "
                      class="metronome-block"
                    >
                      <div class="field-info">
                        <span class="field-name">{{
                          t("settings.audio.metronome")
                        }}</span>
                        <span class="field-desc">{{
                          t("settings.audio.metronomeDesc")
                        }}</span>
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
                        <button
                          type="button"
                          class="metronome-item"
                          :class="{ active: !metronomePath }"
                          @click="selectMetronome('')"
                        >
                          {{ t("settings.audio.metronomeNone") }}
                        </button>
                        <button
                          v-for="f in metronomeFiles"
                          :key="f.file"
                          type="button"
                          class="metronome-item"
                          :class="{ active: metronomePath === f.file }"
                          @click="selectMetronome(f.file)"
                        >
                          {{ f.name }}
                        </button>
                        <p
                          v-if="metronomeFiles.length === 0"
                          class="muted metronome-empty"
                        >
                          {{ t("settings.audio.metronomeEmpty") }}
                        </p>
                      </div>
                      <div class="metronome-volume">
                        <label class="metronome-follow">
                          <UiSwitch
                            :model-value="metronomeFollowMaster"
                            @update:model-value="
                              (v: boolean) => (metronomeFollowMaster = v)
                            "
                          />
                          <span>{{
                            t("settings.audio.metronomeFollowMaster")
                          }}</span>
                        </label>
                        <div v-if="!metronomeFollowMaster" class="pct-row">
                          <UiSlider
                            :model-value="metronomeVolume"
                            :min="0"
                            :max="100"
                            class="pct-slider"
                            @update:model-value="
                              (v: number) => (metronomeVolume = v)
                            "
                          />
                          <span class="num pct-value"
                            >{{ metronomeVolume }}%</span
                          >
                        </div>
                      </div>
                    </div>

                    <div
                      v-else-if="
                        row.kind === 'custom' && row.id === 'advanced.devTools'
                      "
                      class="dev-block"
                      :class="{ off: !devEnabled }"
                    >
                      <UiButton
                        variant="solid"
                        :disabled="!devEnabled"
                        :loading="devOpenBusy"
                        @click="onOpenDevTools()"
                      >
                        {{ t("settings.advanced.openTools") }}
                      </UiButton>
                      <p class="muted">
                        {{ t("settings.advanced.openToolsDesc") }}
                      </p>
                    </div>

                    <template
                      v-else-if="
                        row.kind === 'custom' && row.id === 'about.about'
                      "
                    >
                      <div class="about-card">
                        <div class="about-logo">
                          <Info class="size-8" />
                        </div>
                        <div class="about-info">
                          <UiInput
                            v-model="appName"
                            size="sm"
                            class="about-name-input"
                          />
                          <div class="muted">{{ t("app.hint") }}</div>
                        </div>
                      </div>
                      <div class="about-update">
                        <UiButton
                          variant="solid"
                          size="sm"
                          :loading="checkUpdateBusy"
                          @click="onCheckUpdates()"
                        >
                          {{ t("settings.about.checkUpdates") }}
                        </UiButton>
                        <p class="muted">
                          {{ t("settings.about.checkUpdatesDesc") }}
                        </p>
                      </div>
                      <dl class="about-meta">
                        <dt>{{ t("settings.about.version") }}</dt>
                        <dd>v{{ appVersion }}</dd>
                        <dt>{{ t("settings.about.author") }}</dt>
                        <dd>BUGJI</dd>
                        <dt>{{ t("settings.about.tech") }}</dt>
                        <dd>
                          Electron · Vue 3 · TypeScript · Vite · Pinia ·
                          Tailwind CSS · Reka UI
                        </dd>
                        <dt>{{ t("settings.about.license") }}</dt>
                        <dd>GNU GPL v3</dd>
                        <dt>{{ t("settings.about.runtime") }}</dt>
                        <dd>
                          Node.js {{ runtime.node }} · Chromium
                          {{ runtime.chrome }} · Electron {{ runtime.electron }}
                        </dd>
                      </dl>
                    </template>

                    <template v-else-if="row.kind === 'field'">
                      <div
                        v-if="!row.showIf || row.showIf()"
                        class="field-row"
                        :class="{ col: row.col }"
                      >
                        <div class="field-info">
                          <span class="field-name">{{
                            t(`settings.${key}.${row.key}`)
                          }}</span>
                          <span
                            v-if="te(`settings.${key}.${row.key}Desc`)"
                            class="field-desc"
                            >{{ t(`settings.${key}.${row.key}Desc`) }}</span
                          >
                        </div>

                        <UiSwitch
                          v-if="row.control.type === 'switch'"
                          :model-value="row.control.get()"
                          :disabled="row.control.disabled?.() ?? false"
                          @update:model-value="
                            (v: boolean) => setSwitch(row.control, v)
                          "
                        />
                        <UiRadioGroup
                          v-else-if="row.control.type === 'radio'"
                          :model-value="row.control.get()"
                          :options="row.control.options()"
                          @update:model-value="
                            (v: string) => setRadio(row.control, v)
                          "
                        />
                        <UiNumberInput
                          v-else-if="
                            row.control.type === 'number' &&
                            !row.control.unitKey
                          "
                          :model-value="row.control.get()"
                          :min="row.control.min?.()"
                          :max="row.control.max?.()"
                          :step="row.control.step"
                          class="decimals-input"
                          @update:model-value="
                            (v: number) => setNumber(row.control, v)
                          "
                        />
                        <div
                          v-else-if="row.control.type === 'number'"
                          class="pct-row"
                        >
                          <UiNumberInput
                            :model-value="row.control.get()"
                            :min="row.control.min?.()"
                            :max="row.control.max?.()"
                            :step="row.control.step"
                            @update:model-value="
                              (v: number) => setNumber(row.control, v)
                            "
                          />
                          <span class="muted">{{
                            t(`settings.${key}.${row.control.unitKey}`)
                          }}</span>
                        </div>
                        <div
                          v-else-if="row.control.type === 'slider'"
                          class="pct-row"
                        >
                          <UiSlider
                            :model-value="row.control.get()"
                            :min="row.control.min"
                            :max="row.control.max"
                            :step="row.control.step"
                            class="pct-slider"
                            @update:model-value="
                              (v: number) => setNumber(row.control, v)
                            "
                          />
                          <span class="num pct-value"
                            >{{ row.control.get()
                            }}{{ row.control.suffix }}</span
                          >
                        </div>
                      </div>
                    </template>
                  </template>
                </section>
              </template>

              <!-- 主题 -->
              <section v-if="cat === 'theme'" class="theme-section">
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
                      <div class="sub-head">
                        {{ t("settings.theme.preset") }}
                      </div>
                      <div class="theme-presets">
                        <button
                          v-for="p in THEME_PRESETS"
                          :key="p.id"
                          class="theme-preset"
                          :class="{
                            active: settings.settings.themePreset === p.id,
                          }"
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
                      <div class="sub-head">
                        {{ t("settings.theme.accentPick") }}
                      </div>
                      <div class="accent-pick">
                        <button
                          v-for="c in ACCENT_SWATCHES"
                          :key="c"
                          type="button"
                          class="accent-swatch"
                          :class="{
                            active: themeSpec.accent.toLowerCase() === c,
                          }"
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

                      <div class="sub-head">
                        {{ t("settings.theme.share") }}
                      </div>
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
                      <p class="muted theme-hint">
                        {{ t("settings.theme.hint") }}
                      </p>

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

                      <div
                        v-for="g in themeGroups"
                        :key="g.key"
                        class="theme-card"
                      >
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

                    <template v-else-if="themeSub === 'appearance'">
                      <div class="field-row">
                        <div class="field-info">
                          <span class="field-name">{{
                            t("settings.theme.appearance.bgImage")
                          }}</span>
                          <span class="field-desc">{{
                            t("settings.theme.appearance.bgImageDesc")
                          }}</span>
                        </div>
                        <div class="bg-pick">
                          <span
                            v-if="backgroundName"
                            class="muted bg-name"
                            :title="settings.settings.backgroundImage"
                            >{{ backgroundName }}</span
                          >
                          <UiButton size="sm" @click="pickBackgroundImage()">
                            {{ t("settings.theme.appearance.bgPick") }}
                          </UiButton>
                          <UiButton
                            v-if="settings.settings.backgroundImage"
                            size="sm"
                            variant="soft"
                            @click="clearBackgroundImage()"
                          >
                            {{ t("settings.theme.appearance.bgClear") }}
                          </UiButton>
                        </div>
                      </div>

                      <div
                        v-if="backgroundImageUrl"
                        class="bg-preview"
                        role="img"
                        :aria-label="t('settings.theme.appearance.bgImage')"
                      />

                      <template v-if="settings.settings.backgroundImage">
                        <div class="field-row col">
                          <div class="field-info">
                            <span class="field-name">{{
                              t("settings.theme.appearance.bgFit")
                            }}</span>
                            <span class="field-desc">{{
                              t("settings.theme.appearance.bgFitDesc")
                            }}</span>
                          </div>
                          <UiRadioGroup
                            :model-value="backgroundFit"
                            :options="backgroundFitOptions"
                            @update:model-value="
                              (v: string) => (backgroundFit = v)
                            "
                          />
                        </div>

                        <div class="field-row col">
                          <div class="field-info">
                            <span class="field-name">{{
                              t("settings.theme.appearance.bgBlur")
                            }}</span>
                            <span class="field-desc">{{
                              t("settings.theme.appearance.bgBlurDesc")
                            }}</span>
                          </div>
                          <div class="pct-row">
                            <UiSlider
                              :model-value="backgroundBlur"
                              :min="0"
                              :max="40"
                              class="pct-slider"
                              @update:model-value="
                                (v: number) => (backgroundBlur = v)
                              "
                            />
                            <span class="num pct-value"
                              >{{ backgroundBlur }}px</span
                            >
                          </div>
                        </div>

                        <div class="field-row col">
                          <div class="field-info">
                            <span class="field-name">{{
                              t("settings.theme.appearance.bgDim")
                            }}</span>
                            <span class="field-desc">{{
                              t("settings.theme.appearance.bgDimDesc")
                            }}</span>
                          </div>
                          <div class="pct-row">
                            <UiSlider
                              :model-value="backgroundDim"
                              :min="0"
                              :max="100"
                              class="pct-slider"
                              @update:model-value="
                                (v: number) => (backgroundDim = v)
                              "
                            />
                            <span class="num pct-value"
                              >{{ backgroundDim }}%</span
                            >
                          </div>
                        </div>
                      </template>

                      <div class="field-row col">
                        <div class="field-info">
                          <span class="field-name">{{
                            t("settings.theme.appearance.surfaceOpacity")
                          }}</span>
                          <span class="field-desc">{{
                            t("settings.theme.appearance.surfaceOpacityDesc")
                          }}</span>
                        </div>
                        <div class="pct-row">
                          <UiSlider
                            :model-value="surfaceOpacity"
                            :min="20"
                            :max="100"
                            class="pct-slider"
                            @update:model-value="
                              (v: number) => (surfaceOpacity = v)
                            "
                          />
                          <span class="num pct-value"
                            >{{ surfaceOpacity }}%</span
                          >
                        </div>
                      </div>

                      <div class="field-row col">
                        <div class="field-info">
                          <span class="field-name">{{
                            t("settings.theme.appearance.uiZoom")
                          }}</span>
                          <span class="field-desc">{{
                            t("settings.theme.appearance.uiZoomDesc")
                          }}</span>
                        </div>
                        <div class="pct-row">
                          <UiSlider
                            :model-value="uiZoomDraft"
                            :min="75"
                            :max="150"
                            :step="5"
                            class="pct-slider"
                            @update:model-value="
                              (v: number) => (uiZoomDraft = v)
                            "
                            @commit="commitUiZoom"
                          />
                          <span class="num pct-value">{{ uiZoomDraft }}%</span>
                        </div>
                      </div>

                      <div class="field-row col">
                        <div class="field-info">
                          <span class="field-name">{{
                            t("settings.theme.appearance.uiFontScale")
                          }}</span>
                          <span class="field-desc">{{
                            t("settings.theme.appearance.uiFontScaleDesc")
                          }}</span>
                        </div>
                        <div class="pct-row">
                          <UiSlider
                            :model-value="uiFontScale"
                            :min="85"
                            :max="150"
                            :step="5"
                            class="pct-slider"
                            @update:model-value="
                              (v: number) => (uiFontScale = v)
                            "
                          />
                          <span class="num pct-value">{{ uiFontScale }}%</span>
                        </div>
                      </div>

                      <div class="field-row">
                        <div class="field-info">
                          <span class="field-name">{{
                            t("settings.theme.appearance.uiBlur")
                          }}</span>
                          <span class="field-desc">{{
                            t("settings.theme.appearance.uiBlurDesc")
                          }}</span>
                        </div>
                        <UiSwitch
                          :model-value="uiBlur"
                          @update:model-value="(v: boolean) => (uiBlur = v)"
                        />
                      </div>

                      <div v-if="uiBlur && !simpleMode" class="field-row col">
                        <div class="field-info">
                          <span class="field-name">{{
                            t("settings.theme.appearance.uiBlurAmount")
                          }}</span>
                          <span class="field-desc">{{
                            t("settings.theme.appearance.uiBlurAmountDesc")
                          }}</span>
                        </div>
                        <div class="pct-row">
                          <UiSlider
                            :model-value="uiBlurAmount"
                            :min="0"
                            :max="24"
                            class="pct-slider"
                            @update:model-value="
                              (v: number) => (uiBlurAmount = v)
                            "
                          />
                          <span class="num pct-value"
                            >{{ uiBlurAmount }}px</span
                          >
                        </div>
                      </div>

                      <div class="field-row col">
                        <div class="field-info">
                          <span class="field-name">{{
                            t("settings.theme.appearance.uiRadius")
                          }}</span>
                          <span class="field-desc">{{
                            t("settings.theme.appearance.uiRadiusDesc")
                          }}</span>
                        </div>
                        <div class="pct-row">
                          <UiSlider
                            :model-value="uiRadius"
                            :min="0"
                            :max="20"
                            class="pct-slider"
                            @update:model-value="(v: number) => (uiRadius = v)"
                          />
                          <span class="num pct-value">{{ uiRadius }}px</span>
                        </div>
                      </div>

                      <div class="field-row col">
                        <div class="field-info">
                          <span class="field-name">{{
                            t("settings.theme.appearance.uiShadow")
                          }}</span>
                          <span class="field-desc">{{
                            t("settings.theme.appearance.uiShadowDesc")
                          }}</span>
                        </div>
                        <div class="pct-row">
                          <UiSlider
                            :model-value="uiShadow"
                            :min="0"
                            :max="100"
                            class="pct-slider"
                            @update:model-value="(v: number) => (uiShadow = v)"
                          />
                          <span class="num pct-value">{{ uiShadow }}%</span>
                        </div>
                      </div>
                    </template>
                  </div>

                  <aside class="theme-preview">
                    <div class="sub-head">
                      {{ t("settings.theme.preview") }}
                    </div>
                    <ThemePreview :spec="themeSpec" variant="panel" />
                    <p class="muted theme-hint">
                      {{ t("settings.theme.previewHint") }}
                    </p>
                  </aside>
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

              <!-- 插件 -->
              <section v-if="cat === 'plugins'">
                <h3>{{ t("settings.plugins.title") }}</h3>
                <nav class="subnav">
                  <button
                    class="subnav-item"
                    :class="{ active: pluginsTab === 'installed' }"
                    @click="pluginsTab = 'installed'"
                  >
                    {{ t("settings.plugins.subInstalled") }}
                  </button>
                  <button
                    class="subnav-item"
                    :class="{ active: pluginsTab === 'market' }"
                    @click="pluginsTab = 'market'"
                  >
                    {{ t("settings.plugins.subMarket") }}
                  </button>
                </nav>

                <div v-show="pluginsTab === 'installed'">
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
                    <UiButton size="sm" @click="onInstallZip()">
                      {{ t("settings.plugins.importZip") }}
                    </UiButton>
                  </div>

                  <div v-if="pluginEntries.length === 0" class="plugin-empty">
                    <p>{{ t("settings.plugins.none") }}</p>
                    <p class="muted">{{ t("settings.plugins.noneHint") }}</p>
                  </div>

                  <div
                    v-for="entry in pluginEntries"
                    :key="entry.id"
                    class="plugin-card"
                  >
                    <div class="plugin-main">
                      <div class="plugin-titles">
                        <span class="plugin-name">
                          {{ pluginName(entry) }}
                          <span class="plugin-ver num"
                            >v{{ entry.version }}</span
                          >
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
                        <span v-if="entry.renderer" class="badge"
                          >renderer</span
                        >
                        <UiSwitch
                          :model-value="entry.enabled"
                          :disabled="pluginBusy === entry.id"
                          @update:model-value="() => void onTogglePlugin(entry)"
                        />
                      </div>
                    </div>
                    <div class="plugin-dir num">{{ entry.dir }}</div>
                  </div>
                </div>

                <div v-show="pluginsTab === 'market'">
                  <div class="plugin-tools">
                    <UiButton
                      size="sm"
                      :loading="marketLoading"
                      @click="loadMarket(true)"
                    >
                      {{ t("settings.plugins.marketRefresh") }}
                    </UiButton>
                    <label
                      class="ttl-field"
                      :title="t('settings.plugins.cacheTtlDesc')"
                    >
                      <span class="muted">
                        {{ t("settings.plugins.cacheTtl") }}
                      </span>
                      <nav class="subnav ttl-chips">
                        <button
                          v-for="o in ttlOptions"
                          :key="o.value"
                          type="button"
                          class="subnav-item"
                          :class="{
                            active:
                              settings.settings.marketCacheTtl === o.value,
                          }"
                          @click="marketCacheTtl = o.value"
                        >
                          {{ o.label }}
                        </button>
                      </nav>
                    </label>
                  </div>

                  <div class="market-filters">
                    <UiInput
                      v-model="marketQuery"
                      size="sm"
                      :placeholder="t('settings.plugins.marketSearch')"
                    />
                  </div>
                  <nav
                    v-if="marketCategories.length"
                    class="subnav market-cats"
                  >
                    <button
                      class="subnav-item"
                      :class="{ active: marketCategory === '' }"
                      @click="marketCategory = ''"
                    >
                      {{ t("settings.plugins.marketAll") }}
                      <span class="num">{{ market.length }}</span>
                    </button>
                    <button
                      v-for="c in marketCategories"
                      :key="c"
                      class="subnav-item"
                      :class="{ active: marketCategory === c }"
                      @click="marketCategory = c"
                    >
                      {{ categoryLabel(c) }}
                      <span class="num">{{
                        marketCategoryCounts[c] ?? 0
                      }}</span>
                    </button>
                  </nav>

                  <p v-if="marketError" class="plugin-err">{{ marketError }}</p>

                  <p
                    v-if="!marketLoading && marketFiltered.length === 0"
                    class="plugin-empty"
                  >
                    {{ t("settings.plugins.marketNoMatch") }}
                  </p>

                  <div
                    v-for="p in marketFiltered"
                    :key="p.id"
                    class="plugin-card"
                  >
                    <div class="plugin-main">
                      <div class="plugin-titles">
                        <span class="plugin-name">
                          {{ marketName(p) }}
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
                        <span class="plugin-desc">{{ marketDesc(p) }}</span>
                        <span class="plugin-sub muted">
                          <template v-if="p.author">{{ p.author }}</template>
                          <template v-for="c in p.categories" :key="c">
                            · {{ categoryLabel(c) }}
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
                        <template v-if="marketBusy === p.id">
                          <span class="plugin-ver num">
                            {{ progressPhase(marketProgress[p.id]) }}
                          </span>
                          <div
                            v-if="
                              progressPercent(marketProgress[p.id]) !== null
                            "
                            class="progress-track"
                          >
                            <div
                              class="progress-fill"
                              :style="{
                                width: `${progressPercent(marketProgress[p.id])}%`,
                              }"
                            />
                          </div>
                        </template>
                        <template v-else-if="trustFor === p.id">
                          <UiButton
                            size="sm"
                            variant="solid"
                            @click="runInstall(p)"
                          >
                            {{ t("settings.plugins.trustConfirm") }}
                          </UiButton>
                          <UiButton size="sm" @click="trustFor = null">
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
                            v-else-if="marketAction(p) === 'install'"
                            size="sm"
                            variant="solid"
                            @click="trustFor = p.id"
                          >
                            {{ t("settings.plugins.install") }}
                          </UiButton>
                          <UiButton
                            v-else-if="marketAction(p) === 'update'"
                            size="sm"
                            variant="solid"
                            @click="trustFor = p.id"
                          >
                            {{ t("settings.plugins.update") }}
                          </UiButton>
                          <button
                            v-if="marketAction(p) === 'installed' && p.managed"
                            class="link-btn"
                            @click="onUninstall(p)"
                          >
                            {{ t("settings.plugins.uninstall") }}
                          </button>
                        </template>
                      </div>
                    </div>
                    <div v-if="trustFor === p.id" class="trust-box">
                      <strong>{{ t("settings.plugins.trustTitle") }}</strong>
                      <span>
                        {{
                          t("settings.plugins.trustBody", {
                            name: marketName(p),
                          })
                        }}
                      </span>
                    </div>
                    <div class="plugin-dir num">{{ p.repo || p.id }}</div>
                  </div>
                </div>
              </section>

              <!-- 网络 -->
              <section v-if="cat === 'network'">
                <h3>{{ t("settings.cats.network") }}</h3>

                <template v-if="!simpleMode">
                  <div class="sub-head">{{ t("settings.network.proxy") }}</div>
                  <div class="field-row col">
                    <div class="field-info">
                      <span class="field-name">{{
                        t("settings.network.proxy")
                      }}</span>
                      <span class="field-desc">{{
                        t("settings.network.proxyDesc")
                      }}</span>
                    </div>
                    <UiRadioGroup
                      :model-value="settings.settings.proxyMode"
                      :options="proxyOptions"
                      @update:model-value="onProxyMode"
                    />
                  </div>
                  <p
                    v-if="settings.settings.proxyMode === 'env'"
                    class="field-desc network-note"
                  >
                    {{ t("settings.network.proxyEnvHint") }}
                  </p>
                </template>

                <div class="sub-head">{{ t("settings.network.ghProxy") }}</div>
                <div class="field-row">
                  <div class="field-info">
                    <span class="field-name">{{
                      t("settings.network.ghProxy")
                    }}</span>
                    <span class="field-desc">{{
                      t("settings.network.ghProxyDesc")
                    }}</span>
                  </div>
                  <UiSwitch
                    :model-value="settings.settings.githubProxy"
                    @update:model-value="onGithubProxy"
                  />
                </div>
                <div v-if="settings.settings.githubProxy" class="field-row col">
                  <div class="field-info">
                    <span class="field-name">{{
                      t("settings.network.ghProxyHost")
                    }}</span>
                    <span class="field-desc">{{
                      t("settings.network.ghProxyHostDesc")
                    }}</span>
                  </div>
                  <div class="ghproxy-list">
                    <button
                      v-for="u in GH_PROXY_PRESETS"
                      :key="u"
                      type="button"
                      class="ghproxy-item"
                      :class="{
                        active: settings.settings.githubProxyHost === u,
                      }"
                      @click="onGithubProxyHost(u)"
                    >
                      <span class="ghproxy-host">{{ hostOf(u) }}</span>
                      <span class="ghproxy-ms num">{{
                        ghProxyLatencyText(u)
                      }}</span>
                    </button>
                    <button
                      type="button"
                      class="ghproxy-item"
                      :class="{ active: isCustomProxy }"
                      @click="useCustomProxy()"
                    >
                      <span class="ghproxy-host">{{
                        t("settings.network.ghProxyCustom")
                      }}</span>
                    </button>
                    <UiInput
                      v-if="isCustomProxy"
                      :model-value="settings.settings.githubProxyHost"
                      size="sm"
                      @update:model-value="onGithubProxyHost"
                    />
                    <UiButton
                      size="sm"
                      variant="soft"
                      :loading="pinging"
                      @click="testProxies()"
                    >
                      {{ t("settings.network.ghProxyTest") }}
                    </UiButton>
                  </div>
                </div>
              </section>
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
  z-index: 60;
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
  font-size: calc(13px * var(--bdg-font-scale, 1));
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
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  color: var(--bdg-text-dim);
  border-radius: 5px;
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
  font-size: calc(13px * var(--bdg-font-scale, 1));
}
.search-result:hover {
  background: rgb(var(--bdg-accent-rgb) / 0.12);
}
.search-result mark {
  background: rgb(var(--bdg-accent-rgb) / 0.3);
  color: inherit;
  border-radius: 2px;
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
  font-size: calc(11px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
}
.sr-desc {
  font-size: calc(11px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-empty {
  padding: 16px 18px;
  font-size: calc(12px * var(--bdg-font-scale, 1));
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
  width: 26px;
  height: 26px;
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
  background: none;
  border: none;
  color: var(--bdg-text-dim);
  cursor: pointer;
  font-size: calc(13px * var(--bdg-font-scale, 1));
}
.close-x:hover {
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
  font-size: calc(13px * var(--bdg-font-scale, 1));
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
  font-size: calc(11px * var(--bdg-font-scale, 1));
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
.content h3 {
  margin: 0 0 14px;
  font-size: calc(15px * var(--bdg-font-scale, 1));
}
.content section {
  max-width: 768px;
  margin: 0 auto;
  padding: 0 10px;
}
.panel.drawer .content {
  padding: 14px 16px;
}
.audio-tagline {
  margin: -6px 0 4px;
}
.sub-head {
  margin: 18px 0 2px;
  padding-top: 14px;
  border-top: 1px solid var(--bdg-border);
  font-size: calc(12px * var(--bdg-font-scale, 1));
  font-weight: 700;
  color: var(--bdg-text-dim);
  letter-spacing: 0.04em;
}
.sub-head:first-of-type {
  border-top: none;
}
/* Second-level category tabs (chips) above the grouped rows. */
.subnav {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: -4px 0 16px;
}
.subnav-item {
  border: 1px solid var(--bdg-border);
  background: transparent;
  color: var(--bdg-text-dim);
  padding: 4px 12px;
  border-radius: 999px;
  font-size: calc(12px * var(--bdg-font-scale, 1));
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.subnav-item:hover {
  background: rgb(var(--bdg-neutral) / 0.1);
  color: var(--bdg-text);
}
.subnav-item.active {
  background: rgb(var(--bdg-accent-rgb) / 0.16);
  border-color: transparent;
  color: var(--bdg-accent);
  font-weight: 600;
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
  font-size: calc(12px * var(--bdg-font-scale, 1));
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

.keys-table {
  width: 100%;
  border-collapse: collapse;
}
.keys-table td {
  padding: 7px 4px;
  border-bottom: 1px solid var(--bdg-border);
  font-size: calc(13px * var(--bdg-font-scale, 1));
}
.act {
  color: var(--bdg-text-dim);
}
.keys {
  text-align: right;
}
.kbd {
  display: inline-block;
  background: rgb(var(--bdg-neutral) / 0.12);
  border: 1px solid var(--bdg-border-strong);
  border-bottom-width: 2px;
  border-radius: 5px;
  padding: 1px 8px;
  margin-left: 6px;
  font-family: "Consolas", monospace;
  font-size: calc(11px * var(--bdg-font-scale, 1));
}
.about-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px;
  background: rgb(var(--bdg-accent-rgb) / 0.07);
  border: 1px solid rgb(var(--bdg-accent-rgb) / 0.18);
  border-radius: calc(var(--bdg-radius, 6px) * 2);
}
.about-update {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
}
.about-update p {
  margin: 0;
  font-size: calc(12px * var(--bdg-font-scale, 1));
}
.about-logo {
  font-size: calc(34px * var(--bdg-font-scale, 1));
  color: var(--bdg-accent);
}
.about-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.about-name-input {
  font-size: calc(16px * var(--bdg-font-scale, 1));
  font-weight: 800;
  height: auto;
  padding-left: 0px;
  padding-right: 2px;
  border-color: transparent;
  background: transparent;
  border-radius: 4px;
  cursor: text;
}
.about-name-input:focus {
  border-color: var(--bdg-accent);
  background: rgb(var(--bdg-accent-rgb) / 0.08);
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
  font-size: calc(12px * var(--bdg-font-scale, 1));
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
  font-size: calc(11px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
}
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
.bg-pick {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.bg-pick .bg-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: calc(12px * var(--bdg-font-scale, 1));
}
/* Mirrors the real `.app-bg` layer so the thumbnail follows the fill mode
   (and any future background treatment) without duplicating logic. */
.bg-preview {
  height: 160px;
  margin: -4px 0 12px;
  border-radius: var(--bdg-radius, 6px);
  border: 1px solid var(--bdg-border);
  background-color: var(--bdg-bg);
  background-image: var(--bdg-bg-image, none);
  background-position: center;
  background-size: var(--bdg-bg-size, cover);
  background-repeat: var(--bdg-bg-repeat, no-repeat);
}
/* Keep settings button labels from breaking mid-word (notably CJK). */
.panel button {
  word-break: keep-all;
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
.ghproxy-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  max-width: 440px;
}
.ghproxy-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 10px;
  border: 1px solid var(--bdg-border);
  border-radius: var(--bdg-radius-ui, 6px);
  background: transparent;
  color: var(--bdg-text);
  font-family: inherit;
  font-size: calc(12px * var(--bdg-font-scale, 1));
  cursor: pointer;
  text-align: left;
}
.ghproxy-item:hover {
  background: rgb(var(--bdg-neutral) / 0.1);
}
.ghproxy-item.active {
  border-color: rgb(var(--bdg-accent-rgb) / 0.5);
  background: rgb(var(--bdg-accent-rgb) / 0.12);
  color: var(--bdg-accent);
  font-weight: 600;
}
.ghproxy-host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ghproxy-ms {
  flex: none;
  font-size: calc(11px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
}
.ghproxy-item.active .ghproxy-ms {
  color: var(--bdg-accent);
}
.network-note {
  margin: -6px 0 6px;
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
}
.pct-value {
  font-size: calc(12px * var(--bdg-font-scale, 1));
  min-width: 34px;
  text-align: right;
  color: var(--bdg-accent);
}
.decimals-input {
  width: 84px;
  flex: none;
}
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
.metronome-item {
  border: 1px solid var(--bdg-border);
  background: transparent;
  color: var(--bdg-text);
  padding: 5px 12px;
  border-radius: var(--bdg-radius, 6px);
  font-size: calc(12px * var(--bdg-font-scale, 1));
  font-family: inherit;
  cursor: pointer;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  font-size: calc(12px * var(--bdg-font-scale, 1));
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
  font-size: calc(12px * var(--bdg-font-scale, 1));
  color: var(--bdg-text-dim);
  cursor: pointer;
}
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
  font-size: calc(12px * var(--bdg-font-scale, 1));
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
  font-size: calc(10px * var(--bdg-font-scale, 1));
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
  font-size: calc(12px * var(--bdg-font-scale, 1));
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
  font-size: calc(12px * var(--bdg-font-scale, 1));
  font-weight: 700;
  color: var(--bdg-text);
  letter-spacing: 0.03em;
}
.theme-card-swatches {
  display: inline-flex;
  border-radius: 4px;
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
  border-radius: 5px;
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
  font-size: calc(13px * var(--bdg-font-scale, 1));
  opacity: 0.25;
  padding: 0 2px;
}
.theme-token-reset.on {
  opacity: 1;
  color: var(--bdg-accent);
}
</style>
