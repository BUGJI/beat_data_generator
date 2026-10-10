/**
 * Persisted per-plugin state, shared by the main process (owner of the file) and
 * the renderer (reads through IPC).
 *
 * Two independent sections:
 *   - `data`   : each plugin's own key/value bag, written through `api.storage`.
 *   - `panels` : floating-panel geometry, keyed by "<pluginId>:<panelId>".
 *
 * Keeping both in one file (rather than app settings.json) isolates plugin
 * state so a misbehaving plugin can never bloat or corrupt user settings.
 */

/** A plugin's own persisted key/value bag. */
export type PluginDataMap = Record<string, Record<string, unknown>>;

/** Restored geometry of a floating plugin panel. */
export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Persisted panel geometry, keyed by "<pluginId>:<panelId>". */
export type PanelLayout = Record<string, PanelRect>;

export interface PluginStoreData {
  data: PluginDataMap;
  panels: PanelLayout;
}
