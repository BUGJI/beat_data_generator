import { app } from "electron";
import log from "electron-log/main";

/**
 * Main-process logger.
 *
 * Console output always goes to the terminal (debug in dev, warn+ when
 * packaged). Writing to `<userData>/logs/main.log` is opt-in via
 * Settings > Developer options and is off until settings are loaded, so a
 * normal run leaves nothing on disk. Renderer console output is funnelled here
 * from `index.ts`, so enabling the file captures both processes in one place.
 */
log.initialize({ preload: false });

log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.console.level = app.isPackaged ? "warn" : "debug";
log.transports.file.level = false;

/** Enable/disable writing logs to disk (Settings > Developer > record logs). */
export function setFileLogging(enabled: boolean): void {
  log.transports.file.level = enabled ? "info" : false;
}

export default log;
