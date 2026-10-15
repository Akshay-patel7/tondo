/** The question tool's arguments, kept separate from its sequential RPC dialogs. */
export interface Question {
  readonly question: string;
  readonly header: string;
  readonly multiSelect: boolean;
  readonly options: readonly {
    readonly label: string;
    readonly description: string;
    readonly preview?: string;
  }[];
}

export interface QuestionAnswer {
  readonly selected: readonly number[];
  readonly text: string;
}

/** Only the documented ask_user_question shape enables the native questionnaire. */
export function readQuestions(value: unknown): readonly Question[] | undefined {
  if (!record(value) || !Array.isArray(value.questions)) return undefined;
  if (value.questions.length < 1 || value.questions.length > 4) return undefined;
  const questions: Question[] = [];
  for (const q of value.questions) {
    if (!record(q) || typeof q.question !== "string" || !q.question.trim()) return undefined;
    if (q.header !== undefined && typeof q.header !== "string") return undefined;
    if (q.multiSelect !== undefined && typeof q.multiSelect !== "boolean") return undefined;
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 4) return undefined;
    const options: Question["options"][number][] = [];
    for (const option of q.options) {
      if (
        !record(option) ||
        typeof option.label !== "string" ||
        typeof option.description !== "string"
      )
        return undefined;
      if (option.preview !== undefined && typeof option.preview !== "string") return undefined;
      options.push({
        label: option.label,
        description: option.description,
        ...(option.preview === undefined ? {} : { preview: option.preview }),
      });
    }
    questions.push({
      question: q.question,
      header: q.header ?? "",
      multiSelect: q.multiSelect ?? false,
      options,
    });
  }
  return questions;
}

/** Copies a page's answers at the IPC boundary; the host also checks them against the questions. */
export function readQuestionAnswers(value: unknown): readonly QuestionAnswer[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return undefined;
  const answers: QuestionAnswer[] = [];
  for (const answer of value) {
    if (
      !record(answer) ||
      Object.keys(answer).length !== 2 ||
      typeof answer.text !== "string" ||
      !Array.isArray(answer.selected)
    )
      return undefined;
    if (
      answer.selected.length > 4 ||
      !answer.selected.every(
        (index: unknown) => Number.isInteger(index) && Number(index) >= 0 && Number(index) < 4,
      )
    )
      return undefined;
    if (new Set(answer.selected).size !== answer.selected.length) return undefined;
    answers.push({ selected: [...answer.selected], text: answer.text });
  }
  return answers;
}

export function questionAnswered(question: Question, answer: QuestionAnswer): boolean {
  return (
    answer.selected.every((index) => index < question.options.length) &&
    (question.multiSelect ||
      (answer.selected.length === 1 && !answer.text.trim()) ||
      (answer.selected.length === 0 && !!answer.text.trim()))
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
