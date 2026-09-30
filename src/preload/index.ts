import { contextBridge, ipcRenderer } from "electron";
import { IPC, type IpcApi, type WelcomeAction } from "../shared/ipc";
import type { MarketProgress } from "../shared/market";

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

const api: IpcApi = {
  openAudio: () => ipcRenderer.invoke(IPC.openAudio),
  readAudioFile: (filePath: string) =>
    ipcRenderer.invoke(IPC.readAudioFile, filePath),
  openTextFile: () => ipcRenderer.invoke(IPC.openTextFile),
  saveTextFile: (defaultPath: string) =>
    ipcRenderer.invoke(IPC.saveTextFile, defaultPath),
  saveProjectFile: (defaultPath: string, content: string) =>
    ipcRenderer.invoke(IPC.saveProjectFile, defaultPath, content),
  saveEDLFile: (defaultPath: string, content: string) =>
    ipcRenderer.invoke(IPC.saveEDLFile, defaultPath, content),
  getFilePath: (title: string) => ipcRenderer.invoke(IPC.getFilePath, title),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  toggleDevTools: () => ipcRenderer.invoke(IPC.toggleDevTools),
  setZoom: (factor) => ipcRenderer.invoke(IPC.setZoom, factor),
  writeProjectFile: (filePath: string, content: string) =>
    ipcRenderer.invoke(IPC.writeProjectFile, filePath, content),
  computeMd5: (filePath: string) =>
    ipcRenderer.invoke(IPC.computeMd5, filePath),
  listMetronomes: () => ipcRenderer.invoke(IPC.listMetronomes),
  openMetronomeFolder: () => ipcRenderer.invoke(IPC.openMetronomeFolder),
  readMetronome: (file: string) => ipcRenderer.invoke(IPC.readMetronome, file),
  notifyAppReady: () => ipcRenderer.invoke(IPC.notifyAppReady),
  readTextFile: (filePath: string) =>
    ipcRenderer.invoke(IPC.readTextFile, filePath),
  readImageAsDataUrl: (filePath: string) =>
    ipcRenderer.invoke(IPC.readImageAsDataUrl, filePath),
  recordRecent: (filePath: string, title?: string) =>
    ipcRenderer.invoke(IPC.recordRecent, filePath, title),
  getRecents: () => ipcRenderer.invoke(IPC.getRecents),
  welcomeAction: (payload: WelcomeAction) =>
    ipcRenderer.send(IPC.welcomeAction, payload),
  onMainAction,
  listPlugins: () => ipcRenderer.invoke(IPC.listPlugins),
  setPluginEnabled: (id, enabled) =>
    ipcRenderer.invoke(IPC.setPluginEnabled, id, enabled),
  reloadPlugins: () => ipcRenderer.invoke(IPC.reloadPlugins),
  readPluginRenderer: (id: string) =>
    ipcRenderer.invoke(IPC.readPluginRenderer, id),
  openPluginsFolder: () => ipcRenderer.invoke(IPC.openPluginsFolder),
  invokePlugin: (id, method, args) =>
    ipcRenderer.invoke(IPC.invokePlugin, id, method, args),
  onPluginsChanged,
  marketList: () => ipcRenderer.invoke(IPC.marketList),
  marketRefresh: () => ipcRenderer.invoke(IPC.marketRefresh),
  marketInstall: (id, version) =>
    ipcRenderer.invoke(IPC.marketInstall, id, version),
  marketUninstall: (id) => ipcRenderer.invoke(IPC.marketUninstall, id),
  installPluginZip: () => ipcRenderer.invoke(IPC.installPluginZip),
  pingHost: (url: string) => ipcRenderer.invoke(IPC.pingHost, url),
  onMarketProgress,
  pickFile: (title, filters) =>
    ipcRenderer.invoke(IPC.pickFile, title, filters),
  saveFileDialog: (title, defaultPath, filters) =>
    ipcRenderer.invoke(IPC.saveFileDialog, title, defaultPath, filters),
  writeTextFile: (filePath, content) =>
    ipcRenderer.invoke(IPC.writeTextFile, filePath, content),
  openWindow: (opts) => ipcRenderer.invoke(IPC.openWindow, opts),
  writeClipboard: (text) => ipcRenderer.invoke(IPC.writeClipboard, text),
  setDirty: (dirty) => ipcRenderer.send(IPC.setDirty, dirty),
  confirmQuit: () => ipcRenderer.invoke(IPC.confirmQuit),
  onQuitRequest,
};

contextBridge.exposeInMainWorld("api", api);
