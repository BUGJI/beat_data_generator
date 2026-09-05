import { contextBridge, ipcRenderer } from "electron";
import type { IpcApi } from "../shared/ipc";

const api: IpcApi = {
  openAudio: () => ipcRenderer.invoke("audio:open"),
  readAudioFile: (filePath: string) =>
    ipcRenderer.invoke("audio:read", filePath),
  openTextFile: () => ipcRenderer.invoke("text:open"),
  saveTextFile: (defaultPath: string, content: string) =>
    ipcRenderer.invoke("text:save", defaultPath, content),
  saveProjectFile: (defaultPath: string, content: string) =>
    ipcRenderer.invoke("text:saveAsTxt", defaultPath, content),
  getFilePath: (title: string) => ipcRenderer.invoke("file:path", title),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  toggleDevTools: () => ipcRenderer.invoke("dev:tools"),
};

contextBridge.exposeInMainWorld("api", api);
