import { describe, expect, it } from "vitest";
import {
  bindingFor,
  comboParts,
  eventCombo,
  matchesBinding,
} from "./shortcuts";

function key(
  key: string,
  modifiers: Partial<
    Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey">
  > = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", { key, ...modifiers });
}

describe("shortcut bindings", () => {
  it("normalizes key events", () => {
    expect(eventCombo(key("s", { ctrlKey: true, shiftKey: true }))).toBe(
      "Ctrl+Shift+S",
    );
    expect(eventCombo(key("+", { ctrlKey: true, shiftKey: true }))).toBe(
      "Ctrl+=",
    );
    expect(eventCombo(key(" ", { ctrlKey: true }))).toBe("Ctrl+Space");
    expect(eventCombo(key("Control", { ctrlKey: true }))).toBeNull();
  });

  it("matches alternatives and overrides", () => {
    expect(matchesBinding("Ctrl+Y", "Ctrl+Y|Ctrl+Shift+Z")).toBe(true);
    expect(matchesBinding("Ctrl+Shift+Z", "Ctrl+Y|Ctrl+Shift+Z")).toBe(true);
    expect(matchesBinding("Ctrl+S", "Ctrl+Y|Ctrl+Shift+Z")).toBe(false);
    expect(bindingFor("save", { save: "Ctrl+Alt+S" })).toBe("Ctrl+Alt+S");
    expect(bindingFor("save", {})).toBe("Ctrl+S");
  });

  it("splits alternatives into key parts", () => {
    expect(comboParts("Ctrl+Y|Ctrl+Shift+Z")).toEqual([
      ["Ctrl", "Y"],
      ["Ctrl", "Shift", "Z"],
    ]);
  });
});
