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
  success: (m: string) => push("success", m),
  error: (m: string) => push("error", m, 3600),
  info: (m: string) => push("info", m),
  warning: (m: string) => push("warning", m, 3200),
};
