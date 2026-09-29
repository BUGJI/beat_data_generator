import { app } from "electron";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MARKET_RECEIPT,
  type MarketPlugin,
  type MarketPluginView,
  type PluginInstallReceipt,
} from "../../shared/market";
import { isPluginEnabled, userPluginsDir } from "../plugins";
import { getIndex } from "./registry";

/**
 * Local install state: scanned plugins, install receipts, semver helpers and
 * the market index merged into the renderer-facing view.
 */

interface InstalledState {
  version: string;
  managed: boolean;
  enabled: boolean;
}

export function scanInstalled(): Map<string, InstalledState> {
  const out = new Map<string, InstalledState>();
  const root = userPluginsDir();
  if (!existsSync(root)) return out;
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    return out;
  }
  for (const name of names) {
    const dir = join(root, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    try {
      const manifest = JSON.parse(
        readFileSync(join(dir, "manifest.json"), "utf-8"),
      ) as { id?: unknown; version?: unknown };
      const id = typeof manifest.id === "string" ? manifest.id : "";
      if (!id || out.has(id)) continue;
      const version =
        typeof manifest.version === "string" ? manifest.version : "0.0.0";
      out.set(id, {
        version,
        managed: existsSync(join(dir, MARKET_RECEIPT)),
        enabled: isPluginEnabled(id),
      });
    } catch {
      /* not a plugin folder */
    }
  }
  return out;
}

export function readReceipt(id: string): PluginInstallReceipt | null {
  try {
    const raw = JSON.parse(
      readFileSync(join(userPluginsDir(), id, MARKET_RECEIPT), "utf-8"),
    ) as PluginInstallReceipt;
    return raw && typeof raw.id === "string" ? raw : null;
  } catch {
    return null;
  }
}

// ---- version helpers ----

function parseVersion(v: string): { nums: number[]; pre: string } {
  const clean = v.replace(/^v/, "");
  const dash = clean.indexOf("-");
  const main = dash >= 0 ? clean.slice(0, dash) : clean;
  const pre = dash >= 0 ? clean.slice(dash + 1) : "";
  return { nums: main.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

export function minAppFor(
  p: MarketPlugin,
  version: string,
): string | undefined {
  return p.versions[version]?.minAppVersion ?? p.minAppVersion;
}

export function isCompatible(p: MarketPlugin, version: string): boolean {
  const min = minAppFor(p, version);
  return !min || compareVersions(app.getVersion(), min) >= 0;
}

function resolveText(v: MarketPlugin["name"]): {
  fallback: string;
  i18n: Record<string, string>;
} {
  if (typeof v === "string" && v.trim()) {
    return { fallback: v.trim(), i18n: {} };
  }
  if (v && typeof v === "object") {
    const i18n: Record<string, string> = {};
    for (const [loc, val] of Object.entries(v)) {
      if (typeof val === "string" && val.trim()) i18n[loc] = val.trim();
    }
    return { fallback: i18n.en ?? i18n.zh ?? "", i18n };
  }
  return { fallback: "", i18n: {} };
}

export function findMarketPlugin(
  index: { plugins: MarketPlugin[] },
  id: string,
): MarketPlugin | null {
  return index.plugins.find((p) => p.id === id) ?? null;
}

function toView(
  p: MarketPlugin,
  installed: Map<string, InstalledState>,
): MarketPluginView {
  const local = installed.get(p.id) ?? null;
  const compatible = isCompatible(p, p.latest);
  const name = resolveText(p.name);
  const desc = resolveText(p.description);
  return {
    id: p.id,
    displayName: name.fallback || p.id,
    names: name.i18n,
    description: desc.fallback || undefined,
    descriptions: desc.i18n,
    author: p.author,
    repo: p.repo,
    homepage: p.homepage,
    categories: p.categories ?? [],
    tags: p.tags ?? [],
    latest: p.latest,
    versions: p.versions,
    installedVersion: local?.version ?? null,
    managed: local?.managed ?? false,
    enabled: local?.enabled ?? false,
    updateAvailable:
      !!local && compatible && compareVersions(p.latest, local.version) > 0,
    compatible,
    minAppVersion: minAppFor(p, p.latest),
  };
}

export async function listMarket(force: boolean): Promise<MarketPluginView[]> {
  const index = await getIndex(force);
  const installed = scanInstalled();
  return index.plugins.map((p) => toView(p, installed));
}
