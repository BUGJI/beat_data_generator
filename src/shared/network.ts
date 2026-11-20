/**
 * Network helpers shared between main and renderer (gh-proxy mirrors, ping).
 */

/** Default gh-proxy mirrors offered in Settings → Network. */
export const GH_PROXY_PRESETS = [
  "https://edgeone.gh-proxy.com",
  "https://hk.gh-proxy.com",
  "https://gh-proxy.com",
  "https://gh.dpik.top",
] as const;

/** Select value that switches the mirror picker to a free-form input. */
export const GH_PROXY_CUSTOM = "__custom__";

/** Built-in fallback when the configured host is blank or invalid. */
export const GH_PROXY_DEFAULT_HOST = "ghfast.top";

/**
 * Validate and normalize a user-supplied gh-proxy host or base URL.
 * Accepts `ghfast.top`, `https://ghfast.top`, or a URL with a port/path.
 * Returns null when the value can't be used (blank, whitespace, bad syntax).
 */
export function normalizeProxyHost(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    const host = url.hostname;
    // A single label is almost always a typo unless it is localhost.
    if (!host.includes(".") && !host.includes(":") && host !== "localhost")
      return null;
    return trimmed.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export interface PingResult {
  ok: boolean;
  /** Round-trip time in ms (recorded even when the request fails). */
  ms: number;
  /** Present when the request failed or timed out. */
  error?: string;
}
