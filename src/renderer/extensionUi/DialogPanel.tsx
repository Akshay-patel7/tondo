// An extension's dialog, in the composer's place until you answer it, the way
// pi's terminal UI swaps its editor for the dialog. Its keys are pi's: the
// arrows move, Enter picks or submits, Shift+Enter adds a line in an editor,
// and Escape cancels. T3 Code's pending-input panel
// (apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx) numbers
// options 1 to 9 for picking with a key, and so does this.
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { DialogAnswer, ExtensionDialog } from "../../shared/protocol";
import { answerDialog } from "../connection";
import { useExtensionUi } from "./store";

/** The oldest dialog waiting for an answer, or nothing. */
export function DialogPanel() {
  const dialogs = useExtensionUi((ui) => ui.dialogs);
  const dialog = dialogs[0];
  if (!dialog) return null;
  // A new dialog starts with its own highlight, text and countdown.
  return <Dialog key={dialog.id} dialog={dialog} waiting={dialogs.length} />;
}

function Dialog({ dialog, waiting }: { dialog: ExtensionDialog; waiting: number }) {
  const titleId = useId();
  const secondsLeft = useSecondsLeft(dialog.expiresAt);
  const answer = (value: DialogAnswer) => answerDialog(dialog.id, value);
  const cancel = () => answer({ cancelled: true });
  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      data-dialog={dialog.method}
      className="rounded-panel border border-border bg-card px-4 pt-3 pb-2.5 shadow-composer focus-within:border-ring"
    >
      <div className="flex items-start gap-3">
        <h2 id={titleId} className="min-w-0 flex-1 font-medium break-words whitespace-pre-line">
          {dialog.title}
          {secondsLeft === null ? null : (
            <span className="font-normal text-muted-foreground tabular-nums">
              {" "}
              ({secondsLeft}s)
            </span>
          )}
        </h2>
        {waiting > 1 ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">1/{waiting}</span>
        ) : null}
      </div>
      {dialog.method === "select" ? (
        <Choices options={dialog.options} onPick={(value) => answer({ value })} onCancel={cancel} />
      ) : dialog.method === "confirm" ? (
        <>
          {dialog.message ? (
            <p className="mt-1 text-sm break-words whitespace-pre-line text-muted-foreground">
              {dialog.message}
            </p>
          ) : null}
          <Choices
            options={["Yes", "No"]}
            onPick={(value) => answer({ confirmed: value === "Yes" })}
            onCancel={cancel}
          />
        </>
      ) : (
        <TextAnswer
          multiline={dialog.method === "editor"}
          initial={dialog.method === "editor" ? dialog.prefill : ""}
          placeholder={dialog.method === "input" ? dialog.placeholder : ""}
          label={dialog.title}
          onSubmit={(value) => answer({ value })}
          onCancel={cancel}
        />
      )}
    </section>
  );
}

/** Options to pick one of, with the arrows, a number, Enter or a click. */
function Choices({
  options,
  onPick,
  onCancel,
}: {
  options: readonly string[];
  onPick: (option: string) => void;
  onCancel: () => void;
}) {
  const [highlighted, setHighlighted] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => list.current?.focus(), []);
  useLayoutEffect(() => {
    document.getElementById(`${id}-${highlighted}`)?.scrollIntoView({ block: "nearest" });
  }, [id, highlighted]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const { key } = event;
    const digit = /^[1-9]$/.test(key) ? Number(key) - 1 : -1;
    if (key === "ArrowDown" || key === "ArrowUp") {
      const step = key === "ArrowDown" ? 1 : -1;
      setHighlighted((highlighted + step + options.length) % options.length);
    } else if (key === "Enter") {
      onPick(options[highlighted]!);
    } else if (key === "Escape") {
      onCancel();
    } else if (digit >= 0 && digit < options.length) {
      onPick(options[digit]!);
    } else {
      return;
    }
    event.preventDefault();
  };

  return (
    <>
      <div
        ref={list}
        role="listbox"
        tabIndex={0}
        aria-label="Options"
        aria-activedescendant={`${id}-${highlighted}`}
        onKeyDown={onKeyDown}
        className="mt-2 max-h-64 overflow-y-auto rounded-control outline-none"
      >
        {options.map((option, index) => (
          <div
            // Options are only text, and two can say the same thing.
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            id={`${id}-${index}`}
            role="option"
            aria-selected={index === highlighted}
            onPointerMove={() => setHighlighted(index)}
            onClick={() => onPick(option)}
            className={`flex items-center gap-3 rounded-control px-2.5 py-1.5 text-sm ${
              index === highlighted ? "bg-accent text-accent-foreground" : ""
            }`}
          >
            <span
              aria-hidden="true"
              className="w-3 shrink-0 text-xs text-muted-foreground tabular-nums"
            >
              {index < 9 ? index + 1 : ""}
            </span>
            <span className="min-w-0 flex-1 break-words whitespace-pre-line">{option}</span>
          </div>
        ))}
      </div>
      <Hint>↑↓ to move · Enter or a number to pick · Esc to cancel</Hint>
    </>
  );
}

/** A line or, for an editor, lines of text. */
function TextAnswer({
  multiline,
  initial,
  placeholder,
  label,
  onSubmit,
  onCancel,
}: {
  multiline: boolean;
  initial: string;
  placeholder: string;
  label: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);

  // An editor opens with the caret after its text, ready to add to it.
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      onSubmit(value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  const shared = {
    "aria-label": label,
    value,
    placeholder,
    onKeyDown,
    className:
      "mt-2 block w-full rounded-control border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground",
  };
  return (
    <>
      {multiline ? (
        <textarea
          {...shared}
          ref={area}
          rows={Math.min(12, Math.max(4, value.split("\n").length + 1))}
          onChange={(event) => setValue(event.target.value)}
          className={`${shared.className} max-h-80 resize-none font-mono`}
        />
      ) : (
        <input {...shared} autoFocus onChange={(event) => setValue(event.target.value)} />
      )}
      <div className="mt-2 flex items-center gap-2">
        <Hint>
          {multiline ? "Enter to submit · Shift+Enter for a new line" : "Enter to submit"} · Esc to
          cancel
        </Hint>
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-control border border-border px-2.5 py-1 text-xs hover:bg-accent hover:text-accent-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(value)}
            className="rounded-control bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Submit
          </button>
        </div>
      </div>
    </>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-xs text-muted-foreground">{children}</p>;
}

/**
 * The whole seconds left until `expiresAt`, as pi's own dialogs count them
 * down, or null for a dialog that waits for ever. It ticks as each second
 * passes, not continuously.
 */
function useSecondsLeft(expiresAt: number | null): number | null {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (expiresAt === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const left = expiresAt - current;
      if (left > 0) timer = setTimeout(tick, left % 1000 || 1000);
    };
    timer = setTimeout(tick, Math.max(0, expiresAt - Date.now()) % 1000 || 1000);
    return () => clearTimeout(timer);
  }, [expiresAt]);
  return expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - now) / 1000));
}
