/**
 * Raised when a newer stretch request supersedes a render that is already in
 * flight. It is not a playback failure: the caller should stay quiet and let
 * the newest request drive the UI.
 */
export class StretchCancelledError extends Error {
  constructor(message = "stretch superseded") {
    super(message);
    this.name = "StretchCancelledError";
  }
}

export function isStretchCancelled(error: unknown): boolean {
  if (error instanceof StretchCancelledError) return true;
  return error instanceof Error && error.message === "stretch superseded";
}

/**
 * The requested rate would need an unreasonable amount of PCM. Rendering it
 * would likely crash the renderer, so playback stops with a clear message.
 */
export class StretchTooLargeError extends Error {
  constructor(readonly estimatedBytes: number) {
    super("stretch buffer too large");
    this.name = "StretchTooLargeError";
  }
}

export function isStretchTooLarge(error: unknown): boolean {
  return error instanceof StretchTooLargeError;
}
