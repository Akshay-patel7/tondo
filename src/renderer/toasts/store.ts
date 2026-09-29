import { create } from "zustand";
import type { NotifyLevel } from "../../shared/protocol";

export interface Toast {
  readonly id: number;
  readonly level: NotifyLevel;
  readonly message: string;
  /** The thread it came from, when that isn't the one on screen. */
  readonly thread?: string;
}

/** The toasts on screen, oldest first. */
export const useToasts = create<readonly Toast[]>()(() => []);

/** The most toasts on screen at once. The oldest makes way for a new one. */
const MOST_TOASTS = 4;
let lastId = 0;

export function addToast(toast: Omit<Toast, "id">): void {
  const id = ++lastId;
  useToasts.setState((toasts) => [...toasts, { ...toast, id }].slice(-MOST_TOASTS), true);
}

export function dismissToast(id: number): void {
  useToasts.setState((toasts) => toasts.filter((toast) => toast.id !== id), true);
}
