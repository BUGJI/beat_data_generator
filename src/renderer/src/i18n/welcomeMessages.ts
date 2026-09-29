import type { Locale } from "./locale";

type Entry = { en: string; zh: string };

/**
 * Strings for the standalone welcome window. Kept tiny and framework-free so
 * the welcome bundle never pulls in vue-i18n; keys map to `data-i18n` in
 * welcome.html.
 */
export const WELCOME_MESSAGES: Record<string, Entry> = {
  hint: { en: "Beat markers · Grid aligned", zh: "踩点标记 · 节拍对齐" },
  start: { en: "Start creating", zh: "开始创作" },
  newProject: { en: "＋ New Project", zh: "＋ 新建工程" },
  openProject: { en: "Open Project…", zh: "打开工程…" },
  recent: { en: "Recent projects", zh: "最近工程" },
  empty: {
    en: "No projects yet — create or open one to get started.",
    zh: "还没有打开过的工程，去新建或打开一个吧。",
  },
  foot: {
    en: "Closing this window leaves the main window blank; your project is not lost from the welcome screen.",
    zh: "关闭本窗口后，主窗口保持空白待命；工程内容不会丢失在欢迎页。",
  },
};

export function welcomeText(key: string, loc: Locale): string {
  const entry = WELCOME_MESSAGES[key];
  return entry ? entry[loc] || entry.en : "";
}
