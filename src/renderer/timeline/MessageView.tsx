import { ChevronRight, GitCompareArrows } from "lucide-react";
import { useId } from "react";
import { Streamdown, type LinkSafetyConfig } from "streamdown";
import type { AssistantMessage, ToolResultMessage } from "../../shared/thread";
import { useCheckpoints } from "../connection";
import { ImagePreview } from "../composer/ImagePreview";
import { showTurnChanges } from "../diffs/store";
import { useThread } from "../thread/store";
import { outputText } from "../tools/model";
import { OutputView } from "../tools/OutputView";
import { Button } from "../ui/button";
import { codeHighlighter } from "./codeHighlighter";
import { LinkDialog } from "./LinkDialog";
import { REMARK_PLUGINS } from "./reuseParses";
import {
  checkpointTurnAt,
  turnChanges,
  turnStack,
  type StackItem,
  type TimelineRow,
  type UserMessage,
} from "./turns";
import { WorkLog } from "./WorkLog";

/** Code blocks are highlighted by Shiki with its JavaScript regex engine, so no WASM. */
const MARKDOWN_PLUGINS = { code: codeHighlighter };

/** A link in a reply asks before it opens, in a ui Dialog. */
const LINK_SAFETY: LinkSafetyConfig = {
  enabled: true,
  renderModal: (props) => <LinkDialog {...props} />,
};

/**
 * Message text at 14/22, with inline code on the code fill. Streamdown gives
 * inline code its own size and fill, so the wrapper overrides them by the
 * attribute Streamdown marks it with.
 */
const MARKDOWN =
  "text-message [&_[data-streamdown=inline-code]]:rounded-sm [&_[data-streamdown=inline-code]]:bg-code-fill [&_[data-streamdown=inline-code]]:px-1 [&_[data-streamdown=inline-code]]:py-px [&_[data-streamdown=inline-code]]:text-[12.5px]";

function plainText(content: UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/**
 * A row of the timeline. Each is an article named for who wrote it. The
 * name is an aria-label rather than text, so a row's text stays exactly
 * what was said. `streaming` is the message pi is still writing, when this
 * row shows it.
 */
export function RowView({
  row,
  streaming,
  settled,
}: {
  row: TimelineRow | undefined;
  streaming: AssistantMessage | null;
  /** Whether the turn the row shows is over, so its summary can show. */
  settled: boolean;
}) {
  if (!row) {
    return streaming ? <TurnView messages={[]} streaming={streaming} settled={false} /> : null;
  }
  switch (row.kind) {
    case "user":
      return <UserView message={row.message} />;
    case "assistant":
      return (
        <TurnView
          start={row.start}
          messages={row.messages}
          streaming={streaming}
          settled={settled}
        />
      );
    case "toolResult":
      // The timeline shows a result as its own row only when its call isn't
      // in the transcript. Otherwise the call's work log row shows it.
      return <OrphanResult message={row.message} />;
    default:
      return null;
  }
}

function UserView({ message }: { message: UserMessage }) {
  return (
    <article aria-label="You" className="flex justify-end">
      <div className="max-w-[80%] rounded-panel bg-message px-4 py-2.5 text-message whitespace-pre-wrap text-message-foreground text-pretty">
        <p>{plainText(message.content)}</p>
        {typeof message.content !== "string" &&
        message.content.some((part) => part.type === "image") ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.content
              .filter((part) => part.type === "image")
              .map((image, index) => (
                // pi's content blocks keep their positions in a finished message.
                <ImagePreview
                  // oxlint-disable-next-line react/no-array-index-key
                  key={index}
                  data={image.data}
                  mimeType={image.mimeType}
                  name={`Image ${index + 1}`}
                />
              ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function TurnView({
  start = 0,
  messages,
  streaming,
  settled,
}: {
  /** The index of the turn's first message. */
  start?: number;
  messages: readonly AssistantMessage[];
  streaming: AssistantMessage | null;
  settled: boolean;
}) {
  const items = turnStack(messages, streaming);
  return (
    <article aria-label="pi" className="flex flex-col gap-4">
      {items.map((item) => (
        <StackItemView key={item.key} item={item} />
      ))}
      {settled ? <TurnSummary start={start} messages={messages} /> : null}
    </article>
  );
}

function StackItemView({ item }: { item: StackItem }) {
  switch (item.kind) {
    case "thought":
      return <Thought text={item.text} active={item.active} />;
    case "text":
      return (
        <div className={MARKDOWN}>
          <Streamdown
            plugins={MARKDOWN_PLUGINS}
            remarkPlugins={REMARK_PLUGINS}
            linkSafety={LINK_SAFETY}
            isAnimating={item.streaming}
          >
            {item.text}
          </Streamdown>
        </div>
      );
    case "workLog":
      return <WorkLog log={item} />;
    case "error":
      return <p className="text-sm text-destructive">{item.text}</p>;
    default:
      return null;
  }
}

/** The thinking behind a reply, behind a chevron. pi's messages carry no stamp for it, so no duration. */
function Thought({ text, active }: { text: string; active: boolean }) {
  return (
    <details className="group text-xs text-faint-foreground">
      <summary className="-mx-1 flex w-fit cursor-default items-center gap-1 rounded-control px-1 outline-none select-none hover:text-foreground focus-visible:focus-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="size-3 group-open:rotate-90" />
        <span className={active ? "motion-safe:animate-pulse" : undefined}>Thought</span>
      </summary>
      <div className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{text}</div>
    </details>
  );
}

/** What a finished turn changed, and the way to its diff in the Changes panel. */
function TurnSummary({
  start,
  messages,
}: {
  start: number;
  messages: readonly AssistantMessage[];
}) {
  const changes = useThread((thread) => turnChanges(messages, thread.messages));
  // The prompt's stamp places the turn among the checkpoints. pi sets it as
  // the prompt arrives; a faux reply's stamp is whenever the test wrote it.
  const startedAt = useThread((thread) => {
    const before = thread.messages[start - 1];
    return before?.role === "user" ? before.timestamp : messages[0]?.timestamp;
  });
  const turn = useCheckpoints((state) => checkpointTurnAt(state.turns, startedAt));
  const statsId = useId();
  if (!changes) return null;
  return (
    <div className="flex h-10 items-center gap-2 rounded-card border border-border bg-card pr-2 pl-3 text-xs">
      <GitCompareArrows aria-hidden className="size-3.5 shrink-0 text-faint-foreground" />
      <span id={statsId} className="flex items-center gap-2">
        <span className="font-medium">
          {changes.files} {changes.files === 1 ? "file" : "files"} changed
        </span>
        <span
          aria-label={`${changes.additions} added, ${changes.deletions} removed`}
          className="font-mono text-2xs tabular-nums"
        >
          <span className="text-addition">+{changes.additions}</span>{" "}
          <span className="text-deletion">−{changes.deletions}</span>
        </span>
      </span>
      {turn === undefined ? null : (
        <Button
          variant="neutral"
          className="ml-auto"
          aria-describedby={statsId}
          onClick={() => showTurnChanges(turn)}
        >
          View diff
        </Button>
      )}
    </div>
  );
}

function OrphanResult({ message }: { message: ToolResultMessage }) {
  return (
    <article
      aria-label={`${message.toolName} result`}
      className="rounded-card border border-border bg-card"
    >
      <p className="px-3 py-1.5 text-sm">
        <span className="font-medium">{message.toolName}</span>{" "}
        <span className="text-muted-foreground">result</span>
      </p>
      {/* Rounded like the card, so the output's inset focus ring follows the corners. */}
      <div className="overflow-hidden rounded-b-[calc(var(--card-radius)-1px)] border-t border-border [&>:last-child]:rounded-b-[calc(var(--card-radius)-1px)]">
        <OutputView
          text={outputText(message.content)}
          tone={message.isError ? "error" : "normal"}
        />
      </div>
    </article>
  );
}
