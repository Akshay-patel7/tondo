// A pi extension for the contract tests in src/host/pi.contract.test.ts. Its
// /tondo-pick command asks the client to choose with a select dialog, then
// reports the choice in a notification.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function dialogExtension(pi: ExtensionAPI): void {
  pi.registerCommand("tondo-pick", {
    description: "Asks the client to pick a fruit",
    handler: async (_args, ctx) => {
      const choice = await ctx.ui.select("Pick a fruit", ["apple", "pear"]);
      ctx.ui.notify(`picked ${choice ?? "nothing"}`, "info");
    },
  });
}
