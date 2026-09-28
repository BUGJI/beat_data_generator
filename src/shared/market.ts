/**
 * Plugin marketplace shared types (main + renderer).
 *
 * The marketplace is driven by a static JSON index (see `registry.json`)
 * hosted in a dedicated registry repository. Each entry points at a per-version
 * ZIP artifact (typically a GitHub Release asset) and its SHA-256 checksum.
 * The main process downloads and verifies the artifact, safely unpacks it into
 * the user plugins folder, then lets the existing plugin manager rescan.
 */

import type { LocaText } from "./plugin";

/** File name of the install receipt written next to an installed plugin. */
export const MARKET_RECEIPT = ".installed.json";

/**
 * Canonical marketplace category slugs, in display order.
 *
 * Registry authors should only use these; the renderer still tolerates unknown
 * slugs (they are shown after the known ones) so the taxonomy can grow without
 * an app update. Keep in sync with `settings.plugins.cats` in the i18n files.
 */
export const MARKET_CATEGORIES = [
  "export",
  "import",
  "integration",
  "visual",
  "utility",
  "analysis",
] as const;
export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

/** Provenance record written into a plugin folder after a marketplace install. */
export interface PluginInstallReceipt {
  id: string;
  version: string;
  sha256: string;
  /** Registry URL the plugin was installed from. */
  source: string;
  /** ISO timestamp of the install. */
  installedAt: string;
}

/** One downloadable release of a plugin. */
export interface MarketVersionInfo {
  /** Absolute HTTPS URL of the plugin ZIP artifact. */
  url: string;
  /** Lowercase hex SHA-256 of the artifact; required for install. */
  sha256: string;
  /** Artifact size in bytes, used to show download progress. */
  size?: number;
  /** Overrides the plugin-level minimum app version for this release. */
  minAppVersion?: string;
}

/** A plugin as advertised by the registry index. */
export interface MarketPlugin {
  /** Stable plugin id, must match the installed manifest id. */
  id: string;
  /** Highest published version (must exist in `versions`). */
  latest: string;
  repo?: string;
  homepage?: string;
  author?: string;
  categories?: string[];
  tags?: string[];
  name?: LocaText;
  description?: LocaText;
  minAppVersion?: string;
  versions: Record<string, MarketVersionInfo>;
}

/** Root of the registry document. */
export interface MarketIndex {
  /** Registry schema version; bump when the shape changes. */
  schema: number;
  updatedAt?: string;
  plugins: MarketPlugin[];
}

/** A market plugin merged with local install state, ready for the UI. */
export interface MarketPluginView {
  id: string;
  displayName: string;
  /** locale -> display name, from the registry entry. */
  names: Record<string, string>;
  description?: string;
  /** locale -> description, from the registry entry. */
  descriptions: Record<string, string>;
  author?: string;
  repo?: string;
  homepage?: string;
  categories: string[];
  tags: string[];
  latest: string;
  versions: Record<string, MarketVersionInfo>;
  /** Installed version reported by the manifest, or null when not installed. */
  installedVersion: string | null;
  /** Whether a marketplace install receipt is present. */
  managed: boolean;
  /** Whether the plugin is currently enabled in the plugin manager. */
  enabled: boolean;
  /** Installed version differs from the latest compatible version. */
  updateAvailable: boolean;
  /** Every published version satisfies the running app version. */
  compatible: boolean;
  /** Minimum app version required by `latest`, when declared. */
  minAppVersion?: string;
}

export type MarketInstallPhase =
  | "queued"
  | "download"
  | "verify"
  | "extract"
  | "done"
  | "error";

/** Progress event streamed while installing/updating a plugin. */
export interface MarketProgress {
  id: string;
  version: string;
  phase: MarketInstallPhase;
  /** Bytes downloaded so far (download phase). */
  received?: number;
  /** Expected total bytes, when known (download phase). */
  total?: number;
  error?: string;
}

export interface MarketInstallResult {
  id: string;
  version: string;
  ok: boolean;
  error?: string;
}
