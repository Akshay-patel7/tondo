// A pi extension for the contract tests in src/host/pi.contract.test.ts. Its
// /tondo-pick command asks the client to choose with a select dialog, then
// reports the choice in a notification. /tondo-wait asks with a dialog that
// times out, then reports what pi answered for the client.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function dialogExtension(pi: ExtensionAPI): void {
  pi.registerCommand("tondo-pick", {
    description: "Asks the client to pick a fruit",
    handler: async (_args, ctx) => {
      const choice = await ctx.ui.select("Pick a fruit", ["apple", "pear"]);
      ctx.ui.notify(`picked ${choice ?? "nothing"}`, "info");
    },
  });

  pi.registerCommand("tondo-wait", {
    description: "Asks a question that times out",
    handler: async (_args, ctx) => {
      const confirmed = await ctx.ui.confirm("Still there?", "", { timeout: 100 });
      ctx.ui.notify(`confirmed ${confirmed}`, "info");
    },
  });
}
