import { lazy, Suspense, useState, type FormEvent } from "react";
import { PROTOCOL_VERSION as v, type ClientMessage } from "../../shared/protocol";
import { useHost } from "../connection";
import { Button } from "../ui/button";
import { Banners } from "../banners/Banners";
import { DialogPanel } from "../extensionUi/DialogPanel";
import { useExtensionUi } from "../extensionUi/store";
import { useThread, useThreadKey } from "../thread/store";
import { HistoryTimeline } from "../timeline/HistoryTimeline";
import { useDiffPanel } from "../diffs/store";
import {
  RemoteComposer,
  RemoteFooter,
  RemoteFrame,
  RemoteHeader,
  RemoteNotice,
  RemotePairForm,
  RemoteSessionControls,
  RemoteThreadList,
} from "../ui/remote";
import {
  pairRemote,
  remoteRequest,
  retryRemoteConnection,
  selectRemoteThread,
  useRemoteConnection,
} from "./connection";

import {
  beginRemoteSend,
  editRemoteDraft,
  EMPTY_REMOTE_DRAFT,
  finishRemoteSend,
  remoteDraftError,
  remoteDraftKey,
  useRemoteDrafts,
} from "./draft";

const DiffPanel = lazy(() =>
  import("../diffs/DiffPanel").then((module) => ({ default: module.DiffPanel })),
);

export function RemoteApp() {
  const connection = useRemoteConnection();
  const thread = useHost((host) => host.thread);
  const projects = useHost((host) => host.projects);
  const errors = useHost((host) => host.errors);
  const [list, setList] = useState(false);
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diffs = useDiffPanel();
  const connected = connection.state === "connected";

  async function pair(event: FormEvent): Promise<void> {
    event.preventDefault();
    setPairing(true);
    setError(null);
    try {
      await pairRemote(code);
      setCode("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
    setPairing(false);
  }

  function changes(): void {
    if (!thread) return;
    useDiffPanel.setState(true, true);
    void remoteRequest({ v, type: "list-checkpoints", threadId: thread.id }).catch(
      (reason: unknown) => setError(String(reason)),
    );
  }

  return (
    <RemoteFrame>
      <RemoteHeader
        title={
          connection.state === "pairing"
            ? "Connect to your Mac"
            : list || !thread
              ? "Your threads"
              : thread.title
        }
        back={
          thread && !list
            ? () => {
                setList(true);
                useDiffPanel.setState(false, true);
              }
            : undefined
        }
        changes={thread && !list && connected ? changes : undefined}
      />
      {!connected && connection.state !== "pairing" ? (
        <RemoteNotice>
          {connection.state === "connecting"
            ? "Connecting to your Mac…"
            : "Offline · your agents keep running on your Mac"}
          {connection.state === "offline" ? (
            <Button variant="outline" className="ml-2" onClick={retryRemoteConnection}>
              Reconnect
            </Button>
          ) : null}
        </RemoteNotice>
      ) : null}
      {connection.error || error || errors.at(-1) ? (
        <RemoteNotice error>
          {error ?? connection.error ?? errors.at(-1)}
          <Button
            variant="ghost"
            className="ml-2"
            aria-label="Dismiss error"
            onClick={() => {
              setError(null);
              useRemoteConnection.setState({ error: null });
              useHost.setState({ errors: [] });
            }}
          >
            Dismiss
          </Button>
        </RemoteNotice>
      ) : null}
      {connection.state === "pairing" ? (
        <RemotePairForm
          code={code}
          setCode={setCode}
          submit={(event) => {
            void pair(event);
          }}
          busy={pairing}
        />
      ) : list || !thread ? (
        <RemoteThreadList
          projects={projects}
          disabled={!connected}
          choose={(id) => {
            setList(false);
            setError(null);
            selectRemoteThread(id);
          }}
          create={(projectId) => {
            void remoteRequest({ v, type: "new-thread", projectId }).then(
              () => setList(false),
              (reason: unknown) => setError(String(reason)),
            );
          }}
        />
      ) : diffs ? (
        <Suspense fallback={<RemoteNotice>Loading changes…</RemoteNotice>}>
          <DiffPanel />
        </Suspense>
      ) : (
        <RemoteThread key={thread.id} connected={connected} />
      )}
    </RemoteFrame>
  );
}

function RemoteThread({ connected }: { connected: boolean }) {
  const thread = useHost((host) => host.thread);
  const threadKey = useThreadKey();
  const historyOmitted = useRemoteConnection((state) => state.historyOmitted);
  const running = useThread((state) => state.running);
  const queued = useThread((state) => state.queue.steering.length + state.queue.followUp.length);
  const asking = useExtensionUi((ui) => ui.dialogs.length > 0);
  const key = remoteDraftKey(thread?.id ?? "");
  const { text, saved, sending, error } = useRemoteDrafts(
    (drafts) => drafts.get(key) ?? EMPTY_REMOTE_DRAFT,
  );
  const ready = thread?.pi.state === "ready";
  const session = thread?.pi.state === "ready" ? thread.pi.session : undefined;
  const [updatingSession, setUpdatingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  async function changeSession(
    message: Extract<ClientMessage, { type: "set-model" | "set-thinking-level" }>,
  ): Promise<void> {
    setUpdatingSession(true);
    setSessionError(null);
    try {
      await remoteRequest(message);
    } catch (reason) {
      setSessionError(reason instanceof Error ? reason.message : String(reason));
    }
    setUpdatingSession(false);
  }

  async function send(): Promise<void> {
    if (!thread) return;
    const submitted = beginRemoteSend(key);
    if (!submitted) return;
    try {
      await remoteRequest({
        v,
        type: "prompt",
        threadId: thread.id,
        text: submitted.text,
        streamingBehavior: "steer",
      });
      finishRemoteSend(key, submitted.revision, null);
    } catch (reason) {
      finishRemoteSend(
        key,
        submitted.revision,
        reason instanceof Error ? reason.message : String(reason),
      );
    }
  }

  return (
    <>
      <main className="min-h-0 flex-1">
        <HistoryTimeline key={threadKey} browseSaved={historyOmitted} />
      </main>
      <RemoteFooter>
        <Banners />
        {!saved && text !== "" ? (
          <RemoteNotice error>
            This browser could not save the draft. Keep this thread open until you send or copy it.
          </RemoteNotice>
        ) : null}
        {error ? <RemoteNotice error>{error}</RemoteNotice> : null}
        {sessionError ? <RemoteNotice error>{sessionError}</RemoteNotice> : null}
        {thread?.askingTrust ? (
          <RemoteNotice>Approve this project on your Mac before sending messages.</RemoteNotice>
        ) : null}
        {!ready && !thread?.askingTrust ? (
          <RemoteNotice>
            Waiting for pi. Check Tondo on your Mac if it needs attention.
          </RemoteNotice>
        ) : null}
        {queued > 0 ? (
          <RemoteNotice>
            {queued} message{queued === 1 ? "" : "s"} queued
          </RemoteNotice>
        ) : null}
        <DialogPanel />
        {!asking ? (
          <RemoteComposer
            controls={
              session && thread ? (
                <RemoteSessionControls
                  session={session}
                  disabled={!connected || updatingSession}
                  model={(option) => {
                    void changeSession({
                      v,
                      type: "set-model",
                      threadId: thread.id,
                      provider: option.provider,
                      modelId: option.id,
                    });
                  }}
                  thinking={(level) => {
                    void changeSession({
                      v,
                      type: "set-thinking-level",
                      threadId: thread.id,
                      level,
                    });
                  }}
                />
              ) : null
            }
            text={text}
            setText={(value) => editRemoteDraft(key, value)}
            send={() => {
              void send();
            }}
            disabled={!connected || !ready || Boolean(thread?.askingTrust)}
            busy={sending}
            running={running}
            stop={() => {
              if (thread)
                void remoteRequest({ v, type: "stop", threadId: thread.id }).catch(
                  (reason: unknown) => remoteDraftError(key, String(reason)),
                );
            }}
          />
        ) : null}
      </RemoteFooter>
    </>
  );
}
