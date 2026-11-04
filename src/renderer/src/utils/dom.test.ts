import { describe, expect, it } from "vitest";
import { isTypingTarget, ownsActivationKey } from "./dom";

describe("isTypingTarget", () => {
  it("recognizes text inputs and editable regions", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
  });

  it("ignores non-editable elements and null", () => {
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("ownsActivationKey", () => {
  it("recognizes buttons and links", () => {
    const button = document.createElement("button");
    const link = document.createElement("a");
    link.href = "#";
    expect(ownsActivationKey(button)).toBe(true);
    expect(ownsActivationKey(link)).toBe(true);
  });

  it("recognizes role-based controls and their descendants", () => {
    const roleButton = document.createElement("div");
    roleButton.setAttribute("role", "button");
    const child = document.createElement("span");
    roleButton.append(child);
    expect(ownsActivationKey(roleButton)).toBe(true);
    expect(ownsActivationKey(child)).toBe(true);
  });

  it("ignores plain elements and null", () => {
    expect(ownsActivationKey(document.createElement("div"))).toBe(false);
    expect(ownsActivationKey(null)).toBe(false);
  });
});
