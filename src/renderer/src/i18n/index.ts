import { createI18n } from "vue-i18n";
import zh from "./zh";
import en from "./en";

export type Locale = "zh" | "en";
export const LOCALES: Array<{ value: Locale; label: string }> = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
];

function detectLocale(): Locale {
  const saved = localStorage.getItem("bdg-locale");
  if (saved === "zh" || saved === "en") return saved;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

const locale = detectLocale();
document.documentElement.lang = locale;

export const i18n = createI18n({
  legacy: false,
  locale,
  fallbackLocale: "en",
  messages: { zh, en },
});

export function setLocale(loc: Locale): void {
  i18n.global.locale.value = loc;
  document.documentElement.lang = loc;
  localStorage.setItem("bdg-locale", loc);
}
