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

export interface PingResult {
  ok: boolean;
  /** Round-trip time in ms (recorded even when the request fails). */
  ms: number;
  /** Present when the request failed or timed out. */
  error?: string;
}
