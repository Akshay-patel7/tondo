// A pi extension that registers pi-ai's faux provider and answers with a
// scripted list of assistant messages. scripts/record-fixtures.mts loads it
// with `-e` and passes the script's path in TONDO_FAUX_SCRIPT.
import { readFileSync } from "node:fs";
import { fauxProvider, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface FauxScript {
  /** Stream rate. Omit it to stream as fast as possible. */
  tokensPerSecond?: number;
  /** One entry per model call, in order. */
  responses: AssistantMessage[];
}

export default function fauxExtension(pi: ExtensionAPI): void {
  const scriptPath = process.env.TONDO_FAUX_SCRIPT;
  if (!scriptPath) throw new Error("faux-ext: TONDO_FAUX_SCRIPT is not set");
  const script = JSON.parse(readFileSync(scriptPath, "utf8")) as FauxScript;

  const faux = fauxProvider({
    provider: "faux",
    // A context window this large keeps pi from compacting the long transcript.
    models: [{ id: "faux-1", name: "Faux 1", reasoning: true, contextWindow: 100_000_000 }],
    ...(script.tokensPerSecond === undefined ? {} : { tokensPerSecond: script.tokensPerSecond }),
  });
  faux.setResponses(script.responses);
  pi.registerProvider(faux.provider);
}
