import { installAppIpc } from "./ipc/app";
import { installFileIpc } from "./ipc/files";

/** Registers every ipcMain handler. Call once, after `app.whenReady`. */
export function installIpc(): void {
  installFileIpc();
  installAppIpc();
}
