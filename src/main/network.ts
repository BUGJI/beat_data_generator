import { net, session } from "electron";
import log from "./logger";
import type { PingResult } from "../shared/network";
import type { ProxyMode } from "../shared/settings";

/**
 * Main-process network/proxy configuration.
 *
 * Electron's `net` stack (used by the marketplace and updater) resolves its
 * proxy through Chromium. We expose three modes:
 *   - system : whatever the OS/Chromium is configured with (default)
 *   - env    : HTTP_PROXY / HTTPS_PROXY / ALL_PROXY environment variables
 *   - off    : direct connection, no proxy
 *
 * Applied to `session.defaultSession`, so it covers `net.fetch` everywhere.
 */

function stripScheme(u: string): string {
  return u
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/\/+$/, "");
}

/** Build a Chromium `proxyRules` string from the process environment. */
function envProxyRules(): string {
  const env = process.env;
  const http = env.HTTP_PROXY || env.http_proxy;
  const https = env.HTTPS_PROXY || env.https_proxy;
  const all = env.ALL_PROXY || env.all_proxy;
  const parts: string[] = [];
  if (http) parts.push(`http=${stripScheme(http)}`);
  if (https) parts.push(`https=${stripScheme(https)}`);
  if (!parts.length && all) {
    const a = stripScheme(all);
    parts.push(`http=${a}`, `https=${a}`);
  }
  return parts.join(";");
}

/** Apply the configured proxy mode. Safe to call repeatedly. */
export async function applyProxyMode(mode: ProxyMode): Promise<void> {
  try {
    if (mode === "off") {
      await session.defaultSession.setProxy({ mode: "direct" });
      log.info("[network] proxy mode: direct");
      return;
    }
    if (mode === "env") {
      const rules = envProxyRules();
      if (rules) {
        await session.defaultSession.setProxy({
          mode: "fixed_servers",
          proxyRules: rules,
        });
        log.info(`[network] proxy mode: env (${rules})`);
        return;
      }
      log.info(
        "[network] proxy mode: env requested but no *_PROXY set; system",
      );
    }
    await session.defaultSession.setProxy({ mode: "system" });
    log.info("[network] proxy mode: system");
  } catch (err) {
    log.error("[network] failed to apply proxy mode", err);
  }
}

const PING_TIMEOUT_MS = 8000;

/**
 * Measure round-trip latency to an https endpoint. Any HTTP response counts as
 * reachable (the point is connectivity/latency, not the status code).
 */
export async function pingEndpoint(
  url: string,
  timeoutMs = PING_TIMEOUT_MS,
): Promise<PingResult> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return { ok: false, ms: 0, error: "invalid URL" };
  }
  if (target.protocol !== "https:") {
    return { ok: false, ms: 0, error: "URL must be HTTPS" };
  }
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await net.fetch(target.toString(), {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    // Drain a little so the request actually completes, then report the time.
    try {
      await res.arrayBuffer();
    } catch {
      /* ignore body errors */
    }
    return { ok: true, ms: Date.now() - start };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: String(err) };
  } finally {
    clearTimeout(timer);
  }
}
