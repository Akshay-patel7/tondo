// Only the image e2e tests load this extension, in their own pi processes.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function imageExtension(pi: ExtensionAPI): void {
  pi.on("input", (event) => {
    if (event.text === "Exit before image acknowledgement." && event.images?.length)
      process.exit(75);
  });
  pi.registerCommand("tondo-image-noop", {
    description: "Checks that an extension command leaves attached images in the draft",
    handler: async (_args, ctx) => {
      ctx.ui.notify("Command ran; images stay local", "info");
    },
  });
}
