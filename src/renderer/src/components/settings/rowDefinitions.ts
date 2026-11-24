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
  countInBars: RefLike<number>;
  gridMetronome: RefLike<boolean>;
  beatOverlap: RefLike<string>;
  beatOverlapOptions: RefLike<ColOption[]>;
  beatOverlapHint: () => string;
  beatAccent: RefLike<boolean>;
  beatAccentGain: RefLike<number>;
  outputProtection: RefLike<boolean>;
  alignDecimals: RefLike<number>;
  alignRounding: RefLike<string>;
  alignRoundingOptions: RefLike<ColOption[]>;
  alignRoundingHint: () => string;
  autoSave: RefLike<boolean>;
  autoSaveMinutes: RefLike<number>;
  defaultGridDiv: RefLike<number>;
  snapByDefault: RefLike<boolean>;
  magnetByDefault: RefLike<boolean>;
  magnetThresholdPx: RefLike<number>;
  magnetMarkers: RefLike<boolean>;
  magnetPlayhead: RefLike<boolean>;
  magnetLoopEdges: RefLike<boolean>;
  magnetNotes: RefLike<boolean>;
  selectAfterPlace: RefLike<boolean>;
  openCardAfterPlace: RefLike<boolean>;
  quickPlaceByDefault: RefLike<boolean>;
  timeAlignByDefault: RefLike<boolean>;
  nudgeStep: RefLike<string>;
  nudgeStepOptions: RefLike<ColOption[]>;
  pitchFollowByDefault: RefLike<boolean>;
  defaultRate: RefLike<number>;
  defaultZoom: RefLike<number>;
  wheelZoomStep: RefLike<number>;
  wheelSeek: RefLike<boolean>;
  undoLimit: RefLike<number>;
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
  stretchCacheMb: RefLike<number>;
  gridAutoHide: RefLike<boolean>;
  bpmSegmentColors: RefLike<boolean>;
  bpmSegmentIntensity: RefLike<number>;
  quickBarLabels: RefLike<boolean>;
  projectBarChips: RefLike<string>;
  projectBarChipsOptions: RefLike<ColOption[]>;
  animEnabled: RefLike<boolean>;
  rulerLabelCrossfade: RefLike<boolean>;
  rulerLabelFractionFade: RefLike<boolean>;
  rulerEdgeFade: RefLike<boolean>;
  rulerTickTransition: RefLike<boolean>;
  followSmooth: RefLike<boolean>;
  uiMotion: RefLike<boolean>;
  themeCrossfade: RefLike<boolean>;
  menuMotion: RefLike<boolean>;
  beatFxMaster: RefLike<boolean>;
  beatPulse: RefLike<boolean>;
  beatFxDensity: RefLike<string>;
  beatFxDensityOptions: RefLike<ColOption[]>;
  laneGlow: RefLike<boolean>;
  markerFlash: RefLike<boolean>;
  motionSpeed: RefLike<string>;
  motionSpeedOptions: RefLike<ColOption[]>;
  reduceMotion: RefLike<string>;
  reduceMotionOptions: RefLike<ColOption[]>;
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
    countInBars,
    gridMetronome,
    beatOverlap,
    beatOverlapOptions,
    beatOverlapHint,
    beatAccent,
    beatAccentGain,
    outputProtection,
    alignDecimals,
    alignRounding,
    alignRoundingOptions,
    alignRoundingHint,
    autoSave,
    autoSaveMinutes,
    defaultGridDiv,
    snapByDefault,
    magnetByDefault,
    magnetThresholdPx,
    magnetMarkers,
    magnetPlayhead,
    magnetLoopEdges,
    magnetNotes,
    selectAfterPlace,
    openCardAfterPlace,
    quickPlaceByDefault,
    timeAlignByDefault,
    nudgeStep,
    nudgeStepOptions,
    pitchFollowByDefault,
    defaultRate,
    defaultZoom,
    wheelZoomStep,
    wheelSeek,
    undoLimit,
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
    projectBarChips,
    projectBarChipsOptions,
    animEnabled,
    rulerLabelCrossfade,
    rulerLabelFractionFade,
    rulerEdgeFade,
    rulerTickTransition,
    followSmooth,
    uiMotion,
    themeCrossfade,
    menuMotion,
    beatFxMaster,
    beatPulse,
    beatFxDensity,
    beatFxDensityOptions,
    laneGlow,
    markerFlash,
    motionSpeed,
    motionSpeedOptions,
    reduceMotion,
    reduceMotionOptions,
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
            col: true,
            control: radio(language, () => languageOptions.value),
          },
          {
            kind: "field",
            key: "closeMode",
            col: true,
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
      {
        key: "data",
        rows: [
          { kind: "custom", id: "general.data", searchKey: "settingsData" },
        ],
      },
    ],
    edit: [
      {
        key: "grid",
        rows: [
          {
            kind: "field",
            key: "defaultGridDiv",
            control: num(defaultGridDiv, {
              min: freeMin(1),
              max: freeMax(64),
              step: 1,
            }),
          },
          { kind: "field", key: "snapByDefault", control: sw(snapByDefault) },
          {
            kind: "field",
            key: "magnetByDefault",
            control: sw(magnetByDefault),
          },
          {
            kind: "field",
            key: "magnetThresholdPx",
            expert: true,
            control: num(magnetThresholdPx, {
              min: freeMin(4),
              max: freeMax(24),
              step: 1,
              unitKey: "magnetThresholdPxUnit",
            }),
          },
          {
            kind: "field",
            key: "magnetMarkers",
            expert: true,
            control: sw(magnetMarkers),
          },
          {
            kind: "field",
            key: "magnetPlayhead",
            expert: true,
            control: sw(magnetPlayhead),
          },
          {
            kind: "field",
            key: "magnetLoopEdges",
            expert: true,
            control: sw(magnetLoopEdges),
          },
          {
            kind: "field",
            key: "magnetNotes",
            expert: true,
            control: sw(magnetNotes),
          },
        ],
      },
      {
        key: "placement",
        rows: [
          {
            kind: "field",
            key: "selectAfterPlace",
            control: sw(selectAfterPlace),
          },
          {
            kind: "field",
            key: "openCardAfterPlace",
            control: sw(openCardAfterPlace),
          },
          {
            kind: "field",
            key: "quickPlaceByDefault",
            control: sw(quickPlaceByDefault),
          },
          {
            kind: "field",
            key: "timeAlignByDefault",
            control: sw(timeAlignByDefault),
          },
          {
            kind: "field",
            key: "nudgeStep",
            col: true,
            control: radio(nudgeStep, () => nudgeStepOptions.value),
          },
        ],
      },
      {
        key: "playback",
        rows: [
          {
            kind: "field",
            key: "countInBars",
            control: num(countInBars, {
              min: freeMin(0),
              max: freeMax(4),
              step: 1,
              unitKey: "countInBarsUnit",
            }),
          },
          {
            kind: "field",
            key: "gridMetronome",
            control: sw(gridMetronome),
          },
          { kind: "field", key: "autoFollow", control: sw(followScroll) },
          {
            kind: "field",
            key: "followPercent",
            col: true,
            showIf: () => followScroll.value,
            expert: true,
            control: slider(followPercent, 0, 100, "%"),
          },
          {
            kind: "field",
            key: "ctrlSpeedPlay",
            expert: true,
            control: sw(ctrlSpeedPlay),
          },
          {
            kind: "field",
            key: "pitchFollowByDefault",
            expert: true,
            control: sw(pitchFollowByDefault),
          },
          {
            kind: "field",
            key: "defaultRate",
            expert: true,
            control: num(defaultRate, {
              min: freeMin(0.05),
              max: freeMax(4),
              step: 0.05,
            }),
          },
        ],
      },
      {
        key: "advanced",
        expert: true,
        rows: [
          {
            kind: "field",
            key: "defaultZoom",
            control: num(defaultZoom, {
              min: freeMin(6),
              max: freeMax(4000),
              step: 1,
              unitKey: "defaultZoomUnit",
            }),
          },
          {
            kind: "field",
            key: "wheelZoomStep",
            control: num(wheelZoomStep, {
              min: freeMin(1.05),
              max: freeMax(2),
              step: 0.05,
            }),
          },
          {
            kind: "field",
            key: "wheelSeek",
            control: sw(wheelSeek),
          },
          {
            kind: "field",
            key: "undoLimit",
            control: num(undoLimit, {
              min: freeMin(20),
              max: freeMax(1000),
              step: 10,
              unitKey: "undoLimitUnit",
            }),
          },
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
          {
            kind: "field",
            key: "beatOverlap",
            col: true,
            control: radio(
              beatOverlap,
              () => beatOverlapOptions.value,
              beatOverlapHint,
            ),
          },
          { kind: "field", key: "beatAccent", control: sw(beatAccent) },
          {
            kind: "field",
            key: "beatAccentGain",
            col: true,
            showIf: () => beatAccent.value,
            control: slider(beatAccentGain, 100, 200, "%"),
          },
          {
            kind: "field",
            key: "outputProtection",
            control: sw(outputProtection),
          },
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
          {
            kind: "field",
            key: "stretchCacheMb",
            control: num(stretchCacheMb, {
              min: freeMin(32),
              max: freeMax(4096),
              step: 32,
              unitKey: "stretchCacheMbUnit",
            }),
          },
        ],
      },
    ],
    display: [
      {
        key: "timeline",
        rows: [
          { kind: "field", key: "autoHideGrid", control: sw(gridAutoHide) },
          {
            kind: "field",
            key: "bpmSegmentColors",
            control: sw(bpmSegmentColors),
          },
          {
            kind: "field",
            key: "bpmSegmentIntensity",
            control: slider(bpmSegmentIntensity, 0, 100, "%"),
          },
        ],
      },
      {
        key: "projectBar",
        rows: [
          {
            kind: "field",
            key: "quickBarLabels",
            control: sw(quickBarLabels),
          },
          {
            kind: "field",
            key: "projectBarChips",
            col: true,
            control: radio(projectBarChips, () => projectBarChipsOptions.value),
          },
        ],
      },
      {
        key: "appearance",
        rows: [{ kind: "custom", id: "display.appearance" }],
      },
      {
        key: "scale",
        rows: [{ kind: "custom", id: "display.scale" }],
      },
      {
        key: "motion",
        rows: [
          { kind: "subhead", key: "motionGlobal" },
          {
            kind: "field",
            key: "motionSpeed",
            col: true,
            expert: true,
            control: radio(motionSpeed, () => motionSpeedOptions.value),
          },
          {
            kind: "field",
            key: "reduceMotion",
            col: true,
            control: radio(reduceMotion, () => reduceMotionOptions.value),
          },
          {
            kind: "custom",
            id: "display.performancePreset",
            searchKey: "performancePreset",
          },
          { kind: "subhead", key: "motionInterface" },
          { kind: "field", key: "uiMotion", control: sw(uiMotion) },
          {
            kind: "field",
            key: "themeCrossfade",
            control: sw(themeCrossfade),
          },
          {
            kind: "field",
            key: "menuMotion",
            expert: true,
            control: sw(menuMotion),
          },
          { kind: "subhead", key: "motionEditor" },
          { kind: "field", key: "editor", control: sw(animEnabled) },
          {
            kind: "field",
            key: "followSmooth",
            control: sw(followSmooth),
          },
          { kind: "subhead", key: "motionRuler" },
          {
            kind: "field",
            key: "rulerLabelCrossfade",
            expert: true,
            control: sw(rulerLabelCrossfade),
          },
          {
            kind: "field",
            key: "rulerLabelFractionFade",
            expert: true,
            control: sw(rulerLabelFractionFade),
          },
          {
            kind: "field",
            key: "rulerEdgeFade",
            expert: true,
            control: sw(rulerEdgeFade),
          },
          {
            kind: "field",
            key: "rulerTickTransition",
            expert: true,
            control: sw(rulerTickTransition),
          },
          { kind: "subhead", key: "motionFx" },
          { kind: "field", key: "beatFxMaster", control: sw(beatFxMaster) },
          { kind: "field", key: "laneGlow", control: sw(laneGlow) },
          { kind: "field", key: "markerFlash", control: sw(markerFlash) },
          { kind: "field", key: "beatPulse", control: sw(beatPulse) },
          {
            kind: "field",
            key: "beatFxDensity",
            expert: true,
            control: radio(beatFxDensity, () => beatFxDensityOptions.value),
          },
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
  };
}
