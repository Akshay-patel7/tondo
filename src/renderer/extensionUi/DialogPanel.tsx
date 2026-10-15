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
import type { DialogAnswer, PrimitiveDialog } from "../../shared/protocol";
import { answerDialog } from "../connection";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd } from "../ui/kbd";
import { Textarea } from "../ui/textarea";
import { useExtensionUi } from "./store";
import { QuestionnairePanel } from "./QuestionnairePanel";

/** The oldest dialog waiting for an answer, or nothing. */
export function DialogPanel() {
  const dialogs = useExtensionUi((ui) => ui.dialogs);
  const dialog = dialogs[0];
  if (!dialog) return null;
  if (dialog.method === "questionnaire") {
    return <QuestionnairePanel key={dialog.id} id={dialog.id} questions={dialog.questions} />;
  }
  // A new dialog starts with its own highlight, text and countdown.
  return <Dialog key={dialog.id} dialog={dialog} waiting={dialogs.length} />;
}

function Dialog({ dialog, waiting }: { dialog: PrimitiveDialog; waiting: number }) {
  const titleId = useId();
  const messageId = useId();
  const secondsLeft = useSecondsLeft(dialog.expiresAt);
  const answer = (value: DialogAnswer) => answerDialog(dialog.id, value);
  const cancel = () => answer({ cancelled: true });
  const message = dialog.method === "confirm" ? dialog.message : "";
  return (
    // The card gets its own raster layer, like the composer card it stands in
    // for, and takes that card's look: --card on an --input edge, 16 px corners.
    <section
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={message ? messageId : undefined}
      data-dialog={dialog.method}
      className="rounded-panel border border-input bg-card px-4 py-3 shadow-composer will-change-transform"
    >
      <div className="flex items-start gap-3">
        {/* The countdown is part of the title, so the dialog's name says the time left. */}
        <h2 id={titleId} className="min-w-0 flex-1 font-medium break-words whitespace-pre-line">
          {dialog.title}
          {secondsLeft === null ? null : (
            <span className="font-normal text-faint-foreground tabular-nums">
              {" "}
              ({secondsLeft}s)
            </span>
          )}
        </h2>
        {waiting > 1 ? (
          <span className="tabular-nums">
            <Badge variant="secondary">1/{waiting}</Badge>
          </span>
        ) : null}
      </div>
      {message ? (
        <p id={messageId} className="mt-1 break-words whitespace-pre-line text-muted-foreground">
          {message}
        </p>
      ) : null}
      {dialog.method === "select" ? (
        <Choices options={dialog.options} onPick={(value) => answer({ value })} onCancel={cancel} />
      ) : dialog.method === "confirm" ? (
        <Choices
          options={["Yes", "No"]}
          onPick={(value) => answer({ confirmed: value === "Yes" })}
          onCancel={cancel}
        />
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
        className="mt-2 max-h-64 overflow-y-auto rounded-control outline-none focus-visible:focus-ring"
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
            className={`flex min-h-7 items-center gap-3 rounded-control px-2.5 py-1 ${
              index === highlighted ? "bg-accent text-accent-foreground" : ""
            }`}
          >
            {/* The number is the key that picks the option, not part of its name. */}
            {index < 9 ? (
              <Kbd aria-hidden="true">{index + 1}</Kbd>
            ) : (
              <span aria-hidden="true" className="w-5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 break-words whitespace-pre-line">{option}</span>
          </div>
        ))}
      </div>
      <div className="mt-3">
        <Hint>
          <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move · <Kbd>Enter</Kbd> or a number to pick · <Kbd>Esc</Kbd>{" "}
          to cancel
        </Hint>
      </div>
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

  return (
    <>
      {multiline ? (
        // An editor's text is monospace, as in pi's terminal UI, so the
        // wrapper sets the font the field inherits. It grows with its text,
        // from four lines to fifteen.
        <div className="mt-2 font-mono">
          <Textarea
            ref={area}
            aria-label={label}
            value={value}
            onKeyDown={onKeyDown}
            onChange={(event) => setValue(event.target.value)}
            className="max-h-80 min-h-24 resize-none"
          />
        </div>
      ) : (
        <Input
          aria-label={label}
          value={value}
          placeholder={placeholder}
          autoFocus
          onKeyDown={onKeyDown}
          onValueChange={(next) => setValue(next)}
          className="mt-2"
        />
      )}
      <div className="mt-3 flex items-center gap-2">
        <Hint>
          <Kbd>Enter</Kbd> to submit
          {multiline ? (
            <>
              {" "}
              · <Kbd>Shift+Enter</Kbd> for a new line
            </>
          ) : null}{" "}
          · <Kbd>Esc</Kbd> to cancel
        </Hint>
        <div className="ml-auto flex shrink-0 gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit(value)}>Submit</Button>
        </div>
      </div>
    </>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-2xs text-faint-foreground">{children}</p>;
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
