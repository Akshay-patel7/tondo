// A pi extension that calls every method of pi's RPC extension UI, for the
// e2e tests in e2e/extensions.e2e.ts and the contract tests in
// src/host/pi.contract.test.ts. Its notifications report what came back, so a
// test can check each answer's round trip.
import { existsSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function uiExtension(pi: ExtensionAPI): void {
  pi.registerCommand("tondo-ui", {
    description: "Calls every extension UI method",
    handler: async (_args, ctx) => {
      ctx.ui.setStatus("tondo", "Checking the extension UI");
      ctx.ui.setWidget("tondo-above", ["Widget above the composer"]);
      ctx.ui.setWidget("tondo-below", ["Widget below the composer", "  second line"], {
        placement: "belowEditor",
      });
      ctx.ui.setTitle("Tondo UI test");
      ctx.ui.notify("The extension says hello", "warning");
      const fruit = await ctx.ui.select("Pick a fruit", ["apple", "pear", "plum"]);
      const sure = await ctx.ui.confirm("Keep going?", "The extension asks before it goes on.");
      const name = await ctx.ui.input("Your name?", "Name");
      const note = await ctx.ui.editor("Edit the note", "first line");
      const late = await ctx.ui.select("Answer in time", ["now", "later"], { timeout: 1500 });
      ctx.ui.setWidget("tondo-above", undefined);
      ctx.ui.setStatus("tondo", undefined);
      ctx.ui.setEditorText("Text from the extension");
      ctx.ui.notify(
        `fruit=${fruit} sure=${sure} name=${name} note=${JSON.stringify(note)} late=${late}`,
        "info",
      );
    },
  });

  // Waits until the file named in its argument exists, then says so and asks.
  // A test switches threads first, so both come from a thread off screen.
  pi.registerCommand("tondo-ask-when", {
    description: "Asks a question once a file exists",
    handler: async (file, ctx) => {
      // oxlint-disable-next-line eslint/no-await-in-loop -- polls for the file the test creates.
      while (!existsSync(file.trim())) await new Promise((resolve) => setTimeout(resolve, 20));
      ctx.ui.notify("The build is ready", "info");
      const answer = await ctx.ui.select("Deploy now?", ["Deploy", "Wait"]);
      ctx.ui.notify(`answer=${answer}`, "info");
    },
  });
}
