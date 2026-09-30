import { app } from "electron";

/**
 * Minimal main-process localization for native dialogs / notifications.
 *
 * The renderer keeps its own vue-i18n catalog; only a few OS-level strings live
 * here. The active language follows the persisted `settings.locale` (set via
 * {@link setMainLocale}) and falls back to the OS locale, so native dialogs
 * match the UI language the user picked.
 */

export type MainLocale = "zh" | "en" | "ko";

const MESSAGES = {
  saveNewProject: {
    en: "Save new project",
    zh: "保存新工程",
    ko: "새 프로젝트 저장",
  },
  openProject: { en: "Open project", zh: "打开工程", ko: "프로젝트 열기" },
  openAudio: {
    en: "Open audio file",
    zh: "打开音频文件",
    ko: "오디오 파일 열기",
  },
  saveProject: { en: "Save project", zh: "保存工程", ko: "프로젝트 저장" },
  exportTimestamps: {
    en: "Export timestamps",
    zh: "导出时间戳",
    ko: "타임스탬프 내보내기",
  },
  exportEdl: { en: "Export EDL", zh: "导出 EDL", ko: "EDL 내보내기" },
  quitMessage: {
    en: "Exit {name}?",
    zh: "退出 {name}？",
    ko: "{name}을(를) 종료할까요?",
  },
  quitButton: { en: "Quit", zh: "退出", ko: "종료" },
  cancelButton: { en: "Cancel", zh: "取消", ko: "취소" },
  unsavedMessage: {
    en: "Save changes before exiting?",
    zh: "退出前保存更改？",
    ko: "종료하기 전에 변경 사항을 저장할까요?",
  },
  unsavedDetail: {
    en: "Your project has unsaved changes. Exiting without saving will lose them.",
    zh: "当前工程有未保存的更改，直接退出将丢失这些修改。",
    ko: "프로젝트에 저장하지 않은 변경 사항이 있어요. 저장하지 않고 종료하면 변경 내용이 사라져요.",
  },
  saveAndQuit: { en: "Save and quit", zh: "保存并退出", ko: "저장 후 종료" },
  discardAndQuit: {
    en: "Discard and quit",
    zh: "放弃并退出",
    ko: "저장하지 않고 종료",
  },
  updateTitle: {
    en: "{name} — update available",
    zh: "{name} — 更新可用",
    ko: "{name} — 업데이트 있음",
  },
  updateBody: {
    en: "Version {version} is available. Click to open the download page.",
    zh: "发现新版本 {version}，点击打开下载页面。",
    ko: "새 버전 {version}이(가) 있어요. 클릭하면 다운로드 페이지가 열려요.",
  },
} as const;

export type MainTextKey = keyof typeof MESSAGES;

function osLocale(): MainLocale {
  try {
    const lang = app.getLocale().toLowerCase();
    if (lang.startsWith("zh")) return "zh";
    if (lang.startsWith("ko")) return "ko";
    return "en";
  } catch {
    return "en";
  }
}

let current: MainLocale | null = null;

/** Apply the user's preference ("auto" or an unsupported value follows the OS). */
export function setMainLocale(pref: string | undefined): void {
  current = pref === "zh" || pref === "en" || pref === "ko" ? pref : osLocale();
}

export function mainLocale(): MainLocale {
  return current ?? osLocale();
}

/** Translate a main-process string, interpolating `{name}` placeholders. */
export function mt(
  key: MainTextKey,
  params: Record<string, string | number> = {},
): string {
  let text: string = MESSAGES[key][mainLocale()];
  for (const [k, v] of Object.entries(params)) {
    text = text.split(`{${k}}`).join(String(v));
  }
  return text;
}
