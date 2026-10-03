import { expect, it } from "vitest";
import { parseClientMessage, PROTOCOL_VERSION } from "./protocol";
import type { TerminalCommand } from "./terminal";
const v = PROTOCOL_VERSION;
const session = { threadId: "thread", terminalId: "pty" };
const commands: TerminalCommand[] = [
  { type: "terminal-open", threadId: "thread", kind: "shell" },
  { type: "terminal-open", threadId: "thread", kind: "login" },
  { type: "terminal-close", ...session },
  { type: "terminal-write", ...session, data: "echo hello\r" },
  { type: "terminal-resize", ...session, cols: 80, rows: 24 },
  { type: "terminal-attach", ...session, attachment: "view", cols: 80, rows: 24 },
  { type: "terminal-detach", ...session, attachment: "view" },
  { type: "terminal-ack", ...session, attachment: "view", sequence: 1 },
];
it.each(commands)("validates $type and rejects extra fields", (command) => {
  expect(parseClientMessage({ v, ...command })).toEqual({ ok: true, message: { v, ...command } });
  expect(parseClientMessage({ v, ...command, cwd: "/tmp" }).ok).toBe(false);
  expect(parseClientMessage({ v, ...command, threadId: null }).ok).toBe(false);
});
it.each([0, -1, 1.5, Infinity, NaN, 501, "80"])("rejects unsafe columns %s", (cols) => {
  expect(parseClientMessage({ v, type: "terminal-resize", ...session, cols, rows: 24 }).ok).toBe(
    false,
  );
});
it("rejects oversized writes and empty attachments", () => {
  expect(
    parseClientMessage({ v, type: "terminal-write", ...session, data: "x".repeat(16_385) }).ok,
  ).toBe(false);
  expect(
    parseClientMessage({ v, type: "terminal-ack", ...session, attachment: "", sequence: 1 }).ok,
  ).toBe(false);
});
