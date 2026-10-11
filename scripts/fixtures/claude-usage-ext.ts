// Shows Claude's usage the way pi-claude-subscription-connector does, in the
// status that Settings > Accounts reads. Only e2e/accounts.e2e.ts loads it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function claudeUsageExtension(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setStatus("0-claude-max", "🧠 5h 12% · wk 34%");
  });
}
