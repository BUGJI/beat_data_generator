/**
 * Plugin system shared types (main + renderer).
 *
 * A plugin is a folder containing a manifest.json plus optional entry scripts:
 *   - manifest.json : metadata (id / version / display name / entries)
 *   - main.js       : optional, loaded in the main process with full Node access
 *   - renderer.js   : optional, executed in the editor page context
 *
 * Contributions (menus / panels / exports / typed tracks / shortcuts) are
 * registered at runtime from renderer.js. Plugins are discovered by scanning
 * plugin root folders; enabling/disabling is persisted in the main process.
 */

/** A single locale -> text map or a plain string. */
export type LocaText = string | { [locale: string]: string };

/**
 * Highest plugin API version this host understands. Plugins declare the version
 * they were written against in their manifest (`apiVersion`); the host refuses to
 * load anything that targets a newer major surface. Bump this only when the
 * plugin API changes in a way plugins must opt into.
 */
export const PLUGIN_API_VERSION = 2;

/** Version assumed for manifests that predate version negotiation. */
export const PLUGIN_API_VERSION_FALLBACK = 1;

/**
 * Optional host-version constraint, e.g. `{ "bdg": ">=0.4.0" }`. Stored and
 * surfaced in settings; not enforced yet (kept for the marketplace).
 */
export interface PluginEngines {
  bdg?: string;
  [key: string]: string | undefined;
}

export interface PluginManifest {
  id: string;
  version: string;
  /**
   * Plugin API version the plugin targets. Omitted = 1 (legacy). When greater
   * than the host's `PLUGIN_API_VERSION`, the plugin is listed but not loaded.
   */
  apiVersion?: number;
  engines?: PluginEngines;
  name?: LocaText;
  description?: LocaText;
  /** relative path to the optional main-process entry (CommonJS). */
  main?: string;
  /** relative path to the optional renderer entry (plain JS). */
  renderer?: string;
  /** arbitrary extra metadata kept for forward compatibility. */
  [key: string]: unknown;
}

export interface PluginEntry {
  id: string;
  version: string;
  /** absolute folder path of the plugin. */
  dir: string;
  /** non-empty resolved display name (en -> zh -> id fallback). */
  displayName: string;
  /** locale -> display name, when the manifest provides localized names. */
  names: Record<string, string>;
  /** resolved short description (en -> zh), if any. */
  description?: string;
  /** locale -> description, when the manifest provides localized text. */
  descriptions: Record<string, string>;
  /** relative main entry path or null. */
  main: string | null;
  /** relative renderer entry path or null. */
  renderer: string | null;
  /** declared plugin API version (falls back to 1 when the manifest omits it). */
  apiVersion: number;
  /** optional host-version constraint declared by the manifest. */
  engines?: PluginEngines;
  /**
   * false when the plugin targets a newer API than this host supports; such a
   * plugin is listed (so the user sees why) but never loaded.
   */
  compatible: boolean;
  enabled: boolean;
  /** load/parse error, when the plugin could not be used. */
  error?: string;
}
