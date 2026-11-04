import {
  num,
  radio,
  slider,
  sw,
  type CatKey,
  type ColOption,
  type GroupDef,
  type RefLike,
} from "./types";

/** Reactive bindings the declarative row definitions read and write. */
export interface SettingsRowBindings {
  simpleMode: RefLike<boolean>;
  language: RefLike<string>;
  languageOptions: RefLike<ColOption[]>;
  closeMode: RefLike<string>;
  closeModeOptions: RefLike<ColOption[]>;
  closeModeHint: () => string;
  showWelcome: RefLike<boolean>;
  rememberWindow: RefLike<boolean>;
  checkUpdates: RefLike<boolean>;
  followScroll: RefLike<boolean>;
  followPercent: RefLike<number>;
  ctrlSpeedPlay: RefLike<boolean>;
  alignDecimals: RefLike<number>;
  alignRounding: RefLike<string>;
  alignRoundingOptions: RefLike<ColOption[]>;
  alignRoundingHint: () => string;
  autoSave: RefLike<boolean>;
  autoSaveMinutes: RefLike<number>;
  audioAutoBpm: RefLike<boolean>;
  audioAutoBeats: RefLike<boolean>;
  audioLoopDetect: RefLike<boolean>;
  audioLiveBpm: RefLike<boolean>;
  audioSpectrum: RefLike<boolean>;
  audioPanel: RefLike<boolean>;
  analysisWindowMinutes: RefLike<number>;
  stretchEngine: RefLike<string>;
  stretchEngineOptions: RefLike<ColOption[]>;
  stretchEngineHint: () => string;
  gridAutoHide: RefLike<boolean>;
  animEnabled: RefLike<boolean>;
  uiMotion: RefLike<boolean>;
  devEnabled: RefLike<boolean>;
  devFreeInput: RefLike<boolean>;
  logToFile: RefLike<boolean>;
  devOnly: () => boolean;
  freeMin: (min: number) => () => number | undefined;
  freeMax: (max: number) => () => number | undefined;
}

/**
 * Every category is described once as a list of groups of rows. The settings
 * modal renders these and the search index is derived from the same list, so a
 * row can never be rendered without also being searchable (and vice versa).
 */
export function buildFieldGroups(
  bindings: SettingsRowBindings,
): Partial<Record<CatKey, GroupDef[]>> {
  const {
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
    gridAutoHide,
    animEnabled,
    uiMotion,
    devEnabled,
    devFreeInput,
    logToFile,
    devOnly,
    freeMin,
    freeMax,
  } = bindings;

  // A category with a single group renders no second-level tab row.
  return {
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
            control: radio(
              closeMode,
              () => closeModeOptions.value,
              closeModeHint,
            ),
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
            control: radio(
              alignRounding,
              () => alignRoundingOptions.value,
              alignRoundingHint,
            ),
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
          {
            kind: "field",
            key: "analysisWindowMinutes",
            col: true,
            expert: true,
            control: num(analysisWindowMinutes, {
              min: freeMin(1),
              max: freeMax(60),
              step: 1,
              unitKey: "analysisWindowMinutesUnit",
            }),
          },
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
            control: radio(
              stretchEngine,
              () => stretchEngineOptions.value,
              stretchEngineHint,
            ),
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
}
