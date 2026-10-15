import type { DialogAnswer, ExtensionDialog, PrimitiveDialog } from "../shared/protocol";
import { questionAnswered, type Question, type QuestionAnswer } from "../shared/questionnaire";
import type { PiCommand } from "./piRpc";

/**
 * Adapts rpiv-ask-user-question's sequential select/input fallback. The tool's
 * execution-start event supplies all questions before the first dialog arrives.
 * Hold that dialog while the user reviews the form, then replay only the final
 * answers through the extension's own walker, keeping its result envelope intact.
 * Unrecognized dialogs still use Tondo's ordinary dialog UI.
 */
export class Questionnaire {
  private index = 0;
  private answers: readonly QuestionAnswer[] | undefined;
  private pending: PrimitiveDialog | undefined;
  private customInput = false;
  private cancelled = false;
  dialogId: string | undefined;

  readonly questions: readonly Question[];

  /** Restores the ordinary dialog if simultaneous tools make correlation ambiguous. */
  get pendingDialog(): PrimitiveDialog | undefined {
    return this.pending;
  }

  constructor(questions: readonly Question[]) {
    this.questions = questions;
  }

  receive(dialog: PrimitiveDialog): ExtensionDialog | PiCommand | undefined {
    if (this.cancelled || dialog.expiresAt !== null) return undefined;
    const question = this.questions[this.index];
    if (!question) return undefined;
    const title = `${question.header ? `[${question.header}] ` : ""}${question.question}`;
    if (dialog.title !== title && !dialog.title.startsWith(`${title}\n\n`)) return undefined;
    if (this.customInput) {
      if (dialog.method !== "input" || dialog.placeholder !== "") return undefined;
    } else if (question.multiSelect) {
      if (dialog.method !== "input" || dialog.placeholder !== "1,3; custom answer")
        return undefined;
    } else {
      if (dialog.method !== "select" || dialog.options.length !== question.options.length + 1)
        return undefined;
      if (dialog.options.at(-1) !== `${question.options.length + 1}. Type something.`)
        return undefined;
      if (
        !question.options.every(
          (option, index) =>
            dialog.options[index] === `${index + 1}. ${option.label} — ${option.description}`,
        )
      )
        return undefined;
    }
    if (this.answers) return this.respond(dialog);
    if (this.pending) return undefined;
    this.pending = dialog;
    this.dialogId = dialog.id;
    return {
      id: dialog.id,
      title: "Questions",
      expiresAt: null,
      method: "questionnaire",
      questions: this.questions,
    };
  }

  submit(answer: DialogAnswer): PiCommand {
    const pending = this.pending;
    if (!pending) throw new Error("This questionnaire is no longer waiting for an answer.");
    if ("cancelled" in answer) {
      this.pending = undefined;
      this.cancelled = true;
      return { type: "extension_ui_response", id: pending.id, cancelled: true };
    }
    if (
      !("answers" in answer) ||
      answer.answers.length !== this.questions.length ||
      !answer.answers.every((item, index) => questionAnswered(this.questions[index]!, item))
    ) {
      throw new Error("Answer every question before submitting.");
    }
    this.answers = answer.answers;
    this.pending = undefined;
    return this.respond(pending);
  }

  private respond(dialog: PrimitiveDialog): PiCommand {
    const answer = this.answers![this.index]!;
    let value: string;
    if (this.customInput) {
      value = answer.text;
      this.customInput = false;
      this.index++;
    } else if (this.questions[this.index]!.multiSelect) {
      const numbers = answer.selected.map((index) => index + 1).join(",");
      value = answer.text.trim() ? `${numbers}; ${answer.text}` : numbers;
      this.index++;
    } else if (dialog.method === "select") {
      if (answer.selected.length) {
        value = dialog.options[answer.selected[0]!]!;
        this.index++;
      } else {
        value = dialog.options.at(-1)!;
        this.customInput = true;
      }
    } else {
      throw new Error("The questionnaire expected an option dialog.");
    }
    return { type: "extension_ui_response", id: dialog.id, value };
  }
}
