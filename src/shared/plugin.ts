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

export interface PluginManifest {
  id: string;
  version: string;
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
  enabled: boolean;
  /** load/parse error, when the plugin could not be used. */
  error?: string;
}
