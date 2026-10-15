// Exercises rpiv-ask-user-question's RPC wire format without installing the
// user's extensions or touching their pi profile. Answers go to the test repo.
/* oxlint-disable eslint/no-await-in-loop -- reproduce the extension's sequential RPC walker. */
import { appendFileSync } from "node:fs";
import path from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function questionnaireExtension(pi: ExtensionAPI): void {
  pi.registerTool(
    defineTool({
      name: "ask_user_question",
      label: "Questions",
      description: "Asks a questionnaire through the sequential RPC fallback",
      parameters: Type.Object({
        questions: Type.Array(
          Type.Object({
            question: Type.String(),
            header: Type.String(),
            multiSelect: Type.Optional(Type.Boolean()),
            options: Type.Array(
              Type.Object({
                label: Type.String(),
                description: Type.String(),
                preview: Type.Optional(Type.String()),
              }),
            ),
          }),
        ),
      }),
      async execute(_id, params, _signal, _onUpdate, ctx) {
        const answers: unknown[] = [];
        for (const q of params.questions) {
          const title = `${q.header ? `[${q.header}] ` : ""}${q.question}`;
          const options = q.options.map(
            (o, index) => `${index + 1}. ${o.label} — ${o.description}`,
          );
          let answer: unknown;
          if (q.multiSelect) {
            const value = await ctx.ui.input(
              `${title}\n\n${options.join("\n")}\n\nEnter numbers`,
              "1,3; custom answer",
            );
            if (value === undefined) answer = { cancelled: true };
            else {
              const [numbers = "", ...custom] = value.split(";");
              answer = {
                selected: numbers.trim()
                  ? numbers.split(",").map((number) => q.options[Number(number) - 1]!.label)
                  : [],
                text: custom.join(";").trim(),
              };
            }
          } else {
            const previews = q.options.flatMap((o, index) =>
              o.preview
                ? [`--- ${index + 1}. ${o.label} preview ---\n${o.preview.slice(0, 600)}`]
                : [],
            );
            const value = await ctx.ui.select(
              `${title}${previews.length ? `\n\n${previews.join("\n\n")}` : ""}`,
              [...options, `${options.length + 1}. Type something.`],
            );
            if (value === undefined) answer = { cancelled: true };
            else {
              const chosen = options.indexOf(value);
              answer =
                chosen >= 0
                  ? { option: q.options[chosen]!.label }
                  : {
                      text: await ctx.ui.input(
                        `${title}\n\n${options.join("\n")}\n\nType your answer:`,
                        "",
                      ),
                    };
            }
          }
          appendFileSync(
            path.join(ctx.cwd, "question-answers.jsonl"),
            `${JSON.stringify(answer)}\n`,
          );
          answers.push(answer);
          if (typeof answer === "object" && answer !== null && "cancelled" in answer) break;
        }
        return { content: [{ type: "text", text: JSON.stringify(answers) }], details: { answers } };
      },
    }),
  );
}
