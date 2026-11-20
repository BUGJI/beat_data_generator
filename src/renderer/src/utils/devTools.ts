/** Toggle Electron DevTools for the current window via the main process. */
export async function openDevTools(): Promise<void> {
  await window.api.toggleDevTools();
}
