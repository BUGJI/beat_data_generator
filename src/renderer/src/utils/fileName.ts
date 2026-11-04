/**
 * Turn a project / song name into a safe base file name for dialogs.
 * Characters that are invalid on Windows are replaced; empty or whitespace-only
 * names fall back so a save dialog never opens with an unusable name.
 */
export function safeFileBase(
  name: string | null | undefined,
  fallback = "untitled",
): string {
  return (name ?? "").replace(/[\\/:*?"<>|]/g, "_").trim() || fallback;
}
