import type { PluginEntry } from "./plugin";
import type {
  MarketInstallResult,
  MarketPluginView,
  MarketProgress,
} from "./market";
import type { PingResult } from "./network";
import type { SettingsData } from "./settings";

export type { SettingsData } from "./settings";

export interface AudioFileResult {
  filePath: string;
  name: string;
  size: number;
  data: Uint8Array;
  /** MD5 of the file bytes, computed during the same read (null when skipped). */
  md5?: string | null;
}

export interface TextFileResult {
  canceled: boolean;
  filePath?: string;
  content?: string;
}

/** A metronome sound inside the app's metronome folder. */
export interface MetronomeFile {
  /** Display label: the file name without its extension. */
  name: string;
  /** Actual file name (with extension) within the metronome folder. */
  file: string;
}

export interface SaveResult {
  canceled: boolean;
  filePath?: string;
}

export interface IpcFileFilter {
  name: string;
  extensions: string[];
}

export interface IpcOpenWindowOptions {
  url: string;
  title?: string;
  width?: number;
  height?: number;
}

export type CloseMode = "ask" | "minimize" | "close";

export interface RecentProject {
  path: string;
  title: string;
}

/** Outcome of a user-triggered update check. */
export interface UpdateCheckResult {
  /** update = newer version found; current = up to date; unsupported = dev/unpackaged. */
  status: "update" | "current" | "unsupported" | "error";
  version?: string;
}

export interface IpcApi {
  openAudio: () => Promise<AudioFileResult | null>;
  readAudioFile: (filePath: string) => Promise<AudioFileResult | null>;
  openTextFile: () => Promise<TextFileResult>;
  saveTextFile: (defaultPath: string) => Promise<SaveResult>;
  saveProjectFile: (
    defaultPath: string,
    content: string,
  ) => Promise<SaveResult>;
  saveEDLFile: (defaultPath: string, content: string) => Promise<SaveResult>;
  getFilePath: (title: string) => Promise<string | null>;
  getSettings: () => Promise<SettingsData>;
  updateSettings: (patch: Partial<SettingsData>) => Promise<SettingsData>;
  /** Manually check for app updates (About page); resolves with the outcome. */
  checkForUpdates: () => Promise<UpdateCheckResult>;
  toggleDevTools: () => Promise<void>;
  /** Set the main window's page zoom factor (1 = 100%). */
  setZoom: (factor: number) => Promise<void>;
  writeProjectFile: (filePath: string, content: string) => Promise<boolean>;
  readTextFile: (filePath: string) => Promise<TextFileResult>;
  /** Read an image file as a data URL for the app background (null when missing/too large). */
  readImageAsDataUrl: (filePath: string) => Promise<string | null>;
  computeMd5: (filePath: string) => Promise<string | null>;
  /** List the metronome sounds in the app's metronome folder. */
  listMetronomes: () => Promise<MetronomeFile[]>;
  /** Reveal (creating if needed) the metronome folder in the OS file manager. */
  openMetronomeFolder: () => Promise<void>;
  /** Read a metronome sound by file name; resolves null when missing. */
  readMetronome: (file: string) => Promise<AudioFileResult | null>;
  notifyAppReady: () => Promise<void>;
  recordRecent: (filePath: string, title?: string) => Promise<void>;
  getRecents: () => Promise<RecentProject[]>;
  welcomeAction: (payload: WelcomeAction) => void;
  onMainAction: (cb: (payload: WelcomeAction) => void) => () => void;
  /** List all discovered plugins with their enabled state. */
  listPlugins: () => Promise<PluginEntry[]>;
  /** Enable/disable a plugin; resolves with the updated full list. */
  setPluginEnabled: (id: string, enabled: boolean) => Promise<PluginEntry[]>;
  /** Re-scan plugin roots and (re)load enabled plugins; resolves with the list. */
  reloadPlugins: () => Promise<PluginEntry[]>;
  /** Raw source of an enabled plugin's renderer entry, or null. */
  readPluginRenderer: (id: string) => Promise<string | null>;
  /** Reveal the user plugins folder in the system file manager. */
  openPluginsFolder: () => Promise<void>;
  /** Route a free-form call to a plugin's main-process handler. */
  invokePlugin: (
    id: string,
    method: string,
    args: unknown[],
  ) => Promise<unknown>;
  /** Fired by the main process whenever the plugin set or its state changes. */
  onPluginsChanged: (cb: () => void) => () => void;
  /** Registry plugins merged with local install state (uses the cached index). */
  marketList: () => Promise<MarketPluginView[]>;
  /** Same as marketList but forces a registry re-fetch. */
  marketRefresh: () => Promise<MarketPluginView[]>;
  /** Download, verify and install a registry plugin (defaults to latest). */
  marketInstall: (id: string, version?: string) => Promise<MarketInstallResult>;
  /** Remove a marketplace-installed plugin; false when not managed. */
  marketUninstall: (id: string) => Promise<boolean>;
  /** Pick a local .zip and install it as a plugin; null when canceled. */
  installPluginZip: () => Promise<MarketInstallResult | null>;
  /** Measure latency to an https endpoint (gh-proxy mirror). */
  pingHost: (url: string) => Promise<PingResult>;
  /** Progress events for in-flight marketplace installs. */
  onMarketProgress: (cb: (p: MarketProgress) => void) => () => void;
  /** Generic native open picker for arbitrary extensions (plugin service). */
  pickFile: (title: string, filters: IpcFileFilter[]) => Promise<string | null>;
  /** Generic native save dialog; returns the chosen path, caller writes. */
  saveFileDialog: (
    title: string,
    defaultPath: string,
    filters: IpcFileFilter[],
  ) => Promise<SaveResult>;
  /** Write UTF-8 text to an absolute path (plugin service). */
  writeTextFile: (filePath: string, content: string) => Promise<boolean>;
  /** Open an extra window loading an arbitrary page (plugin service). */
  openWindow: (opts: IpcOpenWindowOptions) => Promise<void>;
  /** Copy plain text to the system clipboard. */
  writeClipboard: (text: string) => Promise<void>;
  /** Report whether the project has unsaved edits (drives the quit guard). */
  setDirty: (dirty: boolean) => void;
  /** Allow the pending quit to proceed (after the renderer saved). */
  confirmQuit: () => Promise<void>;
  /** Main asks the renderer to save before quitting; save then confirmQuit(). */
  onQuitRequest: (cb: () => void) => () => void;
}

export type WelcomeAction =
  | { type: "new"; path?: string | null }
  | { type: "open"; path?: string | null }
  | { type: "recent"; path: string };

/**
 * Single source of truth for IPC channel names, shared by the preload bridge and
 * the main-process handlers so the two sides cannot drift. Keys mirror the
 * `IpcApi` method they implement; the trailing keys are push/subscribe channels
 * rather than request/response.
 */
export const IPC = {
  openAudio: "audio:open",
  readAudioFile: "audio:read",
  openTextFile: "text:open",
  saveTextFile: "text:save",
  saveProjectFile: "text:saveAsTxt",
  saveEDLFile: "text:saveEdl",
  readTextFile: "text:read",
  writeProjectFile: "text:write",
  writeTextFile: "text:write",
  getFilePath: "file:path",
  getSettings: "settings:get",
  updateSettings: "settings:update",
  checkForUpdates: "updates:check",
  toggleDevTools: "dev:tools",
  setZoom: "ui:zoom",
  computeMd5: "audio:md5",
  listMetronomes: "metronome:list",
  openMetronomeFolder: "metronome:open-folder",
  readMetronome: "metronome:read",
  notifyAppReady: "app:ready",
  readImageAsDataUrl: "image:read-data-url",
  recordRecent: "recents:add",
  getRecents: "recents:get",
  listPlugins: "plugins:list",
  setPluginEnabled: "plugins:set-enabled",
  reloadPlugins: "plugins:reload",
  readPluginRenderer: "plugins:renderer-source",
  openPluginsFolder: "plugins:open-folder",
  invokePlugin: "plugins:invoke",
  marketList: "plugins:market:list",
  marketRefresh: "plugins:market:refresh",
  marketInstall: "plugins:market:install",
  marketUninstall: "plugins:market:uninstall",
  installPluginZip: "plugins:market:install-zip",
  pingHost: "network:ping",
  pickFile: "io:pick",
  saveFileDialog: "io:save",
  openWindow: "win:open",
  writeClipboard: "clipboard:write",
  setDirty: "app:set-dirty",
  confirmQuit: "app:confirm-quit",
  // push / subscription channels
  welcomeAction: "welcome:action",
  pluginChanged: "plugin:changed",
  marketProgress: "plugin:market:progress",
  quitRequest: "app:quit-request",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

/** Keys of {@link IPC} that are push/subscription channels, not request/response. */
export type IpcEventKey =
  | "welcomeAction"
  | "pluginChanged"
  | "marketProgress"
  | "quitRequest";

/**
 * Keys of {@link IPC} that implement an `IpcApi` request/response method. The
 * `keyof IpcApi` intersection keeps the table honest: adding an entry whose key
 * is not an `IpcApi` method is a compile error where the typed handler is used.
 */
export type IpcMethodKey = Exclude<
  keyof typeof IPC,
  IpcEventKey | "writeTextFile" | "setDirty"
> &
  keyof IpcApi;
