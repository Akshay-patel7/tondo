import { describe, expect, it } from "vitest";
import type { PrimitiveDialog } from "../shared/protocol";
import type { Question } from "../shared/questionnaire";
import { Questionnaire } from "./questionnaire";

const questions: readonly Question[] = [
  {
    question: "Where?",
    header: "Hosting",
    multiSelect: false,
    options: [
      { label: "Local", description: "On this machine" },
      { label: "Cloud", description: "On a server", preview: "cloud config" },
    ],
  },
  {
    question: "Which checks?",
    header: "Checks",
    multiSelect: true,
    options: [
      { label: "Unit", description: "Fast checks" },
      { label: "E2E", description: "Real app" },
    ],
  },
];

function select(id = "first"): PrimitiveDialog {
  return {
    id,
    method: "select",
    title: "[Hosting] Where?\n\n--- 2. Cloud preview ---\ncloud config",
    expiresAt: null,
    options: ["1. Local — On this machine", "2. Cloud — On a server", "3. Type something."],
  };
}
function input(id = "second"): PrimitiveDialog {
  return {
    id,
    method: "input",
    title: "[Checks] Which checks?\n\n1. Unit — Fast checks\n2. E2E — Real app\n\nEnter numbers",
    placeholder: "1,3; custom answer",
    expiresAt: null,
  };
}

describe("questionnaire RPC adapter", () => {
  it("holds the first dialog and exposes all questions without answering pi", () => {
    const form = new Questionnaire(questions);
    expect(form.receive(select())).toEqual({
      id: "first",
      method: "questionnaire",
      title: "Questions",
      expiresAt: null,
      questions,
    });
    expect(form.receive(select())).toBeUndefined();
  });

  it("replays reviewed selections and combined multi-select/custom answers", () => {
    const form = new Questionnaire(questions);
    form.receive(select());
    expect(
      form.submit({
        answers: [
          { selected: [1], text: "" },
          { selected: [1, 0], text: "Also lint; and types\nnext line" },
        ],
      }),
    ).toEqual({ type: "extension_ui_response", id: "first", value: "2. Cloud — On a server" });
    expect(form.receive(input())).toEqual({
      type: "extension_ui_response",
      id: "second",
      value: "2,1; Also lint; and types\nnext line",
    });
    expect(form.receive(input("extra"))).toBeUndefined();
  });

  it("uses the custom sentinel and its follow-up input, even for numeric custom text", () => {
    const form = new Questionnaire(questions);
    form.receive(select());
    expect(
      form.submit({
        answers: [
          { selected: [], text: "2" },
          { selected: [], text: "1,2" },
        ],
      }),
    ).toMatchObject({ value: "3. Type something." });
    expect(
      form.receive({
        id: "custom",
        method: "input",
        title: "[Hosting] Where?\n\nType your answer:",
        expiresAt: null,
        placeholder: "",
      }),
    ).toEqual({ type: "extension_ui_response", id: "custom", value: "2" });
    expect(form.receive(input())).toMatchObject({ value: "; 1,2" });
  });

  it("allows an explicitly empty multi-select", () => {
    const form = new Questionnaire([questions[1]!]);
    expect(form.receive(input())).toMatchObject({ method: "questionnaire" });
    expect(form.submit({ answers: [{ selected: [], text: "" }] })).toMatchObject({ value: "" });
  });

  it("rejects incomplete or out-of-range answers without losing the pending dialog", () => {
    const form = new Questionnaire(questions);
    form.receive(select());
    for (const answers of [
      [],
      [
        { selected: [], text: "" },
        { selected: [], text: "" },
      ],
      [
        { selected: [2], text: "" },
        { selected: [], text: "" },
      ],
      [
        { selected: [0, 1], text: "" },
        { selected: [], text: "" },
      ],
    ]) {
      expect(() => form.submit({ answers })).toThrow("Answer every question");
    }
    expect(form.submit({ cancelled: true })).toEqual({
      type: "extension_ui_response",
      id: "first",
      cancelled: true,
    });
    expect(form.receive(select("again"))).toBeUndefined();
    expect(() => form.submit({ cancelled: true })).toThrow("no longer waiting");
  });

  it("does not capture unrelated, changed-format or timed dialogs", () => {
    const form = new Questionnaire(questions);
    expect(form.receive({ ...select(), title: "An unrelated question" })).toBeUndefined();
    expect(form.receive({ ...select(), expiresAt: 1000 })).toBeUndefined();
    expect(
      form.receive({ ...select(), method: "select", options: ["Local", "Cloud"] }),
    ).toBeUndefined();
    expect(
      form.receive({
        ...select(),
        method: "select",
        options: ["1. Local — On this machine", "2. Cloud — On a server", "3. Skip"],
      }),
    ).toBeUndefined();
    expect(form.receive({ ...select(), method: "input", placeholder: "" })).toBeUndefined();
    expect(form.receive(select())).toMatchObject({ method: "questionnaire" });
    form.submit({
      answers: [
        { selected: [0], text: "" },
        { selected: [0], text: "" },
      ],
    });
    expect(
      form.receive({ ...input(), method: "input", placeholder: "Different format" }),
    ).toBeUndefined();
    expect(form.receive(input())).toMatchObject({ value: "1" });
  });
});
