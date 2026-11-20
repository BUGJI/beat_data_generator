import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { useSettingsStore } from "../../stores/settings";
import { applyAppName } from "../../services/settingsEffects";
import { patchSettings } from "../../services/settingsPersistence";
import { i18n, isLocale, LOCALES, setLocale } from "../../i18n";
import { THEME_PRESETS, THEME_TOKEN_ORDER } from "../../theme";
import type { SettingsData } from "@shared/settings";
import type { CatKey, GroupDef, RowDef, SearchEntry } from "./types";
import { EXTRA_SEARCH, SEARCH_KEYWORDS } from "./searchKeywords";
import { buildFieldGroups } from "./rowDefinitions";

export type { SearchEntry } from "./types";

/**
 * The declarative settings model: every category's rows are described once here,
 * and the search index is derived from the same list, so a row can never be
 * rendered without also being searchable (and vice versa).
 *
 * It is a Pinia store so the modal shell and the extracted category section
 * share one instance of the sub-tab state and the row definitions.
 */

const t = i18n.global.t.bind(i18n.global);

export const useSettingsRowsStore = defineStore("settingsRows", () => {
  const settings = useSettingsStore();

  /**
   * Two-way binding for one settings field. Every plain field used to have its
   * own identical `computed({ get, set: patchSettings })` block; this helper is
   * type-safe on the key and keeps the store's setup short.
   */
  function settingModel<K extends keyof SettingsData>(key: K) {
    return computed<SettingsData[K]>({
      get: () => settings.settings[key],
      set: (value) => {
        void patchSettings({ [key]: value } as Partial<SettingsData>);
      },
    });
  }

  const simpleMode = settingModel("simpleMode");
  const devEnabled = settingModel("devEnabled");
  const devFreeInput = settingModel("devFreeInput");
  const logToFile = settingModel("logToFile");
  const stretchEngine = settingModel("stretchEngine");
  const stretchCacheMb = settingModel("stretchCacheMb");
  const closeMode = settingModel("closeMode");
  const animEnabled = settingModel("animEnabled");
  const gridAutoHide = settingModel("gridAutoHide");
  const bpmSegmentColors = settingModel("bpmSegmentColors");
  const bpmSegmentIntensity = settingModel("bpmSegmentIntensity");
  const quickBarLabels = settingModel("quickBarLabels");
  const uiMotion = settingModel("uiMotion");
  const followScroll = settingModel("followScroll");
  const followPercent = settingModel("followPercent");
  const rememberWindow = settingModel("rememberWindow");
  const showWelcome = settingModel("showWelcome");
  const autoSave = settingModel("autoSave");
  const checkUpdates = settingModel("checkUpdates");
  const autoSaveMinutes = settingModel("autoSaveMinutes");
  const ctrlSpeedPlay = settingModel("ctrlSpeedPlay");
  const countInBars = settingModel("countInBars");
  const gridMetronome = settingModel("gridMetronome");
  const alignDecimals = settingModel("alignDecimals");
  const alignRounding = settingModel("alignRounding");
  const audioAutoBpm = settingModel("audioAutoBpm");
  const audioAutoBeats = settingModel("audioAutoBeats");
  const audioLoopDetect = settingModel("audioLoopDetect");
  const audioLiveBpm = settingModel("audioLiveBpm");
  const audioSpectrum = settingModel("audioSpectrum");
  const audioPanel = settingModel("audioPanel");
  const analysisWindowMinutes = settingModel("analysisWindowMinutes");

  const stretchEngineOptions = computed<
    Array<{ value: string; label: string }>
  >(() => [
    { value: "soundtouch", label: t("settings.audio.engineSoundtouch") },
    { value: "signalsmith", label: t("settings.audio.engineSignalsmith") },
  ]);

  /** One-line tip for the currently selected time-stretch engine. */
  const stretchEngineHint = (): string =>
    t(
      stretchEngine.value === "signalsmith"
        ? "settings.audio.engineSignalsmithHint"
        : "settings.audio.engineSoundtouchHint",
    );

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

  /** Behavior tip for the selected window-close mode. */
  const closeModeHint = (): string =>
    t(
      closeMode.value === "minimize"
        ? "settings.general.modeMinimizeHint"
        : closeMode.value === "close"
          ? "settings.general.modeCloseHint"
          : "settings.general.modeAskHint",
    );

  const alignRoundingOptions = computed<
    Array<{ value: string; label: string }>
  >(() => [
    { value: "round", label: t("settings.edit.roundRound") },
    { value: "floor", label: t("settings.edit.roundFloor") },
    { value: "ceil", label: t("settings.edit.roundCeil") },
  ]);

  // A concrete worked example so the rounding mode + precision are legible at a
  // glance, e.g. `1.3765 → 1.38`.
  const ROUND_SAMPLE = 1.3765;
  const alignRoundingHint = (): string => {
    const d = alignDecimals.value;
    const f = 10 ** d;
    const mode = alignRounding.value;
    const r =
      mode === "floor"
        ? Math.floor(ROUND_SAMPLE * f) / f
        : mode === "ceil"
          ? Math.ceil(ROUND_SAMPLE * f) / f
          : Math.round(ROUND_SAMPLE * f) / f;
    return t("settings.edit.roundExample", {
      from: ROUND_SAMPLE.toFixed(4),
      to: r.toFixed(d),
    });
  };

  /** Dev options gate: fields that only make sense when dev mode is on. */
  const devOnly = (): boolean => !devEnabled.value;
  const freeMin = (min: number) => (): number | undefined =>
    devFreeInput.value ? undefined : min;
  const freeMax = (max: number) => (): number | undefined =>
    devFreeInput.value ? undefined : max;

  const FIELD_GROUPS = buildFieldGroups({
    simpleMode,
    language,
    languageOptions,
    closeMode,
    closeModeOptions,
    closeModeHint,
    showWelcome,
    rememberWindow,
    checkUpdates,
    followScroll,
    followPercent,
    ctrlSpeedPlay,
    countInBars,
    gridMetronome,
    alignDecimals,
    alignRounding,
    alignRoundingOptions,
    alignRoundingHint,
    autoSave,
    autoSaveMinutes,
    audioAutoBpm,
    audioAutoBeats,
    audioLoopDetect,
    audioLiveBpm,
    audioSpectrum,
    audioPanel,
    analysisWindowMinutes,
    stretchEngine,
    stretchEngineOptions,
    stretchEngineHint,
    stretchCacheMb,
    gridAutoHide,
    bpmSegmentColors,
    bpmSegmentIntensity,
    quickBarLabels,
    animEnabled,
    uiMotion,
    devEnabled,
    devFreeInput,
    logToFile,
    devOnly,
    freeMin,
    freeMax,
  });

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
  // Preset names are searchable too, so users can jump straight to a theme.
  for (const preset of THEME_PRESETS) {
    searchIndex.push({
      cat: "theme",
      group: "preset",
      key: `presets.${preset.id}`,
      keywords: ["主题", "预设", "theme", "preset", preset.name],
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
    stretchCacheMb,
    language,
    animEnabled,
    gridAutoHide,
    bpmSegmentColors,
    bpmSegmentIntensity,
    followScroll,
    followPercent,
    rememberWindow,
    showWelcome,
    autoSave,
    autoSaveMinutes,
    checkUpdates,
    ctrlSpeedPlay,
    countInBars,
    gridMetronome,
    alignDecimals,
    alignRounding,
    audioAutoBpm,
    audioAutoBeats,
    audioLoopDetect,
    audioLiveBpm,
    audioSpectrum,
    audioPanel,
    analysisWindowMinutes,
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
