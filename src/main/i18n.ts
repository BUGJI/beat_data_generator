import { app } from "electron";

/**
 * Minimal main-process localization for native dialogs / notifications.
 *
 * The renderer keeps its own vue-i18n catalog; only a few OS-level strings live
 * here. The active language follows the persisted `settings.locale` (set via
 * {@link setMainLocale}) and falls back to the OS locale, so native dialogs
 * match the UI language the user picked.
 */

export type MainLocale = "zh" | "en";

const MESSAGES = {
  saveNewProject: { en: "Save new project", zh: "保存新工程" },
  openProject: { en: "Open project", zh: "打开工程" },
  openAudio: { en: "Open audio file", zh: "打开音频文件" },
  saveProject: { en: "Save project", zh: "保存工程" },
  exportTimestamps: { en: "Export timestamps", zh: "导出时间戳" },
  exportEdl: { en: "Export EDL", zh: "导出 EDL" },
  quitMessage: { en: "Exit {name}?", zh: "退出 {name}？" },
  quitButton: { en: "Quit", zh: "退出" },
  cancelButton: { en: "Cancel", zh: "取消" },
  updateTitle: { en: "{name} — update available", zh: "{name} — 更新可用" },
  updateBody: {
    en: "Version {version} is available. Click to open the download page.",
    zh: "发现新版本 {version}，点击打开下载页面。",
  },
} as const;

export type MainTextKey = keyof typeof MESSAGES;

function osLocale(): MainLocale {
  try {
    return app.getLocale().toLowerCase().startsWith("zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

let current: MainLocale | null = null;

/** Apply the user's preference ("auto" or an unsupported value follows the OS). */
export function setMainLocale(pref: string | undefined): void {
  current = pref === "zh" || pref === "en" ? pref : osLocale();
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
