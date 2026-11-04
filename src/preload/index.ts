import { contextBridge, ipcRenderer } from "electron";
import { IPC, type IpcApi, type WelcomeAction } from "../shared/ipc";
import type { MarketProgress } from "../shared/market";

type RequestMethod = Exclude<
  keyof IpcApi,
  | "welcomeAction"
  | "onMainAction"
  | "onPluginsChanged"
  | "onMarketProgress"
  | "setDirty"
  | "onQuitRequest"
>;

/**
 * Request/response methods and their channels. Keeping this table exhaustive
 * (`Record<RequestMethod, string>`) means adding an `IpcApi` method fails to
 * compile until its channel is wired here, instead of silently missing in a
 * hand-written method body.
 */
const REQUEST_CHANNELS: Record<RequestMethod, string> = {
  openAudio: IPC.openAudio,
  readAudioFile: IPC.readAudioFile,
  openTextFile: IPC.openTextFile,
  saveTextFile: IPC.saveTextFile,
  saveProjectFile: IPC.saveProjectFile,
  saveEDLFile: IPC.saveEDLFile,
  getFilePath: IPC.getFilePath,
  getSettings: IPC.getSettings,
  updateSettings: IPC.updateSettings,
  checkForUpdates: IPC.checkForUpdates,
  toggleDevTools: IPC.toggleDevTools,
  setZoom: IPC.setZoom,
  writeProjectFile: IPC.writeProjectFile,
  readTextFile: IPC.readTextFile,
  readImageAsDataUrl: IPC.readImageAsDataUrl,
  computeMd5: IPC.computeMd5,
  listMetronomes: IPC.listMetronomes,
  openMetronomeFolder: IPC.openMetronomeFolder,
  readMetronome: IPC.readMetronome,
  notifyAppReady: IPC.notifyAppReady,
  recordRecent: IPC.recordRecent,
  getRecents: IPC.getRecents,
  listPlugins: IPC.listPlugins,
  setPluginEnabled: IPC.setPluginEnabled,
  reloadPlugins: IPC.reloadPlugins,
  readPluginRenderer: IPC.readPluginRenderer,
  openPluginsFolder: IPC.openPluginsFolder,
  invokePlugin: IPC.invokePlugin,
  getPluginData: IPC.getPluginData,
  setPluginData: IPC.setPluginData,
  getPluginPanelLayout: IPC.getPluginPanelLayout,
  setPluginPanelLayout: IPC.setPluginPanelLayout,
  marketList: IPC.marketList,
  marketRefresh: IPC.marketRefresh,
  marketInstall: IPC.marketInstall,
  marketUninstall: IPC.marketUninstall,
  installPluginZip: IPC.installPluginZip,
  pingHost: IPC.pingHost,
  pickFile: IPC.pickFile,
  saveFileDialog: IPC.saveFileDialog,
  writeTextFile: IPC.writeTextFile,
  readBinaryFile: IPC.readBinaryFile,
  writeBinaryFile: IPC.writeBinaryFile,
  openWindow: IPC.openWindow,
  writeClipboard: IPC.writeClipboard,
  confirmQuit: IPC.confirmQuit,
};

function onMainAction(cb: (payload: WelcomeAction) => void): () => void {
  const listener = (_e: unknown, payload: WelcomeAction): void => cb(payload);
  ipcRenderer.on(IPC.welcomeAction, listener);
  return () => ipcRenderer.removeListener(IPC.welcomeAction, listener);
}

function onMarketProgress(cb: (p: MarketProgress) => void): () => void {
  const listener = (_e: unknown, payload: MarketProgress): void => cb(payload);
  ipcRenderer.on(IPC.marketProgress, listener);
  return () => ipcRenderer.removeListener(IPC.marketProgress, listener);
}

function onPluginsChanged(cb: () => void): () => void {
  const listener = (): void => cb();
  ipcRenderer.on(IPC.pluginChanged, listener);
  return () => ipcRenderer.removeListener(IPC.pluginChanged, listener);
}

function onQuitRequest(cb: () => void): () => void {
  const listener = (): void => cb();
  ipcRenderer.on(IPC.quitRequest, listener);
  return () => ipcRenderer.removeListener(IPC.quitRequest, listener);
}

const requestApi = Object.fromEntries(
  (Object.keys(REQUEST_CHANNELS) as RequestMethod[]).map((method) => [
    method,
    (...args: unknown[]) =>
      ipcRenderer.invoke(REQUEST_CHANNELS[method], ...args),
  ]),
) as Record<string, (...args: unknown[]) => Promise<unknown>>;

const api = {
  ...requestApi,
  welcomeAction: (payload: WelcomeAction) =>
    ipcRenderer.send(IPC.welcomeAction, payload),
  onMainAction,
  onPluginsChanged,
  onMarketProgress,
  setDirty: (dirty: boolean) => ipcRenderer.send(IPC.setDirty, dirty),
  onQuitRequest,
} as unknown as IpcApi;

contextBridge.exposeInMainWorld("api", api);
