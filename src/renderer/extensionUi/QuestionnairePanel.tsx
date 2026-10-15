import { useId, useLayoutEffect, useState } from "react";
import type { DialogAnswer } from "../../shared/protocol";
import { questionAnswered, type Question, type QuestionAnswer } from "../../shared/questionnaire";
import { answerDialog } from "../connection";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

/** Answers stay local while you browse. Only Submit releases the extension's first dialog. */
export function QuestionnairePanel({
  id,
  questions,
}: {
  id: string;
  questions: readonly Question[];
}) {
  const titleId = useId();
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<readonly QuestionAnswer[]>(() =>
    questions.map(() => ({ selected: [], text: "" })),
  );
  const question = questions[index]!;
  const answer = answers[index]!;
  const complete = questions.every((item, position) => questionAnswered(item, answers[position]!));
  const update = (next: QuestionAnswer) => setAnswers(answers.with(index, next));
  const respond = (result: DialogAnswer) => answerDialog(id, result);
  const pick = (optionIndex: number) => {
    let selected = [optionIndex];
    if (question.multiSelect) {
      selected = answer.selected.includes(optionIndex)
        ? answer.selected.filter((value) => value !== optionIndex)
        : [...answer.selected, optionIndex];
    }
    update({ selected, text: question.multiSelect ? answer.text : "" });
    if (!question.multiSelect && index < questions.length - 1) setIndex(index + 1);
  };

  useLayoutEffect(() => document.getElementById(`${titleId}-${index}`)?.focus(), [titleId, index]);

  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      data-dialog="questionnaire"
      className="rounded-panel border border-input bg-card px-4 py-3 shadow-composer will-change-transform"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          respond({ cancelled: true });
        } else if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
          event.preventDefault();
          event.stopPropagation();
          setIndex(
            Math.max(
              0,
              Math.min(questions.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)),
            ),
          );
        }
      }}
    >
      <h2 id={titleId} className="font-medium">
        Questions
      </h2>
      <nav aria-label="Questions" className="mt-2 flex flex-wrap gap-1">
        {questions.map((q, position) => (
          <Button
            // oxlint-disable-next-line react/no-array-index-key -- questions never reorder and may repeat.
            key={position}
            variant="outline"
            size="sm"
            aria-label={`Question ${position + 1}: ${q.header || q.question}`}
            aria-current={position === index ? "step" : undefined}
            aria-pressed={position === index}
            onClick={() => setIndex(position)}
          >
            {position + 1}. {q.header || `Question ${position + 1}`}
          </Button>
        ))}
      </nav>
      <div className="mt-3 max-h-64 overflow-y-auto">
        <h3
          id={`${titleId}-${index}`}
          tabIndex={-1}
          className="font-medium break-words whitespace-pre-line outline-none"
        >
          {question.question}
        </h3>
        {question.multiSelect ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Select all that apply. Leave blank for none.
          </p>
        ) : null}
        <div className="mt-2 flex flex-col gap-1">
          {question.options.map((option, optionIndex) => (
            <Button
              // oxlint-disable-next-line react/no-array-index-key -- options never reorder and may repeat.
              key={optionIndex}
              variant="outline"
              size="question"
              aria-pressed={answer.selected.includes(optionIndex)}
              onClick={() => pick(optionIndex)}
            >
              <span className="min-w-0 break-words">
                <span className="block font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.description}</span>
              </span>
            </Button>
          ))}
        </div>
        <div className="mt-2">
          <Textarea
            aria-label="Your answer"
            placeholder={
              question.multiSelect ? "Add your own answer (optional)" : "Or type your own answer"
            }
            value={answer.text}
            onChange={(event) =>
              update({
                selected: question.multiSelect ? answer.selected : [],
                text: event.target.value,
              })
            }
            className="max-h-32 min-h-12"
          />
        </div>
        {answer.selected.map((selected) =>
          question.options[selected]!.preview ? (
            <pre
              key={selected}
              className="mt-2 overflow-auto rounded-control bg-muted p-2 font-mono text-xs whitespace-pre-wrap"
            >
              {question.options[selected]!.preview}
            </pre>
          ) : null,
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => respond({ cancelled: true })}>
          Cancel
        </Button>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          Question {index + 1} of {questions.length}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            Back
          </Button>
          {index < questions.length - 1 ? (
            <Button onClick={() => setIndex(index + 1)}>Next</Button>
          ) : (
            <Button disabled={!complete} onClick={() => respond({ answers })}>
              Submit answers
            </Button>
          )}
        </div>
      </div>
      {!complete && index === questions.length - 1 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Answer each single-choice question before submitting. You can go back without losing your
          answers.
        </p>
      ) : null}
    </section>
  );
}
