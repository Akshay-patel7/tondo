// Notifications about threads that need you: an extension waits for your
// answer in a thread you can't see, on screen or behind another app.
// Clicking one opens the thread.
import { Notification, type BrowserWindow } from "electron";
import type { Attention } from "../shared/protocol";

/**
 * Returns a function that raises a notification for each thread that needs
 * you, unless its thread is on screen in the focused window. A newer
 * notification about a thread replaces the older one.
 */
export function threadNotifications(
  window: () => BrowserWindow | undefined,
  open: (threadId: string) => void,
): (attention: Attention) => void {
  // The notification on screen for each thread, so a newer one can replace it.
  const shown = new Map<string, Notification>();
  return ({ threadId, visible, title, body }) => {
    if (visible && window()?.isFocused()) return;
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title, body });
    const forget = () => {
      if (shown.get(threadId) === notification) shown.delete(threadId);
    };
    notification.on("click", () => {
      forget();
      open(threadId);
    });
    notification.on("close", forget);
    notification.on("failed", (_event, error) => {
      forget();
      console.error(`Tondo couldn't show a notification: ${error}`);
    });
    shown.get(threadId)?.close();
    shown.set(threadId, notification);
    notification.show();
  };
}
