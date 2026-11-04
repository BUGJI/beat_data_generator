/** True when the element accepts text input, so global shortcuts must yield. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}

/**
 * True when the element is an interactive control that owns Space / Enter
 * activation, so global playback shortcuts must not also fire.
 */
export function ownsActivationKey(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return !!el.closest("button, a[href], [role='button'], [role='tab']");
}
