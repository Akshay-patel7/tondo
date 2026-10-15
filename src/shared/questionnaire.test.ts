import { describe, expect, it } from "vitest";
import { parseClientMessage, PROTOCOL_VERSION } from "./protocol";
import { readQuestionAnswers, readQuestions } from "./questionnaire";

const params = {
  questions: [
    {
      question: "Where?",
      header: "Hosting",
      options: [
        { label: "Local", description: "Here", preview: "config" },
        { label: "Cloud", description: "There" },
      ],
    },
  ],
};

describe("questionnaire boundaries", () => {
  it("copies valid questions and supplies optional defaults", () => {
    expect(readQuestions(params)).toEqual([{ ...params.questions[0], multiSelect: false }]);
    expect(readQuestions(params)?.[0]).not.toBe(params.questions[0]);
    expect(
      readQuestions({ questions: [{ ...params.questions[0], header: undefined }] })?.[0]?.header,
    ).toBe("");
  });

  it("leaves malformed or unsupported tool arguments on the ordinary dialog path", () => {
    for (const value of [
      null,
      {},
      { questions: [] },
      { questions: Array.from({ length: 5 }, () => ({ ...params.questions[0] })) },
      { questions: [null] },
      { questions: [{ ...params.questions[0], question: " " }] },
      { questions: [{ ...params.questions[0], header: 1 }] },
      { questions: [{ ...params.questions[0], multiSelect: "yes" }] },
      { questions: [{ ...params.questions[0], options: [] }] },
      {
        questions: [
          {
            ...params.questions[0],
            options: [
              { label: "A", description: "a", preview: 1 },
              { label: "B", description: "b" },
            ],
          },
        ],
      },
    ]) {
      expect(readQuestions(value)).toBeUndefined();
    }
  });

  it("accepts copied questionnaire answers through IPC", () => {
    const answers = [
      { selected: [1], text: "" },
      { selected: [0, 2], text: "Also lint" },
    ];
    const parsed = parseClientMessage({
      v: PROTOCOL_VERSION,
      type: "answer",
      threadId: "t",
      dialogId: "d",
      answer: { answers },
    });
    expect(parsed.ok).toBe(true);
    expect(readQuestionAnswers(answers)).toEqual(answers);
    expect(readQuestionAnswers(answers)?.[0]?.selected).not.toBe(answers[0]!.selected);
  });

  it("rejects forged answer shapes, duplicates, fractions and extra fields", () => {
    for (const answers of [
      null,
      [],
      Array.from({ length: 5 }, () => ({ selected: [], text: "" })),
      [null],
      [{ selected: [0, 0], text: "" }],
      [{ selected: [-1], text: "" }],
      [{ selected: [0.5], text: "" }],
      [{ selected: [4], text: "" }],
      [{ selected: ["1"], text: "" }],
      [{ selected: [], text: 1 }],
      [{ selected: [], text: "", extra: true }],
    ]) {
      expect(readQuestionAnswers(answers)).toBeUndefined();
      expect(
        parseClientMessage({
          v: PROTOCOL_VERSION,
          type: "answer",
          threadId: "t",
          dialogId: "d",
          answer: { answers },
        }).ok,
      ).toBe(false);
    }
  });
});
