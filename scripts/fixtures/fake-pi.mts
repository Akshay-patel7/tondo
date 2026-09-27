// Stands in for `pi --mode rpc` in the host's tests. It answers get_state,
// prompt and abort, replays fixtures/tools.jsonl after a prompt, and
// misbehaves the way FAKE_PI_FAULT says. src/host/piProcess.test.ts expects
// the text and sizes used here.
import { readFileSync } from "node:fs";
import path from "node:path";

type Fault =
  | "none"
  | "crash-mid-stream"
  | "malformed-line"
  | "u2028"
  | "crlf"
  | "huge-line"
  | "stop-reading"
  | "never-answer";
type PiRecord = { type: string } & Record<string, unknown>;

const fault = (process.env.FAKE_PI_FAULT ?? "none") as Fault;
const fixture = path.resolve(import.meta.dirname, "../../fixtures/tools.jsonl");
const replayed = readFileSync(fixture, "utf8")
  .trim()
  .split("\n")
  .map((line) => (JSON.parse(line) as { record: PiRecord }).record)
  // The fixture holds the recorded prompt's response. This fake writes its own.
  .filter((record) => record.type !== "response");

const eol = fault === "crlf" ? "\r\n" : "\n";
const write = (record: unknown, then?: () => void) =>
  process.stdout.write(JSON.stringify(record) + eol, then);

function respond(command: PiRecord, data?: unknown): void {
  write({ id: command.id, type: "response", command: command.type, success: true, data });
}

function replay(): void {
  const middle = Math.floor(replayed.length / 2);
  for (const [index, record] of replayed.entries()) {
    if (index === middle) {
      if (fault === "crash-mid-stream") {
        // A stack trace, half a record, then the exit an uncaught exception
        // would cause. Each write finishes before the next starts.
        process.stderr.write("Error: fake pi crashed mid-stream\n    at replay\n", () =>
          process.stdout.write('{"type":"message_update","assistantMe', () => process.exit(1)),
        );
        return;
      }
      if (fault === "malformed-line") process.stdout.write(`this is not JSON${eol}`);
      if (fault === "u2028") write({ type: "fake_text", text: "before\u2028between\u2029after" });
      if (fault === "huge-line") write({ type: "fake_text", text: "x".repeat(10 * 1024 * 1024) });
    }
    write(record);
  }
}

function handle(command: PiRecord): void {
  if (fault === "never-answer" && command.type === "get_state") return;
  switch (command.type) {
    case "get_state":
      respond(command, { isStreaming: false, messageCount: 0, sessionId: "fake" });
      return;
    case "prompt":
      respond(command);
      replay();
      return;
    case "abort":
      respond(command);
      return;
    default:
      write({
        id: command.id,
        type: "response",
        command: command.type,
        success: false,
        error: `Unknown command: ${command.type}`,
      });
  }
}

let buffered = "";
process.stdin.setEncoding("utf8");
const onData = (chunk: string) => {
  buffered += chunk;
  let newline = buffered.indexOf("\n");
  while (newline !== -1) {
    const line = buffered.slice(0, newline).replace(/\r$/, "");
    buffered = buffered.slice(newline + 1);
    if (line) handle(JSON.parse(line) as PiRecord);
    if (fault === "stop-reading") {
      // Stop reading after the first command and ignore SIGTERM, as a pi
      // whose event loop is stuck would. The timer keeps the process alive
      // once stdin stops holding it open.
      process.stdin.off("data", onData);
      process.stdin.pause();
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 60_000);
      return;
    }
    newline = buffered.indexOf("\n");
  }
};
process.stdin.on("data", onData);
// pi exits when its input closes.
process.stdin.on("end", () => process.exit(0));
