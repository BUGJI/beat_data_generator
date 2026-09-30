import type { Locale } from "./locale";

type Entry = { en: string; zh: string; ko: string };

/**
 * Strings for the standalone welcome window. Kept tiny and framework-free so
 * the welcome bundle never pulls in vue-i18n; keys map to `data-i18n` in
 * welcome.html.
 */
export const WELCOME_MESSAGES: Record<string, Entry> = {
  hint: {
    en: "Beat markers · Grid aligned",
    zh: "踩点标记 · 节拍对齐",
    ko: "비트 마커 · 그리드 정렬",
  },
  start: { en: "Start creating", zh: "开始创作", ko: "시작하기" },
  newProject: { en: "＋ New Project", zh: "＋ 新建工程", ko: "＋ 새 프로젝트" },
  openProject: { en: "Open Project…", zh: "打开工程…", ko: "프로젝트 열기…" },
  recent: { en: "Recent projects", zh: "最近工程", ko: "최근 프로젝트" },
  empty: {
    en: "No projects yet — create or open one to get started.",
    zh: "还没有打开过的工程，去新建或打开一个吧。",
    ko: "아직 프로젝트가 없어요 — 새로 만들거나 열어서 시작하세요.",
  },
  foot: {
    en: "Closing this window leaves the main window blank; your project is not lost from the welcome screen.",
    zh: "关闭本窗口后，主窗口保持空白待命；工程内容不会丢失在欢迎页。",
    ko: "이 창을 닫으면 메인 창은 빈 상태로 대기하며, 환영 화면에서 프로젝트가 사라지지 않아요.",
  },
};

export function welcomeText(key: string, loc: Locale): string {
  const entry = WELCOME_MESSAGES[key];
  return entry ? entry[loc] || entry.en : "";
}
