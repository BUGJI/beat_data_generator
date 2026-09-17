/**
 * Global "free input" flag.
 *
 * Developer setting (`devFreeInput`) that removes numeric min/max/precision
 * limits from every input field, allowing any positive or negative number.
 *
 * Kept as a plain module-level flag rather than a Pinia store so that shared
 * zod schemas, tempo math, the playback service and the renderer UI can all
 * consult it without pulling in framework dependencies. The main process also
 * bundles this module (it is dependency-free), so persisted settings are
 * sanitized with the same rules the renderer uses.
 */
let freeInput = false;

export function setFreeInput(v: boolean): void {
  freeInput = v;
}

export function isFreeInput(): boolean {
  return freeInput;
}
