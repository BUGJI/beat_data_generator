/**
 * Numeric admission policy.
 *
 * The developer setting `devFreeInput` switches every numeric clamp/round to a
 * pass-through. That used to be a module-level mutable flag, which made parsing
 * order-dependent (the settings parser temporarily flipped it) and leaked state
 * between tests. It is now an explicit value threaded into the pure functions
 * and schema factories that need it.
 */

export interface NumberPolicy {
  /** When true, skip clamping/rounding of user numeric values. */
  readonly free: boolean;
}

export const STRICT_NUMBERS: NumberPolicy = { free: false };
export const FREE_NUMBERS: NumberPolicy = { free: true };

export function numberPolicy(free: boolean): NumberPolicy {
  return free ? FREE_NUMBERS : STRICT_NUMBERS;
}

/**
 * IPC payload ceilings. Renderer-supplied paths and file contents cross a
 * trust boundary: without an upper bound a buggy or hostile renderer could make
 * the main process allocate an unbounded buffer. These are generous for real
 * projects and audio exports while still refusing pathological inputs.
 */
/** UTF-8 project/text writes and reads (~64 MB). */
export const MAX_TEXT_BYTES = 64 * 1024 * 1024;
/** `io:read-binary` / `io:write-binary` payloads (~256 MB). */
export const MAX_BINARY_BYTES = 256 * 1024 * 1024;
/** Whole audio files loaded for waveform/analysis (~1 GB). */
export const MAX_AUDIO_BYTES = 1024 * 1024 * 1024;
