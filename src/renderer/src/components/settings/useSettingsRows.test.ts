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
    expect(keys).toContain("audio.metronome"); // custom row searchKey
    expect(keys).toContain("general.simpleMode");
    expect(keys.some((k) => k.startsWith("theme.tokens."))).toBe(true);
    expect(keys).toContain("network.proxy"); // hand-written extra entry
  });

  it("marks expert entries so simple mode can hide them", () => {
    const rows = useSettingsRowsStore();
    const align = rows.searchIndex.find(
      (e) => e.cat === "edit" && e.key === "alignDecimals",
    );
    expect(align?.expert).toBe(true);
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

  it("falls back to the first group and honours setSubCat", () => {
    useSettingsStore().settings.simpleMode = false;
    const rows = useSettingsRowsStore();
    expect(rows.activeGroup("edit")).toBe("follow");
    rows.setSubCat("edit", "align");
    expect(rows.activeGroup("edit")).toBe("align");
  });
});
