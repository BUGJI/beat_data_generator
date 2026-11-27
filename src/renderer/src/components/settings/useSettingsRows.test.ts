import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useSettingsStore } from "../../stores/settings";
import { useSettingsRowsStore } from "./useSettingsRows";

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("useSettingsRowsStore / search index", () => {
  it("indexes declarative fields, custom rows, theme tokens and extras", () => {
    const rows = useSettingsRowsStore();
    const keys = rows.searchIndex.map((e) => `${e.cat}.${e.key}`);
    expect(keys).toContain("audio.autoBpm");
    expect(keys).toContain("audio.stretchCacheMb");
    expect(keys).toContain("audio.metronome"); // custom row searchKey
    expect(keys).toContain("audio.beatOverlap");
    expect(keys).toContain("audio.outputProtection");
    expect(keys).toContain("general.simpleMode");
    expect(keys).toContain("edit.defaultGridDiv");
    expect(keys).toContain("edit.followMode");
    expect(keys).toContain("edit.followStepBeats");
    expect(keys).toContain("edit.snapByDefault");
    expect(keys).toContain("edit.selectAfterPlace");
    expect(keys).toContain("edit.nudgeStep");
    expect(keys).toContain("edit.defaultZoom");
    expect(keys).toContain("edit.wheelSeek");
    expect(keys).toContain("edit.undoLimit");
    expect(keys.some((k) => k.startsWith("theme.tokens."))).toBe(true);
    expect(keys).toContain("network.proxy"); // hand-written extra entry
    expect(keys).toContain("display.appearance.bgImage");
    expect(keys).toContain("display.appearance.surfaceOpacity");
    expect(keys).toContain("display.scale.uiZoom");
    expect(keys).toContain("display.scale.uiFontScale");
    expect(keys).toContain("display.quickBarLabels");
    expect(keys).toContain("display.projectBarChips");
    expect(keys).toContain("display.followSmooth");
    expect(keys).toContain("display.rulerLabelCrossfade");
    expect(keys).toContain("display.rulerLabelFractionFade");
    expect(keys).toContain("display.rulerEdgeFade");
    expect(keys).toContain("display.rulerTickTransition");
    expect(keys).toContain("display.performancePreset");
    expect(keys).toContain("display.beatFxMaster");
    expect(keys).toContain("display.beatFxDensity");
    expect(keys).toContain("display.motionSpeed");
    expect(keys).toContain("general.settingsData");
    expect(keys).toContain("shortcuts.page");
    expect(keys).toContain("plugins.page");
    expect(keys).toContain("about.page");
  });

  it("keeps the about page out of the declarative categories", () => {
    const rows = useSettingsRowsStore();
    expect(rows.fieldCats).not.toContain("about");
    expect(rows.fieldCats).toContain("general");
  });

  it("never indexes the same setting twice", () => {
    const keys = useSettingsRowsStore().searchIndex.map(
      (e) => `${e.cat}.${e.key}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("exposes showIf gates so search can mark hidden rows", () => {
    const settings = useSettingsStore();
    const rows = useSettingsRowsStore();
    const entry = (key: string) =>
      rows.searchIndex.find((e) => e.cat === "edit" && e.key === key);

    settings.settings.followScroll = false;
    expect(entry("followMode")?.visible?.()).toBe(false);

    settings.settings.followScroll = true;
    settings.settings.followMode = "step";
    expect(entry("followMode")?.visible?.()).toBe(true);
    expect(entry("followStepBeats")?.visible?.()).toBe(true);

    settings.settings.followMode = "page";
    expect(entry("followStepBeats")?.visible?.()).toBe(false);
  });

  it("marks expert entries so simple mode can hide them", () => {
    const rows = useSettingsRowsStore();
    const align = rows.searchIndex.find(
      (e) => e.cat === "edit" && e.key === "alignDecimals",
    );
    expect(align?.expert).toBe(true);
    expect(
      rows.searchIndex.find((e) => e.cat === "edit" && e.key === "undoLimit")
        ?.expert,
    ).toBe(true);
    expect(
      rows.searchIndex.find(
        (e) => e.cat === "edit" && e.key === "snapByDefault",
      )?.expert,
    ).toBeUndefined();
  });
});

describe("useSettingsRowsStore / grouping", () => {
  it("hides expert groups and rows while simple mode is on", () => {
    const settings = useSettingsStore();
    const rows = useSettingsRowsStore();
    settings.settings.simpleMode = false;

    const allGroups = rows.groupsOf("edit");
    expect(allGroups.some((g) => g.expert)).toBe(true);

    settings.settings.simpleMode = true;
    const simpleGroups = rows.groupsOf("edit");
    expect(simpleGroups.length).toBeGreaterThan(0);
    expect(simpleGroups.every((g) => !g.expert)).toBe(true);
    expect(
      rows.rowsInGroup("edit").every((r) => r.kind !== "field" || !r.expert),
    ).toBe(true);
  });

  it("orders the display sub-tabs by area", () => {
    useSettingsStore().settings.simpleMode = false;
    const rows = useSettingsRowsStore();
    const displayGroups = rows.groupsOf("display").map((g) => g.key);
    expect(displayGroups).toEqual([
      "timeline",
      "projectBar",
      "appearance",
      "scale",
      "motion",
    ]);
  });

  it("orders the motion sections and hides expert-only headings in simple mode", () => {
    const settings = useSettingsStore();
    const rows = useSettingsRowsStore();
    settings.settings.simpleMode = false;
    rows.setSubCat("display", "motion");

    const sectionKeys = (): string[] =>
      rows
        .rowsInGroup("display")
        .filter((r) => r.kind === "subhead")
        .map((r) => (r.kind === "subhead" ? r.key : ""));
    expect(sectionKeys()).toEqual([
      "motionGlobal",
      "motionInterface",
      "motionEditor",
      "motionRuler",
      "motionFx",
    ]);

    settings.settings.simpleMode = true;
    // The ruler section is entirely expert, so its heading collapses away.
    expect(sectionKeys()).toEqual([
      "motionGlobal",
      "motionInterface",
      "motionEditor",
      "motionFx",
    ]);
  });

  it("shows the motion group in simple mode but hides expert rows", () => {
    const settings = useSettingsStore();
    const rows = useSettingsRowsStore();
    settings.settings.simpleMode = true;
    rows.setSubCat("display", "motion");
    const fields = rows
      .rowsInGroup("display")
      .filter((r) => r.kind === "field")
      .map((r) => (r.kind === "field" ? r.key : ""));
    expect(fields).toContain("editor");
    expect(fields).toContain("beatFxMaster");
    expect(fields).not.toContain("motionSpeed");
    expect(fields).not.toContain("menuMotion");
  });

  it("falls back to the first group and honours setSubCat", () => {
    useSettingsStore().settings.simpleMode = false;
    const rows = useSettingsRowsStore();
    expect(rows.activeGroup("edit")).toBe("grid");
    rows.setSubCat("edit", "autosave");
    expect(rows.activeGroup("edit")).toBe("autosave");
  });

  it("collapses the edit sub-tabs into five groups", () => {
    useSettingsStore().settings.simpleMode = false;
    const rows = useSettingsRowsStore();
    expect(rows.groupsOf("edit").map((g) => g.key)).toEqual([
      "grid",
      "placement",
      "playback",
      "advanced",
      "autosave",
    ]);
  });

  it("exposes the data & backup group", () => {
    useSettingsStore().settings.simpleMode = false;
    const rows = useSettingsRowsStore();
    const generalGroups = rows.groupsOf("general").map((g) => g.key);
    expect(generalGroups).toEqual(["general", "window", "data"]);
    expect(rows.groupsOf("general")[2]?.rows[0]).toMatchObject({
      kind: "custom",
      id: "general.data",
    });
  });
});
