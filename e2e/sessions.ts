// pi session files for tests: where pi keeps a project's sessions, and
// sessions the tests write there. Tests never read your own sessions folder.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");

/**
 * The folder where the pi Tondo starts keeps `project`'s sessions: pi's
 * default folder, inside the pi setup an unpackaged Tondo gives pi in its
 * profile. `project` must be a real path, as the tests' temporary folders are.
 */
export function sessionFolder(profileDir: string, project: string): string {
  const name = `--${project.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(profileDir, "pi-agent", "sessions", name);
}

/** A session file's path, named the way pi names them. */
function sessionFile(folder: string, id: string, time: number): string {
  return path.join(folder, `${new Date(time).toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`);
}

const NO_TOKENS = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** The lines of a session holding `messages`, one entry each, as pi 0.87.1 writes them. */
function sessionLines(
  id: string,
  project: string,
  time: number,
  messages: readonly { timestamp: number }[],
): string[] {
  const header = {
    type: "session",
    version: 3,
    id,
    timestamp: new Date(time).toISOString(),
    cwd: project,
  };
  let parentId: string | null = null;
  return [
    JSON.stringify(header),
    ...messages.map((message, index) => {
      const entryId = index.toString(16).padStart(8, "0");
      const timestamp = new Date(message.timestamp).toISOString();
      const line = JSON.stringify({ type: "message", id: entryId, parentId, timestamp, message });
      parentId = entryId;
      return line;
    }),
  ];
}

export interface WrittenSession {
  id: string;
  file: string;
  /** What the sidebar calls it: the first question. */
  title: string;
}

/**
 * Writes `count` short sessions for `project` into `folder`, each a question
 * and its answer. Session `i` asks "Question i" and was last active `i`
 * minutes before `now`, so the sidebar lists session 0 first.
 */
export function writeSessions(
  folder: string,
  project: string,
  count: number,
  now = Date.now(),
): WrittenSession[] {
  mkdirSync(folder, { recursive: true });
  return Array.from({ length: count }, (_, index) => {
    const id = randomUUID();
    const time = now - index * 60_000;
    const title = `Question ${index}`;
    const usage = { ...NO_TOKENS, totalTokens: 0, cost: { ...NO_TOKENS, total: 0 } };
    const messages = [
      { role: "user", content: title, timestamp: time - 1_000 },
      {
        role: "assistant",
        content: [{ type: "text", text: `Answer ${index}` }],
        api: "faux",
        provider: "faux",
        model: "faux-1",
        usage,
        stopReason: "stop",
        timestamp: time,
      },
    ];
    const file = sessionFile(folder, id, time - 2_000);
    writeFileSync(file, `${sessionLines(id, project, time - 2_000, messages).join("\n")}\n`);
    return { id, file, title };
  });
}

/**
 * Writes fixtures/transcript-1000.json as a pi session for `project`, with its
 * 1,000 messages repeated `copies` times, and returns the file. Pass a
 * `folder` to write it where pi finds the project's sessions.
 */
export function seedSession(folder: string, project: string, copies = 1): string {
  const transcript = path.join(repoRoot, "fixtures/transcript-1000.json");
  const { messages } = JSON.parse(readFileSync(transcript, "utf8")) as {
    messages: { role: string; timestamp: number }[];
  };
  // pi keeps its system prompt as the session's first message.
  const [system, ...rest] = messages;
  if (system?.role !== "system") throw new Error(`${transcript} doesn't start with pi's prompt`);
  const id = randomUUID();
  const time = Date.now();
  const file = sessionFile(folder, id, time);
  const all = [system, ...Array.from({ length: copies }, () => rest).flat()];
  mkdirSync(folder, { recursive: true });
  writeFileSync(file, `${sessionLines(id, project, time, all).join("\n")}\n`);
  return file;
}
