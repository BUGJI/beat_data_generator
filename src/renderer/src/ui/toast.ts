import { reactive } from "vue";

/** Tiny programmatic toast queue used across renderer services and components. */

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

export const toasts = reactive<ToastItem[]>([]);

let seq = 0;

function push(type: ToastType, message: string, duration = 2600): number {
  const id = ++seq;
  toasts.push({ id, type, message });
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
};
