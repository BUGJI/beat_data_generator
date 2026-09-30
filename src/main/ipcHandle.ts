import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { IPC, type IpcApi, type IpcMethodKey } from "../shared/ipc";

/**
 * Typed registration for request/response IPC handlers.
 *
 * The channel comes from the shared {@link IPC} table and the argument/return
 * types are bound to the matching `IpcApi` method, so a handler cannot be
 * registered under a stray channel or with a signature that disagrees with what
 * the preload bridge promises the renderer.
 */

/** Resolved return type of an `IpcApi` request/response method. */
export type IpcResult<K extends IpcMethodKey> = Awaited<ReturnType<IpcApi[K]>>;

type IpcListener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export function handle<K extends IpcMethodKey>(
  method: K,
  fn: (
    event: IpcMainInvokeEvent,
    ...args: Parameters<IpcApi[K]>
  ) => IpcResult<K> | Promise<IpcResult<K>>,
): void {
  ipcMain.handle(IPC[method], fn as unknown as IpcListener);
}
