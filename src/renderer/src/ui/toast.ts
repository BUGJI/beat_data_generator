import { reactive } from "vue";
import { t } from "../utils/text";

/** Tiny programmatic toast queue used across renderer services and components. */

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  action?: ToastAction;
}

export const toasts = reactive<ToastItem[]>([]);

let seq = 0;

function push(
  type: ToastType,
  message: string,
  duration = 2600,
  action?: ToastAction,
): number {
  const id = ++seq;
  toasts.push({ id, type, message, action });
  if (duration > 0) window.setTimeout(() => dismissToast(id), duration);
  return id;
}

export function dismissToast(id: number): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i >= 0) toasts.splice(i, 1);
}

export const toast = {
  success: (m: string, duration?: number) => push("success", m, duration),
  error: (m: string, duration?: number) => push("error", m, duration ?? 3600),
  info: (m: string, duration?: number) => push("info", m, duration),
  warning: (m: string, duration?: number) =>
    push("warning", m, duration ?? 3200),
  undo: (m: string, run: () => void, duration = 5000) =>
    push("info", m, duration, { label: t("a11y.undo"), run }),
  action: (
    m: string,
    label: string,
    run: () => void,
    duration = 6000,
    type: ToastType = "info",
  ) => push(type, m, duration, { label, run }),
};
