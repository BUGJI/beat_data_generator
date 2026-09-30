import { computed, ref } from "vue";
import { defineStore } from "pinia";
import {
  applyAppName,
  patchSettings,
  useSettingsStore,
} from "../../stores/settings";
import { i18n, isLocale, LOCALES, setLocale } from "../../i18n";
import { THEME_TOKEN_ORDER } from "../../theme";
import type { CloseMode } from "@shared/ipc";
import type { AlignRounding, StretchEngine } from "@shared/settings";
import {
  num,
  radio,
  slider,
  sw,
  type CatKey,
  type GroupDef,
  type RowDef,
} from "./types";

/**
 * The declarative settings model: every category's rows are described once here,
 * and the search index is derived from the same list, so a row can never be
 * rendered without also being searchable (and vice versa).
 *
 * It is a Pinia store so the modal shell and the extracted category section
 * share one instance of the sub-tab state and the row definitions.
 */

const t = i18n.global.t.bind(i18n.global);

export type SearchEntry = {
  cat: CatKey;
  group?: string;
  key: string;
  keywords?: string[];
  /** Hidden from results while simple mode is on. */
  expert?: boolean;
};

// Extra synonyms per setting (keyed by `${cat}.${key}`) so beginners can find a
// setting with everyday words like "音量 / 加速 / 颜色" instead of its label.
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

export const useSettingsRowsStore = defineStore("settingsRows", () => {
  const settings = useSettingsStore();

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

  const stretchEngineOptions = computed<
    Array<{ value: string; label: string }>
  >(() => [
    { value: "soundtouch", label: t("settings.audio.engineSoundtouch") },
    { value: "signalsmith", label: t("settings.audio.engineSignalsmith") },
  ]);

  const language = computed<string>({
    get: () => i18n.global.locale.value,
    set: (v: string) => {
      const loc = isLocale(v) ? v : "en";
      setLocale(loc);
      // persist so the main process dialogs and the welcome window follow too
      void patchSettings({ locale: loc });
      applyAppName();
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

  const alignRoundingOptions = computed<
    Array<{ value: string; label: string }>
  >(() => [
    { value: "round", label: t("settings.edit.roundRound") },
    { value: "floor", label: t("settings.edit.roundFloor") },
    { value: "ceil", label: t("settings.edit.roundCeil") },
  ]);

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

  /** Dev options gate: fields that only make sense when dev mode is on. */
  const devOnly = (): boolean => !devEnabled.value;
  const freeMin = (min: number) => (): number | undefined =>
    devFreeInput.value ? undefined : min;
  const freeMax = (max: number) => (): number | undefined =>
    devFreeInput.value ? undefined : max;

  // Each category is split into sub-groups shown as a second-level tab row. A
  // category with a single group renders no tab row (e.g. General).
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
        rows: [
          { kind: "custom", id: "audio.metronome", searchKey: "metronome" },
        ],
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
        rows: [
          { kind: "field", key: "autoHideGrid", control: sw(gridAutoHide) },
        ],
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
          {
            kind: "field",
            key: "freeInput",
            control: sw(devFreeInput, devOnly),
          },
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

  // Theme page sub-tab, shared so the settings search can jump into it.
  const themeSub = ref<"preset" | "custom" | "appearance">("preset");

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

  // ---- search index ----
  const searchIndex: SearchEntry[] = [];
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
          searchIndex.push({
            cat: catKey,
            group: group.key,
            key: row.key,
            keywords: SEARCH_KEYWORDS[`${catKey}.${row.key}`],
            expert,
          });
        else if (row.kind === "custom" && row.searchKey)
          searchIndex.push({
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
    searchIndex.push({
      cat: "theme",
      group: "custom",
      key: `tokens.${token}`,
      keywords: [token, "颜色", "color"],
    });
  }
  searchIndex.push(...EXTRA_SEARCH);

  return {
    // reactive field bindings
    simpleMode,
    uiMotion,
    devEnabled,
    closeMode,
    devFreeInput,
    logToFile,
    stretchEngine,
    language,
    animEnabled,
    gridAutoHide,
    followScroll,
    followPercent,
    rememberWindow,
    showWelcome,
    autoSave,
    autoSaveMinutes,
    checkUpdates,
    ctrlSpeedPlay,
    alignDecimals,
    alignRounding,
    audioAutoBpm,
    audioAutoBeats,
    audioLoopDetect,
    audioLiveBpm,
    audioSpectrum,
    audioPanel,
    // row navigation
    fieldCats,
    groupsOf,
    activeGroup,
    setSubCat,
    rowsInGroup,
    themeSub,
    // search
    searchIndex,
  };
});
