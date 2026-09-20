<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Maximize, Minimize, Search, X } from "@lucide/vue";
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
} from "../store";
import { setLocale, LOCALES } from "../i18n";
import { toast } from "../ui/toast";
import {
  THEME_PRESETS,
  THEME_TOKEN_ORDER,
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
import type { CloseMode, MetronomeFile } from "../../../shared/ipc";
import type { AlignRounding, StretchEngine } from "../../../shared/settings";
import { useSettingsStore } from "../stores/settings";
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
  | "advanced"
  | "about";

const cats: Array<{ key: CatKey; icon: string }> = [
  { key: "general", icon: "⚙" },
  { key: "edit", icon: "✎" },
  { key: "audio", icon: "♪" },
  { key: "display", icon: "◩" },
  { key: "theme", icon: "◐" },
  { key: "shortcuts", icon: "⌨" },
  { key: "plugins", icon: "▤" },
  { key: "advanced", icon: "⬢" },
  { key: "about", icon: "◈" },
];

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
const themeSub = ref<"preset" | "custom">("preset");
const themeSubs = computed<Array<{ key: "preset" | "custom"; label: string }>>(
  () => [
    { key: "preset", label: t("settings.theme.subs.preset") },
    { key: "custom", label: t("settings.theme.subs.custom") },
  ],
);

const contrastIssues = computed(() => themeContrastIssues(themeSpec.value));

function onThemeToken(token: keyof ThemeSpec, value: string | null): void {
  setThemeToken(token, value ?? "");
}
function tokenOverridden(token: keyof ThemeSpec): boolean {
  return themeOverrides.value[token] != null;
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

watch(
  () => settings.settingsOpen,
  (open) => {
    if (!open) return;
    void refreshPlugins();
    void refreshMetronomeFiles();
  },
);

const closeMode = computed<CloseMode>({
  get: () => settings.settings.closeMode,
  set: (v: CloseMode) => {
    void patchSettings({ closeMode: v });
  },
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
  },
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

const uiBlur = computed({
  get: () => settings.settings.uiBlur,
  set: (v: boolean) => {
    void patchSettings({ uiBlur: v });
  },
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
): FieldControl => ({
  type: "slider",
  get: () => m.value,
  set: (v) => {
    m.value = v;
  },
  min,
  max,
  suffix,
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
type GroupDef = { key: string; rows: RowDef[] };

const FIELD_GROUPS: Partial<Record<CatKey, GroupDef[]>> = {
  general: [
    {
      key: "general",
      rows: [
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
          control: slider(followPercent, 0, 100, "%"),
        },
      ],
    },
    {
      key: "playback",
      rows: [
        { kind: "field", key: "ctrlSpeedPlay", control: sw(ctrlSpeedPlay) },
      ],
    },
    {
      key: "align",
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
      rows: [
        { kind: "field", key: "editor", control: sw(animEnabled) },
        { kind: "field", key: "uiMotion", control: sw(uiMotion) },
      ],
    },
    {
      key: "appearance",
      rows: [{ kind: "field", key: "uiBlur", control: sw(uiBlur) }],
    },
  ],
  advanced: [
    {
      key: "window",
      rows: [
        { kind: "field", key: "rememberWindow", control: sw(rememberWindow) },
        { kind: "field", key: "checkUpdates", control: sw(checkUpdates) },
      ],
    },
    {
      key: "developer",
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
  return FIELD_GROUPS[key] ?? [];
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
  return g?.rows ?? [];
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
type SearchEntry = { cat: CatKey; group?: string; key: string };
const SEARCH_INDEX: SearchEntry[] = [];
for (const [catKey, groups] of Object.entries(FIELD_GROUPS) as Array<
  [CatKey, GroupDef[]]
>) {
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.kind === "field")
        SEARCH_INDEX.push({ cat: catKey, group: group.key, key: row.key });
      else if (row.kind === "custom" && row.searchKey)
        SEARCH_INDEX.push({
          cat: catKey,
          group: group.key,
          key: row.searchKey,
        });
    }
  }
}
for (const token of THEME_TOKEN_ORDER) {
  SEARCH_INDEX.push({ cat: "theme", group: "custom", key: `tokens.${token}` });
}

const search = ref("");
const contentEl = ref<HTMLElement | null>(null);

function labelKeyOf(entry: SearchEntry): string {
  return `settings.${entry.cat}.${entry.key}`;
}

const searchResults = computed<
  Array<SearchEntry & { label: string; desc: string }>
>(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return [];
  const hits: Array<SearchEntry & { label: string; desc: string }> = [];
  for (const entry of SEARCH_INDEX) {
    const key = labelKeyOf(entry);
    const label = t(key);
    const descKey = `${key}Desc`;
    const desc = te(descKey) ? t(descKey) : "";
    if (
      label.toLowerCase().includes(q) ||
      desc.toLowerCase().includes(q) ||
      catLabel(entry.cat).toLowerCase().includes(q)
    ) {
      hits.push({ ...entry, label, desc });
    }
  }
  return hits;
});

function goToSetting(hit: SearchEntry & { label: string }): void {
  cat.value = hit.cat;
  if (hit.cat === "theme") themeSub.value = "custom";
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
            <div class="search">
              <Search class="search-icon size-3.5" />
              <input
                v-model="search"
                class="search-input"
                :placeholder="t('settings.searchPlaceholder')"
                @keydown.enter.prevent="onSearchEnter()"
                @keydown.esc="search = ''"
              />
              <button
                v-if="search"
                class="search-clear"
                :title="t('settings.searchClear')"
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
                @click="toggleLayout()"
              >
                <Minimize v-if="layout === 'full'" class="size-3.5" />
                <Maximize v-else class="size-3.5" />
              </button>
              <button class="close-x" @click="setSettingsOpen(false)">✕</button>
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
                <span class="sr-label">{{ hit.label }}</span>
                <span class="sr-cat">{{ catLabel(hit.cat) }}</span>
              </button>
              <div v-if="searchResults.length === 0" class="search-empty">
                {{ t("settings.searchNoResults") }}
              </div>
            </div>

            <nav class="nav">
              <button
                v-for="c in cats"
                :key="c.key"
                class="nav-item"
                :class="{ active: cat === c.key }"
                @click="cat = c.key"
              >
                <span class="nav-icon">{{ c.icon }}</span>
                <span class="nav-label">{{ catLabel(c.key) }}</span>
              </button>
            </nav>

            <main ref="contentEl" class="content">
              <!-- 由 FIELD_GROUPS 声明的分类 -->
              <template v-for="key in fieldCats" :key="key">
                <section v-if="cat === key">
                  <h3>{{ catLabel(key) }}</h3>
                  <nav v-if="groupsOf(key).length > 1" class="subnav">
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
                        <div class="about-logo">◈</div>
                        <div>
                          <div class="about-name">{{ t("app.name") }}</div>
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
              <section v-if="cat === 'theme'">
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

                <template v-if="themeSub === 'preset'">
                  <div class="sub-head">{{ t("settings.theme.preset") }}</div>
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
                      <span class="swatches">
                        <i :style="{ background: p.spec.bg }" />
                        <i :style="{ background: p.spec.panel }" />
                        <i :style="{ background: p.spec.accent }" />
                        <i :style="{ background: p.spec.accent2 }" />
                      </span>
                      {{ t(`settings.theme.presets.${p.name}`) }}
                    </button>
                  </div>
                </template>

                <template v-else-if="themeSub === 'custom'">
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

                  <div
                    v-for="g in themeGroups"
                    :key="g.key"
                    class="theme-group"
                  >
                    <div class="theme-group-title">
                      {{ t(`settings.theme.groups.${g.key}`) }}
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
                          @click="onThemeToken(token, null)"
                        >
                          ↺
                        </button>
                      </div>
                    </div>
                  </div>
                </template>
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
                      <UiSwitch
                        :model-value="entry.enabled"
                        :disabled="pluginBusy === entry.id"
                        @update:model-value="() => void onTogglePlugin(entry)"
                      />
                    </div>
                  </div>
                  <div class="plugin-dir num">{{ entry.dir }}</div>
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
  border-radius: 12px;
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
  border-radius: 8px;
  border: 1px solid var(--bdg-border);
  background: var(--bdg-bg-sunken);
  color: var(--bdg-text);
  font-size: 13px;
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
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 10px 18px;
  border: none;
  background: none;
  color: var(--bdg-text);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: 13px;
}
.search-result:hover {
  background: rgb(var(--bdg-accent-rgb) / 0.12);
}
.sr-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sr-cat {
  flex: none;
  font-size: 11px;
  color: var(--bdg-text-dim);
}
.search-empty {
  padding: 16px 18px;
  font-size: 12px;
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
  border-radius: 6px;
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
  font-size: 13px;
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
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
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
  font-size: 12px;
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
  font-size: 12px;
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
  background: rgb(var(--bdg-neutral) / 0.12);
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
  background: rgb(var(--bdg-accent-rgb) / 0.07);
  border: 1px solid rgb(var(--bdg-accent-rgb) / 0.18);
  border-radius: 10px;
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
  font-size: 12px;
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
  background: rgb(var(--bdg-accent-rgb) / 0.12);
  border: 1px solid rgb(var(--bdg-accent-rgb) / 0.22);
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
}
.pct-value {
  font-size: 12px;
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
  border-radius: 8px;
  font-size: 12px;
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
  font-size: 12px;
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
  font-size: 12px;
  color: var(--bdg-text-dim);
  cursor: pointer;
}
.theme-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.theme-preset {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--bdg-bg-raised);
  border: 1px solid var(--bdg-border);
  color: var(--bdg-text);
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}
.theme-preset:hover {
  border-color: var(--bdg-border-strong);
}
.theme-preset.active {
  border-color: var(--bdg-accent);
  background: rgb(var(--bdg-accent-rgb) / 0.12);
  color: var(--bdg-accent);
}
.swatches {
  display: inline-flex;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--bdg-border-strong);
}
.swatches i {
  width: 11px;
  height: 11px;
  display: block;
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
  border-radius: 8px;
  padding: 8px 10px;
  margin: 0 0 10px;
  font-size: 12px;
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
.theme-group {
  margin-bottom: 6px;
}
.theme-group-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--bdg-text-dim);
  margin: 10px 0 2px;
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
  font-size: 13px;
  opacity: 0.25;
  padding: 0 2px;
}
.theme-token-reset.on {
  opacity: 1;
  color: var(--bdg-accent);
}
</style>
