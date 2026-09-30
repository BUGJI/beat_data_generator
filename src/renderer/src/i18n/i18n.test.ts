import { describe, expect, it } from "vitest";
import en from "./en";
import zh from "./zh";
import ko from "./ko";
import { pickLocale, resolveLocale } from "./locale";
import { WELCOME_MESSAGES } from "./welcomeMessages";

/** Flatten a nested message object into dot-separated leaf keys. */
function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flatten(v as Record<string, unknown>, key));
    } else {
      out.push(key);
    }
  }
  return out;
}

describe("i18n message parity", () => {
  const enKeys = flatten(en as Record<string, unknown>);
  const zhKeys = flatten(zh as Record<string, unknown>);
  const koKeys = flatten(ko as Record<string, unknown>);

  it("zh has no keys missing from en", () => {
    expect(zhKeys.filter((k) => !enKeys.includes(k)).sort()).toEqual([]);
  });

  it("en has no keys missing from zh", () => {
    expect(enKeys.filter((k) => !zhKeys.includes(k)).sort()).toEqual([]);
  });

  it("ko has no keys missing from en", () => {
    expect(koKeys.filter((k) => !enKeys.includes(k)).sort()).toEqual([]);
  });

  it("en has no keys missing from ko", () => {
    expect(enKeys.filter((k) => !koKeys.includes(k)).sort()).toEqual([]);
  });

  it("every welcome string provides all locales", () => {
    for (const [key, entry] of Object.entries(WELCOME_MESSAGES)) {
      expect(entry.en, `${key}.en`).toBeTruthy();
      expect(entry.zh, `${key}.zh`).toBeTruthy();
      expect(entry.ko, `${key}.ko`).toBeTruthy();
    }
  });
});

describe("locale helpers", () => {
  it("resolves concrete preferences and lets auto fall back", () => {
    expect(resolveLocale("zh")).toBe("zh");
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("ko")).toBe("ko");
    expect(["zh", "en", "ko"]).toContain(resolveLocale("auto"));
    expect(["zh", "en", "ko"]).toContain(resolveLocale(undefined));
  });

  it("picks a locale from a map with en fallback", () => {
    expect(pickLocale("plain", "zh")).toBe("plain");
    expect(pickLocale({ en: "hello", zh: "你好" }, "zh")).toBe("你好");
    expect(pickLocale({ en: "hello", ko: "안녕" }, "ko")).toBe("안녕");
    expect(pickLocale({ en: "hello" }, "zh")).toBe("hello");
    expect(pickLocale(undefined, "en")).toBe("");
  });
});
