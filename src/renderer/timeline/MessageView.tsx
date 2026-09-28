import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";
import type { AssistantMessage, PiMessage } from "../../shared/thread";

/** Code blocks are highlighted by Shiki with its JavaScript regex engine, so no WASM. */
const MARKDOWN_PLUGINS = { code };

type UserContent = Extract<PiMessage, { role: "user" }>["content"];
type ContentBlock = AssistantMessage["content"][number];

function plainText(content: UserContent): string {
  if (typeof content === "string") return content;
  return content.map((part) => (part.type === "text" ? part.text : "[image]")).join("\n");
}

/** `streaming` is true while pi is still writing the message. */
export function MessageView({ message, streaming }: { message: PiMessage; streaming: boolean }) {
  switch (message.role) {
    case "user":
      return (
        <div className="flex justify-end py-3">
          <p className="max-w-[80%] rounded-panel bg-message px-4 py-2 whitespace-pre-wrap text-message-foreground">
            {plainText(message.content)}
          </p>
        </div>
      );
    case "assistant":
      return <AssistantView message={message} streaming={streaming} />;
    case "toolResult":
      return (
        <pre className="my-2 max-h-40 overflow-auto rounded-control bg-muted p-3 text-xs">
          {message.content.map((part) => (part.type === "text" ? part.text : "[image]")).join("\n")}
        </pre>
      );
    default:
      return <p className="py-2 text-sm text-muted-foreground">{message.role} message</p>;
  }
}

function AssistantView({ message, streaming }: { message: AssistantMessage; streaming: boolean }) {
  return (
    <div className="py-3">
      {message.content.map((block, index) => (
        // pi names content blocks by position (contentIndex) and only appends them.
        // oxlint-disable-next-line react/no-array-index-key
        <ContentBlockView key={index} block={block} streaming={streaming} />
      ))}
      {message.stopReason === "error" || message.stopReason === "aborted" ? (
        <p className="mt-2 text-sm text-destructive">
          {message.errorMessage ?? message.stopReason}
        </p>
      ) : null}
    </div>
  );
}

function ContentBlockView({ block, streaming }: { block: ContentBlock; streaming: boolean }) {
  switch (block.type) {
    case "thinking":
      return (
        <details className="mb-2 text-sm text-muted-foreground">
          <summary className="cursor-default select-none">Thinking</summary>
          <p className="mt-1 whitespace-pre-wrap">{block.thinking}</p>
        </details>
      );
    case "text":
      return (
        <Streamdown plugins={MARKDOWN_PLUGINS} isAnimating={streaming}>
          {block.text}
        </Streamdown>
      );
    case "toolCall":
      return (
        <pre className="my-2 rounded-control border border-border p-3 text-xs">
          {block.name} {JSON.stringify(block.arguments)}
        </pre>
      );
  }
}
