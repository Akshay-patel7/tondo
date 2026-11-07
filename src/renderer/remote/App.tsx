import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { PROTOCOL_VERSION as v, type ClientMessage } from "../../shared/protocol";
import { useHost } from "../connection";
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
  RemoteStatus,
  RemoteThreadList,
} from "../ui/remote";
import {
  createRemoteThread,
  pairRemote,
  remoteRequest,
  requestFromPage,
  retryRemoteConnection,
  selectRemoteThread,
  useRemoteConnection,
} from "./connection";

import { showRemoteThreads, useRemoteLocation } from "./navigation";

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
  const selectedId = useRemoteLocation((location) => location.threadId);
  const list = selectedId === null;
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const diffs = useDiffPanel();
  const connected = connection.state === "connected";
  const offline = !connected && connection.state !== "pairing";
  const notice = error ?? connection.error ?? errors.at(-1) ?? null;
  const selectedTitle = projects
    .flatMap((project) => project.threads)
    .find((item) => item.id === selectedId)?.title;
  let title = "Your threads";
  if (connection.state === "pairing") title = "Connect to your Mac";
  else if (!list)
    title = thread?.id === selectedId ? thread.title : (selectedTitle ?? "Opening thread…");
  let openingMessage = "This thread could not be opened. Choose another thread and try again.";
  if (offline) openingMessage = "This thread will open when your Mac reconnects.";
  else if (connection.openingThreadId) openingMessage = "Opening thread…";

  useEffect(() => {
    if (selectedId !== thread?.id) useDiffPanel.setState(false, true);
  }, [selectedId, thread?.id]);

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
    requestFromPage({ v, type: "list-checkpoints", threadId: thread.id });
  }

  return (
    <RemoteFrame>
      <RemoteHeader
        title={title}
        back={
          !list
            ? () => {
                showRemoteThreads();
                useDiffPanel.setState(false, true);
              }
            : undefined
        }
        changes={
          thread?.id === selectedId && !list && connected && !connection.openingThreadId
            ? changes
            : undefined
        }
      />
      {offline || notice ? (
        <RemoteStatus
          offline={offline}
          connecting={connection.state === "connecting"}
          error={notice}
          reconnect={retryRemoteConnection}
          dismiss={() => {
            setError(null);
            useRemoteConnection.setState({ error: null });
            useHost.setState({ errors: [] });
          }}
        />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">
        {connection.state === "pairing" ? (
          <RemotePairForm
            code={code}
            setCode={setCode}
            submit={(event) => {
              void pair(event);
            }}
            busy={pairing}
          />
        ) : list ? (
          <RemoteThreadList
            projects={projects}
            disabled={!connected || connection.creating}
            busy={connection.creating}
            choose={(id) => {
              setError(null);
              selectRemoteThread(id);
            }}
            create={(projectId) => {
              void createRemoteThread(projectId).catch((reason: unknown) =>
                setError(String(reason)),
              );
            }}
          />
        ) : !thread || thread.id !== selectedId || connection.openingThreadId ? (
          <RemoteNotice>{openingMessage}</RemoteNotice>
        ) : diffs ? (
          <Suspense fallback={<RemoteNotice>Loading changes…</RemoteNotice>}>
            <DiffPanel />
          </Suspense>
        ) : (
          <RemoteThread key={thread.id} connected={connected} />
        )}
      </div>
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
