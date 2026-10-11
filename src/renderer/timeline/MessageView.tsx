import { ChevronRight } from "lucide-react";
import { Streamdown, type LinkSafetyConfig } from "streamdown";
import type { AssistantMessage, PiMessage, ToolResultMessage } from "../../shared/thread";
import { outputText } from "../tools/model";
import { OutputView } from "../tools/OutputView";
import { ToolCard } from "../tools/ToolCard";
import { ImagePreview } from "../composer/ImagePreview";
import { codeHighlighter } from "./codeHighlighter";
import { LinkDialog } from "./LinkDialog";
import { REMARK_PLUGINS } from "./reuseParses";

/** Code blocks are highlighted by Shiki with its JavaScript regex engine, so no WASM. */
const MARKDOWN_PLUGINS = { code: codeHighlighter };

/** A link in a reply asks before it opens, in a ui Dialog. */
const LINK_SAFETY: LinkSafetyConfig = {
  enabled: true,
  renderModal: (props) => <LinkDialog {...props} />,
};

type UserContent = Extract<PiMessage, { role: "user" }>["content"];
type ContentBlock = AssistantMessage["content"][number];

function plainText(content: UserContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

/**
 * `streaming` is true while pi is still writing the message. Each message is an
 * article named for who wrote it. The name is an aria-label rather than text,
 * so a row's text stays exactly what was said.
 */
export function MessageView({ message, streaming }: { message: PiMessage; streaming: boolean }) {
  switch (message.role) {
    case "user":
      return (
        <article aria-label="You" className="flex justify-end py-3">
          <div className="max-w-[80%] rounded-panel bg-message px-4 py-2 whitespace-pre-wrap text-message-foreground">
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
    case "assistant":
      return <AssistantView message={message} streaming={streaming} />;
    case "toolResult":
      // The timeline shows a result as its own row only when its call isn't
      // in the transcript. Otherwise the call's card shows it.
      return <OrphanResult message={message} />;
    default:
      return <p className="py-2 text-sm text-muted-foreground">{message.role} message</p>;
  }
}

function AssistantView({ message, streaming }: { message: AssistantMessage; streaming: boolean }) {
  return (
    <article aria-label="pi" className="py-3">
      {message.content.map((block, index) => (
        // pi names content blocks by position (contentIndex) and only appends them.
        <ContentBlockView
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          block={block}
          streaming={streaming}
          thinking={streaming && index === message.content.length - 1}
        />
      ))}
      {message.stopReason === "error" || message.stopReason === "aborted" ? (
        <p className="mt-2 text-sm text-destructive">
          {message.errorMessage ?? message.stopReason}
        </p>
      ) : null}
    </article>
  );
}

function ContentBlockView({
  block,
  streaming,
  thinking,
}: {
  block: ContentBlock;
  streaming: boolean;
  thinking: boolean;
}) {
  switch (block.type) {
    case "thinking":
      return (
        <details className="group mb-2 text-sm text-muted-foreground">
          <summary className="-mx-1 flex w-fit cursor-default items-center gap-1 rounded-control px-1 outline-none select-none hover:text-foreground focus-visible:focus-ring">
            <ChevronRight aria-hidden className="size-3.5 group-open:rotate-90" />
            <span className={thinking ? "motion-safe:animate-pulse" : undefined}>Thinking</span>
          </summary>
          <p className="mt-1 whitespace-pre-wrap">{block.thinking}</p>
        </details>
      );
    case "text":
      return (
        <Streamdown
          plugins={MARKDOWN_PLUGINS}
          remarkPlugins={REMARK_PLUGINS}
          linkSafety={LINK_SAFETY}
          isAnimating={streaming}
        >
          {block.text}
        </Streamdown>
      );
    case "toolCall":
      return <ToolCard call={block} writing={streaming} />;
  }
}

function OrphanResult({ message }: { message: ToolResultMessage }) {
  return (
    <article
      aria-label={`${message.toolName} result`}
      className="my-2 rounded-control border border-border bg-card"
    >
      <p className="px-3 py-1.5 text-sm">
        <span className="font-medium">{message.toolName}</span>{" "}
        <span className="text-muted-foreground">result</span>
      </p>
      {/* Rounded like a tool card's body, so the output's inset focus ring follows the corners. */}
      <div className="overflow-hidden rounded-b-[calc(var(--control-radius)-1px)] border-t border-border [&>:last-child]:rounded-b-[calc(var(--control-radius)-1px)]">
        <OutputView
          text={outputText(message.content)}
          tone={message.isError ? "error" : "normal"}
        />
      </div>
    </article>
  );
}
