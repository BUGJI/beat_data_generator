import { app } from "electron";
import log from "electron-log/main";

/**
 * Main-process logger.
 *
 * Writes to `<userData>/logs/main.log` (rotated at 5 MB) and mirrors a leaner
 * view to the terminal. Renderer console output is funnelled here from
 * `index.ts`, so a single file captures both processes. Everything imports this
 * shared instance so file/console levels stay consistent.
 */
log.initialize({ preload: false });

log.transports.file.level = "info";
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.console.level = app.isPackaged ? "warn" : "debug";

export default log;
