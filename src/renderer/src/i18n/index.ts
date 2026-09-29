import { watch } from "vue";
import { createI18n } from "vue-i18n";
import zh from "./zh";
import en from "./en";
import {
  detectLocale,
  isLocale,
  rememberLocale,
  resolveLocale,
  type Locale,
} from "./locale";

export type { Locale } from "./locale";
export {
  detectLocale,
  isLocale,
  LOCALE_STORAGE_KEY,
  pickLocale,
  rememberLocale,
  resolveLocale,
} from "./locale";

export const LOCALES: Array<{ value: Locale; label: string }> = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
];

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: "en",
  messages: { zh, en },
});

/**
 * Reactive locale ref — the single source of truth. Reading `.value` inside a
 * computed or template makes it re-evaluate when the language switches.
 */
export const locale = i18n.global.locale;

/** Current locale as a union; reactive wherever it is read. */
export function currentLocale(): Locale {
  const loc = locale.value;
  return isLocale(loc) ? loc : "en";
}

// Mirror the active locale onto <html lang> (kept out of the read path so no
// consumer depends on the DOM attribute).
watch(
  locale,
  (loc) => {
    if (typeof document !== "undefined") document.documentElement.lang = loc;
  },
  { immediate: true },
);

export function setLocale(loc: Locale): void {
  locale.value = loc;
  rememberLocale(loc);
}

/** Apply a settings preference ("auto" | "zh" | "en") and remember the result. */
export function applyLocalePreference(pref: string | undefined): void {
  setLocale(resolveLocale(pref));
}
