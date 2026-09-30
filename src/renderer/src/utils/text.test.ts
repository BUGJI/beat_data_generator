import { describe, expect, it } from "vitest";
import { t } from "./text";

describe("t", () => {
  it("resolves a known key to a non-empty localized string", () => {
    const s = t("app.name");
    expect(typeof s).toBe("string");
    expect(s.length).toBeGreaterThan(0);
    expect(s).not.toBe("app.name");
  });

  it("interpolates named parameters", () => {
    expect(t("dialogs.exportOk", { n: 3 })).toContain("3");
  });

  it("returns the key itself when no translation exists", () => {
    expect(t("no.such.key.exists")).toBe("no.such.key.exists");
  });
});
