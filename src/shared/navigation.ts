/**
 * URL admission rules shared by the main-process window code.
 *
 * The main window carries a preload bridge that exposes the whole `IpcApi`, so
 * a page-initiated navigation away from the bundled renderer would hand those
 * privileges to whatever it navigated to. `will-navigate` therefore only admits
 * the exact page the window was loaded with; everything else is blocked.
 *
 * Plugin-created windows have no preload, but they are still restricted to
 * real web/local schemes so a manifest cannot open `javascript:` or `data:`
 * URLs in an Electron window.
 */

const EXTERNAL_SCHEMES = new Set(["http:", "https:", "file:"]);

function parseUrl(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * True only for the exact document(s) the renderer was loaded from (same
 * origin and path), regardless of query/hash. `appUrls` is the authoritative
 * allow-list, so a packaged `file://` app denies every other file URL too.
 */
export function isAllowedAppNavigation(
  target: string,
  appUrls: readonly string[],
): boolean {
  const t = parseUrl(target);
  if (!t) return false;
  return appUrls.some((raw) => {
    const a = parseUrl(raw);
    if (!a) return false;
    // `file:` URLs all report origin "null"; compare the document path instead.
    if (a.protocol === "file:" || t.protocol === "file:") {
      return a.protocol === t.protocol && a.pathname === t.pathname;
    }
    return a.origin === t.origin && a.pathname === t.pathname;
  });
}

/** Schemes a plugin window may load: http(s) and local files only. */
export function isAllowedExternalUrl(target: string): boolean {
  const u = parseUrl(target);
  if (!u) return false;
  return EXTERNAL_SCHEMES.has(u.protocol);
}
