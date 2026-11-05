const THREAD = "tondo:remote-thread";

export function rememberedThread(): string | null {
  try {
    return sessionStorage.getItem(THREAD);
  } catch {
    return null;
  }
}

export function rememberThread(id: string): void {
  try {
    sessionStorage.setItem(THREAD, id);
  } catch {
    /* Navigation can still work without browser persistence. */
  }
}

export function forgetThread(): void {
  try {
    sessionStorage.removeItem(THREAD);
  } catch {
    /* No persisted selection to forget. */
  }
}

export function readBrowserDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function saveBrowserDraft(key: string, text: string): boolean {
  try {
    localStorage.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

export function clearBrowserDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* A sent message must still clear its in-memory editor. */
  }
}
