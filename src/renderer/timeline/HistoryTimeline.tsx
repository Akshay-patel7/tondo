import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistoryIndex, HistoryPage, HistoryPreview } from "../../shared/history";
import { requestHistory } from "../connection";
import { useThread } from "../thread/store";
import { HistoryToolbar } from "../ui/message-navigator";
import { navigationPreview, navigationTargets } from "./navigation";
import { SavedTranscript } from "./transcript";
import { Timeline } from "./Timeline";
import { timelineRows } from "./turns";

/** Ordinary threads keep the existing hot path and never scan saved history. */
export function HistoryTimeline() {
  const messages = useThread((thread) => thread.messages);
  const compacted = useMemo(
    () => messages.some((message) => message.role === "compactionSummary"),
    [messages],
  );
  const [retry, setRetry] = useState(0);
  return compacted ? (
    <CompactedTimeline key={retry} onRetry={() => setRetry((value) => value + 1)} />
  ) : (
    <Timeline />
  );
}

function CompactedTimeline({ onRetry }: { onRetry: () => void }) {
  const messages = useThread((thread) => thread.messages);
  const targets = useMemo(() => navigationTargets(timelineRows(messages)), [messages]);
  const [index, setIndex] = useState<HistoryIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<{ id: string; request: number; value: HistoryPage } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(0);
  const [liveTarget, setLiveTarget] = useState<number | undefined>();
  const [hovered, setHovered] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ id: string; value: HistoryPreview } | null>(null);
  const generation = useRef(0);
  const archived = index?.prompts.length ?? 0;
  const cancel = useCallback(() => {
    generation.current++;
  }, []);

  useEffect(() => {
    let active = true;
    requestHistory("history-index")
      .then((result) => {
        if (active && result.kind === "index") setIndex(result.index);
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason instanceof Error ? reason.message : reason));
      });
    return () => {
      active = false;
      cancel();
    };
  }, [cancel]);

  const onPreview = useCallback((value: number | null) => setHovered(value), []);
  useEffect(() => {
    const id = hovered === null ? undefined : index?.prompts[hovered];
    if (!id || !index) return;
    let active = true;
    // Coalesce pointer motion. Only the settled selection gets file IO.
    const timer = setTimeout(() => {
      requestHistory("history-preview", index.revision, id)
        .then((result) => {
          if (active && result.kind === "preview") setPreview({ id, value: result.preview });
        })
        .catch((reason: unknown) => {
          if (active)
            setPreview({
              id,
              value: {
                prompt: "Preview unavailable",
                reply: reason instanceof Error ? reason.message : String(reason),
              },
            });
        });
    }, 100);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [hovered, index]);

  const loadPage = (id: string, target = selected) => {
    if (!index) return;
    const request = ++generation.current;
    setBusy(true);
    setError(null);
    requestHistory("history-page", index.revision, id)
      .then((result) => {
        if (request !== generation.current || result.kind !== "page") return;
        setPage({ id, request, value: result.page });
        setSelected(target);
        setBusy(false);
      })
      .catch((reason: unknown) => {
        if (request !== generation.current) return;
        setBusy(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  const latest = () => {
    generation.current++;
    setPage(null);
    setPreview(null);
    setError(null);
    setBusy(false);
    setLiveTarget(undefined);
  };

  const navigation = {
    count: archived + targets.length,
    offset: archived,
    ...(page ? { current: selected } : {}),
    preview: (target: number) => {
      if (target >= archived) return navigationPreview(targets[target - archived]!);
      const id = index?.prompts[target];
      return preview && preview.id === id
        ? preview.value
        : { prompt: "Saved message", reply: "Loading preview…" };
    },
    onPreview,
    onSelect: (target: number) => {
      if (target < archived) {
        const id = index?.prompts[target];
        if (id) loadPage(id, target);
      } else if (page) {
        generation.current++;
        setPage(null);
        setBusy(false);
        setLiveTarget(target - archived);
      } else {
        cancel();
        setBusy(false);
        return false;
      }
      return true;
    },
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {page || busy || error ? (
        <HistoryToolbar
          busy={busy}
          error={error}
          browsing={page !== null}
          previous={page?.value.previous ? () => loadPage(page.value.previous!) : undefined}
          next={page?.value.next ? () => loadPage(page.value.next!) : undefined}
          onLatest={latest}
          onRetry={onRetry}
        />
      ) : null}
      <div className="min-h-0 flex-1">
        {page ? (
          <SavedTranscript messages={page.value.messages}>
            <Timeline
              key={`${page.id}-${page.request}`}
              navigation={navigation}
              initialIndex={0}
              onLatest={latest}
            />
          </SavedTranscript>
        ) : (
          <Timeline
            key={`live-${liveTarget ?? "latest"}`}
            navigation={navigation}
            initialIndex={liveTarget === undefined ? undefined : targets[liveTarget]?.index}
          />
        )}
      </div>
    </div>
  );
}
