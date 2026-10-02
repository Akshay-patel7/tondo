// A pi extension that registers pi-ai's faux provider and answers with a
// scripted list of assistant messages. scripts/record-fixtures.mts loads it
// with `-e` and passes the script's path in TONDO_FAUX_SCRIPT.
import { readFileSync, writeFileSync } from "node:fs";
import { fauxProvider, type AssistantMessage, type TranscriptContext } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface FauxScript {
  /** Stream rate. Omit it to stream as fast as possible. */
  tokensPerSecond?: number;
  /** One entry per model call, in order. */
  responses: AssistantMessage[];
  /** Optional test-owned file recording the user messages the provider actually received. */
  recordInputs?: string;
}

export default function fauxExtension(pi: ExtensionAPI): void {
  const scriptPath = process.env.TONDO_FAUX_SCRIPT;
  if (!scriptPath) throw new Error("faux-ext: TONDO_FAUX_SCRIPT is not set");
  const script = JSON.parse(readFileSync(scriptPath, "utf8")) as FauxScript;

  const faux = fauxProvider({
    provider: "faux",
    models: [
      // A context window this large keeps pi from compacting the long transcript.
      {
        id: "faux-1",
        name: "Faux 1",
        input: ["text", "image"],
        reasoning: true,
        contextWindow: 100_000_000,
      },
      // A model to switch to, whose context meter shows more than 0%.
      { id: "faux-2", name: "Faux 2", reasoning: false, contextWindow: 200_000 },
    ],
    ...(script.tokensPerSecond === undefined ? {} : { tokensPerSecond: script.tokensPerSecond }),
  });
  const recordInputs = script.recordInputs;
  faux.setResponses(
    recordInputs
      ? script.responses.map((response) => (context: TranscriptContext) => {
          writeFileSync(
            recordInputs,
            JSON.stringify(context.messages.filter((message) => message.role === "user")),
          );
          return response;
        })
      : script.responses,
  );
  pi.registerProvider(faux.provider);
}
