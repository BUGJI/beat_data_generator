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
    expect(keys).toContain("general.simpleMode");
    expect(keys).toContain("edit.defaultGridDiv");
    expect(keys).toContain("edit.snapByDefault");
    expect(keys).toContain("edit.selectAfterPlace");
    expect(keys).toContain("edit.nudgeStep");
    expect(keys).toContain("edit.defaultZoom");
    expect(keys).toContain("edit.undoLimit");
    expect(keys.some((k) => k.startsWith("theme.tokens."))).toBe(true);
    expect(keys).toContain("network.proxy"); // hand-written extra entry
    expect(keys).toContain("theme.appearance.bgImage");
    expect(keys).toContain("theme.appearance.surfaceOpacity");
    expect(keys).toContain("display.followSmooth");
    expect(keys).toContain("display.beatFxMaster");
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
    expect(rows.activeGroup("edit")).toBe("follow");
    rows.setSubCat("edit", "align");
    expect(rows.activeGroup("edit")).toBe("align");
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
