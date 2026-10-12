import type { PiStatus } from "../../shared/protocol";
import { chordLabel } from "../../shared/shortcuts";
import { isMac } from "../platform";

const QUEUE = chordLabel({ key: "enter", mod: false, shift: false, alt: true }, isMac);

export const MESSAGE_PLACEHOLDER = "Message pi — @ for files, / for commands";

/**
 * What the empty composer says: that pi is starting or missing, how to queue
 * a follow-up while pi works, or `idle`, the invitation to write.
 */
export function composerPlaceholder(
  pi: PiStatus,
  working: boolean,
  idle = MESSAGE_PLACEHOLDER,
): string {
  if (pi.state === "starting") return "Starting pi…";
  if (pi.state !== "ready") return "pi isn't running";
  return working ? `Steer pi, or ${QUEUE} to queue a follow-up` : idle;
}
