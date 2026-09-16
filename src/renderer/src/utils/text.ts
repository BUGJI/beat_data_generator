import { i18n } from "../i18n";

/** Translate a key through the global i18n instance (usable outside setup). */
export const t = (key: string, params?: Record<string, unknown>): string =>
  i18n.global.t(key, params ?? {});
