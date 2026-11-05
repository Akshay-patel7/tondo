import { create } from "zustand";
import { clearBrowserDraft, readBrowserDraft, saveBrowserDraft } from "./storage";

export interface RemoteDraft {
  readonly text: string;
  readonly revision: number;
  readonly saved: boolean;
  readonly sending: boolean;
  readonly error: string | null;
}

export const EMPTY_REMOTE_DRAFT: RemoteDraft = {
  text: "",
  revision: 0,
  saved: true,
  sending: false,
  error: null,
};
export const useRemoteDrafts = create<ReadonlyMap<string, RemoteDraft>>(() => new Map());
let revision = 0;
let activeKey: string | undefined;

export function remoteDraftKey(threadId: string): string {
  return `tondo:remote-draft:${threadId}`;
}

function put(key: string, draft: RemoteDraft): void {
  const drafts = new Map(useRemoteDrafts.getState());
  drafts.delete(key);
  drafts.set(key, draft);
  let characters = [...drafts.values()].reduce((sum, value) => sum + value.text.length, 0);
  // Persistence is authoritative after eviction. Never evict the active editor
  // or an in-flight submission; fallback storage is deliberately bounded.
  for (const [candidate, value] of drafts) {
    if (drafts.size <= 64 && characters <= 2 * 1024 * 1024) break;
    if (candidate === key || candidate === activeKey || value.sending) continue;
    drafts.delete(candidate);
    characters -= value.text.length;
  }
  useRemoteDrafts.setState(drafts, true);
}

/** Called before a snapshot mounts an editor, not during React rendering. */
export function loadRemoteDraft(key: string): void {
  activeKey = key;
  const existing = useRemoteDrafts.getState().get(key);
  put(
    key,
    existing ?? { ...EMPTY_REMOTE_DRAFT, text: readBrowserDraft(key), revision: ++revision },
  );
}

export function editRemoteDraft(key: string, text: string): void {
  const before = useRemoteDrafts.getState().get(key) ?? EMPTY_REMOTE_DRAFT;
  put(key, { ...before, text, revision: ++revision, saved: saveBrowserDraft(key, text) });
}

export function beginRemoteSend(key: string): RemoteDraft | null {
  const draft = useRemoteDrafts.getState().get(key);
  if (!draft || draft.sending || !draft.text.trim()) return null;
  put(key, { ...draft, sending: true, error: null });
  return draft;
}

export function finishRemoteSend(
  key: string,
  submittedRevision: number,
  error: string | null,
): void {
  const draft = useRemoteDrafts.getState().get(key);
  if (!draft) return;
  if (error === null && draft.revision === submittedRevision) {
    clearBrowserDraft(key);
    put(key, { ...draft, text: "", revision: ++revision, sending: false, error: null });
  } else put(key, { ...draft, sending: false, error });
}

export function remoteDraftError(key: string, error: string): void {
  const draft = useRemoteDrafts.getState().get(key);
  if (draft) put(key, { ...draft, error });
}
