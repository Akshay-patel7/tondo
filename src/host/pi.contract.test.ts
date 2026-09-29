// Runs Tondo's pi client against the real pi, the pinned devDependency, offline
// with pi-ai's faux provider. Each test pins something pi does that Tondo
// relies on, so a pi release that changes it fails here.
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FauxScript } from "../../scripts/fixtures/faux-ext";
import { PiExitError, startPi, type PiProcess } from "./piProcess";
import { PiCommandError, type PiRecord } from "./piRpc";
import { signalGroup } from "./processGroup";
import { sessionFolder } from "./sessionFolder";
import { SessionIndex } from "./sessionIndex";
import { needsTrustDecision, trustArgs } from "./trust";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const piCli = path.join(
  repoRoot,
  "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
);
const extensions = ["faux-ext.ts", "dialog-ext.ts"].flatMap((file) => [
  "-e",
  path.join(repoRoot, "scripts/fixtures", file),
]);

interface PiMessage {
  role: string;
  content: string | { type: string; text?: string }[];
  stopReason?: string;
}

let workDir: string;
const running: PiProcess[] = [];
beforeEach(() => {
  workDir = realpathSync(mkdtempSync(path.join(tmpdir(), "tondo-contract-")));
});
afterEach(async () => {
  await Promise.all(running.splice(0).map((pi) => pi.stop()));
  rmSync(workDir, { recursive: true, force: true });
});

/** Starts pi in a scratch folder, with the faux provider answering from `script`. */
async function startRealPi(script: FauxScript, session: string[] = ["--no-session"]) {
  const scriptPath = path.join(workDir, "script.json");
  writeFileSync(scriptPath, JSON.stringify(script));
  const records: PiRecord[] = [];
  let waiters: { test: (record: PiRecord) => boolean; resolve: (record: PiRecord) => void }[] = [];
  const pi = await startPi(
    {
      command: process.execPath,
      args: [
        piCli,
        "--mode",
        "rpc",
        "--no-extensions",
        ...extensions,
        "--no-skills",
        "--no-context-files",
        "--offline",
        "--provider",
        "faux",
        "--model",
        "faux-1",
        ...session,
      ],
      cwd: workDir,
      env: {
        ...process.env,
        PI_CODING_AGENT_DIR: path.join(workDir, "agent"),
        TONDO_FAUX_SCRIPT: scriptPath,
      },
    },
    {
      onRecord: (record) => {
        records.push(record);
        waiters = waiters.filter((waiter) => {
          if (!waiter.test(record)) return true;
          waiter.resolve(record);
          return false;
        });
      },
      onGroup: () => {},
    },
  );
  running.push(pi);
  /** Resolves with the next record that passes `test`, or rejects if pi exits first. */
  const next = (test: (record: PiRecord) => boolean) =>
    Promise.race([
      new Promise<PiRecord>((resolve) => waiters.push({ test, resolve })),
      pi.exited.then((exit) => {
        throw new PiExitError(exit);
      }),
    ]);
  return { pi, records, next };
}

const isSettled = (record: PiRecord) => record.type === "agent_settled";

/** The text blocks of a message or tool result, joined. */
function textOf(message: unknown): string {
  const content = (message as PiMessage).content;
  if (typeof content === "string") return content;
  return content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

/** The streamed text deltas, joined. */
function streamedText(records: PiRecord[]): string {
  return records
    .map((record) => record.assistantMessageEvent as { type: string; delta?: string } | undefined)
    .map((event) => (event?.type === "text_delta" ? event.delta : ""))
    .join("");
}

/** The thread as role and text pairs, without pi's system prompt. */
async function transcript(pi: PiProcess): Promise<[string, string][]> {
  const { messages } = (await pi.rpc.request({ type: "get_messages" })).data as {
    messages: PiMessage[];
  };
  return messages
    .filter((message) => message.role !== "system")
    .map((message) => [message.role, textOf(message)]);
}

describe("pi 0.87.1's RPC protocol", () => {
  it("accepts a prompt, streams the reply, and settles once", async () => {
    const { pi, records, next } = await startRealPi({
      responses: [fauxAssistantMessage(fauxText("Hello from faux."))],
    });
    const settled = next(isSettled);
    expect(await pi.rpc.request({ type: "prompt", message: "Say hello." })).toMatchObject({
      success: true,
    });
    await settled;
    expect(records[0]!.type).toBe("agent_start");
    expect(records.filter(isSettled)).toEqual([records.at(-1)]);
    expect(streamedText(records)).toBe("Hello from faux.");
    expect(await transcript(pi)).toEqual([
      ["user", "Say hello."],
      ["assistant", "Hello from faux."],
    ]);
  });

  it("aborts mid-stream and settles", async () => {
    // 25,000 tokens at 200 a second would stream for two minutes.
    const reply = "word ".repeat(20_000);
    const { pi, records, next } = await startRealPi({
      tokensPerSecond: 200,
      responses: [fauxAssistantMessage(fauxText(reply))],
    });
    const streaming = next((record) => streamedText([record]) !== "");
    const settled = next(isSettled);
    await pi.rpc.request({ type: "prompt", message: "Write a lot." });
    await streaming;
    await pi.rpc.request({ type: "abort" });
    await settled;
    const last = records.findLast((record) => record.type === "message_end")!.message as PiMessage;
    expect(last).toMatchObject({ role: "assistant", stopReason: "aborted" });
    expect(reply.startsWith(streamedText(records))).toBe(true);
    expect((await pi.rpc.request({ type: "get_state" })).data).toMatchObject({
      isStreaming: false,
    });
  });

  it("refuses a plain prompt while busy, and delivers a steer and a follow-up in order", async () => {
    // The tool waits for the test, which keeps pi busy while the test queues messages.
    const wait = "while [ ! -e release ]; do sleep 0.02; done; echo released";
    const { pi, records, next } = await startRealPi({
      responses: [
        fauxAssistantMessage(fauxToolCall("bash", { command: wait }, { id: "call_wait" }), {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage(fauxText("Steered.")),
        fauxAssistantMessage(fauxText("Followed up.")),
      ],
    });
    const toolStarted = next((record) => record.type === "tool_execution_start");
    const settled = next(isSettled);
    await pi.rpc.request({ type: "prompt", message: "Wait for the file." });
    await toolStarted;
    await expect(pi.rpc.request({ type: "prompt", message: "Too soon." })).rejects.toThrow(
      new PiCommandError(
        "pi couldn't run prompt: Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
      ),
    );
    await pi.rpc.request({ type: "steer", message: "Change course." });
    const queued = next(
      (record) => record.type === "queue_update" && (record.followUp as string[]).length > 0,
    );
    await pi.rpc.request({ type: "follow_up", message: "And then this." });
    expect(await queued).toMatchObject({
      steering: ["Change course."],
      followUp: ["And then this."],
    });
    writeFileSync(path.join(workDir, "release"), "");
    await settled;
    expect(records.filter(isSettled)).toHaveLength(1);
    expect(await transcript(pi)).toEqual([
      ["user", "Wait for the file."],
      ["assistant", ""],
      ["toolResult", "released\n"],
      ["user", "Change course."],
      ["assistant", "Steered."],
      ["user", "And then this."],
      ["assistant", "Followed up."],
    ]);
  });

  it("runs a bash tool and reports its output", async () => {
    const { pi, records, next } = await startRealPi({
      responses: [
        fauxAssistantMessage(
          fauxToolCall("bash", { command: "echo contract" }, { id: "call_echo" }),
          {
            stopReason: "toolUse",
          },
        ),
        fauxAssistantMessage(fauxText("Done.")),
      ],
    });
    const settled = next(isSettled);
    await pi.rpc.request({ type: "prompt", message: "Run it." });
    await settled;
    expect(records.find((record) => record.type === "tool_execution_start")).toEqual({
      type: "tool_execution_start",
      toolCallId: "call_echo",
      toolName: "bash",
      args: { command: "echo contract" },
    });
    expect(records.find((record) => record.type === "tool_execution_end")).toEqual({
      type: "tool_execution_end",
      toolCallId: "call_echo",
      toolName: "bash",
      result: { content: [{ type: "text", text: "contract\n" }] },
      isError: false,
    });
  });

  it("stops a running bash tool when its input closes", async () => {
    // pi runs each bash command in a process group of its own, led by the shell.
    // The shell starts sleep before it prints its pid, because on macOS a
    // SIGKILL sent to the group while bash forks can miss the new child.
    const { pi, next } = await startRealPi({
      responses: [
        fauxAssistantMessage(
          fauxToolCall("bash", { command: "sleep 60 & echo $$; wait" }, { id: "call_sleep" }),
          {
            stopReason: "toolUse",
          },
        ),
      ],
    });
    const printed = next(
      (record) => record.type === "tool_execution_update" && textOf(record.partialResult) !== "",
    );
    await pi.rpc.request({ type: "prompt", message: "Sleep." });
    const shell = Number(textOf((await printed).partialResult).trim());
    expect(signalGroup(shell, 0)).toBe(true);
    expect(await pi.stop()).toMatchObject({ code: 0, signal: null });
    // Once killed, the group's processes linger until the system reaps them.
    await expect.poll(() => signalGroup(shell, 0)).toBe(false);
  });

  it("round-trips an extension's dialog, and answers the prompt only once the command ends", async () => {
    const { pi, next } = await startRealPi({ responses: [] });
    const asked = next(
      (record) => record.type === "extension_ui_request" && record.method === "select",
    );
    const told = next(
      (record) => record.type === "extension_ui_request" && record.method === "notify",
    );
    let answered = false;
    const accepted = pi.rpc.request({ type: "prompt", message: "/tondo-pick" }, Infinity);
    void accepted.then(() => (answered = true));
    const dialog = await asked;
    expect(dialog).toMatchObject({ title: "Pick a fruit", options: ["apple", "pear"] });
    // Tondo reads pi's output in order, so a response written before the dialog
    // would have arrived first. pi answers the prompt only once the command's
    // handler returns, which is why Tondo gives prompt no deadline.
    expect(answered).toBe(false);
    pi.rpc.send({ type: "extension_ui_response", id: dialog.id as string, value: "pear" });
    expect(await told).toMatchObject({ message: "picked pear", notifyType: "info" });
    expect(await accepted).toMatchObject({ success: true });
  });

  it("lists extension commands", async () => {
    const { pi } = await startRealPi({ responses: [] });
    const { commands } = (await pi.rpc.request({ type: "get_commands" })).data as {
      commands: unknown[];
    };
    expect(commands).toContainEqual(
      expect.objectContaining({
        name: "tondo-pick",
        description: "Asks the client to pick a fruit",
        source: "extension",
      }),
    );
  });

  it("reports a failed compaction in compaction_end before it answers compact", async () => {
    const { pi, next } = await startRealPi({ responses: [fauxAssistantMessage(fauxText("Hi."))] });
    const settled = next(isSettled);
    await pi.rpc.request({ type: "prompt", message: "Hello." });
    await settled;
    const ended = next((record) => record.type === "compaction_end");
    let reported = false;
    void ended.then(() => (reported = true));
    // pi's message starts with what failed, so Tondo shows it as it is.
    await expect(pi.rpc.request({ type: "compact" })).rejects.toThrow(
      "pi couldn't run compact: Nothing to compact (session too small)",
    );
    expect(reported).toBe(true);
    expect(await ended).toMatchObject({
      reason: "manual",
      aborted: false,
      errorMessage: "Compaction failed: Nothing to compact (session too small)",
    });
  });

  it("reports its state", async () => {
    const { pi } = await startRealPi({ responses: [] });
    expect((await pi.rpc.request({ type: "get_state" })).data).toMatchObject({
      model: expect.objectContaining({ provider: "faux", id: "faux-1" }),
      isStreaming: false,
      isCompacting: false,
      messageCount: 0,
      pendingMessageCount: 0,
    });
  });

  it("writes a --session-id thread's file at its first message, not at startup", async () => {
    const id = randomUUID();
    const { pi, next } = await startRealPi(
      { responses: [fauxAssistantMessage(fauxText("Saved."))] },
      ["--session-id", id],
    );
    const state = (await pi.rpc.request({ type: "get_state" })).data as {
      sessionFile: string;
      sessionId: string;
    };
    expect(state.sessionId).toBe(id);
    expect(existsSync(state.sessionFile)).toBe(false);
    const settled = next(isSettled);
    await pi.rpc.request({ type: "prompt", message: "Save this." });
    await settled;
    const header = JSON.parse(readFileSync(state.sessionFile, "utf8").split("\n")[0]!) as unknown;
    expect(header).toMatchObject({ type: "session", id, cwd: workDir });
  });
});

/** The environment startRealPi gives pi, as far as its session folder goes. */
const sessionEnv = () => ({
  ...(process.env as Record<string, string>),
  PI_CODING_AGENT_DIR: path.join(workDir, "agent"),
});

/** Starts a thread with --session-id, asks one thing, names it, stops pi, and returns the thread's file. */
async function namedThread(): Promise<{ id: string; file: string }> {
  const id = randomUUID();
  const { pi, next } = await startRealPi({ responses: [fauxAssistantMessage(fauxText("Done."))] }, [
    "--session-id",
    id,
  ]);
  const settled = next(isSettled);
  await pi.rpc.request({ type: "prompt", message: "Name me." });
  await settled;
  await pi.rpc.request({ type: "set_session_name", name: "Named thread" });
  const { sessionFile } = (await pi.rpc.request({ type: "get_state" })).data as {
    sessionFile: string;
  };
  await pi.stop();
  return { id, file: sessionFile };
}

describe("pi 0.87.1's session files", () => {
  it("keeps a thread where Tondo looks for it, and Tondo reads its name", async () => {
    const { id, file } = await namedThread();
    const folder = sessionFolder(workDir, [], sessionEnv());
    expect(path.dirname(file)).toBe(folder.dir);
    expect(await new SessionIndex().list(workDir, folder)).toEqual([
      expect.objectContaining({
        id,
        file,
        cwd: workDir,
        name: "Named thread",
        firstMessage: "Name me.",
      }),
    ]);
  });

  it("keeps threads where the project's sessionDir setting says, before any trust answer", async () => {
    mkdirSync(path.join(workDir, ".pi"));
    writeFileSync(
      path.join(workDir, ".pi", "settings.json"),
      JSON.stringify({ sessionDir: "threads" }),
    );
    const { id, file } = await namedThread();
    const folder = sessionFolder(workDir, [], sessionEnv());
    expect(folder).toEqual({ dir: path.join(workDir, "threads"), shared: true });
    // pi reports the file relative to the project when the setting is relative.
    expect(path.dirname(file)).toBe("threads");
    expect(path.dirname(path.resolve(workDir, file))).toBe(folder.dir);
    const listed = await new SessionIndex().list(workDir, folder);
    expect(listed.map((summary) => summary.id)).toEqual([id]);
  });

  it("resumes a thread from its file", async () => {
    const { id, file } = await namedThread();
    const { pi } = await startRealPi({ responses: [] }, ["--session", file]);
    expect((await pi.rpc.request({ type: "get_state" })).data).toMatchObject({
      sessionId: id,
      sessionFile: file,
      sessionName: "Named thread",
    });
    expect(await transcript(pi)).toEqual([
      ["user", "Name me."],
      ["assistant", "Done."],
    ]);
  });
});

/** The environment startRealPi gives pi, as far as project trust goes. */
const trustEnv = () => ({
  HOME: process.env.HOME ?? "",
  PI_CODING_AGENT_DIR: path.join(workDir, "agent"),
});

/** The prompt templates pi loads when started with `args`. */
async function promptTemplates(args: string[]): Promise<string[]> {
  const { pi } = await startRealPi({ responses: [] }, ["--no-session", ...args]);
  const { commands } = (await pi.rpc.request({ type: "get_commands" })).data as {
    commands: { name: string; source: string }[];
  };
  return commands.filter((command) => command.source === "prompt").map((command) => command.name);
}

describe("pi 0.87.1's project trust", () => {
  // The scratch folder is the project, with a prompt template as its only
  // protected file. pi lists the template only if it trusts the project.
  beforeEach(() => {
    mkdirSync(path.join(workDir, ".pi/prompts"), { recursive: true });
    writeFileSync(path.join(workDir, ".pi/prompts/tondo-hello.md"), "Say hello.\n");
  });

  it("skips the project's protected files unless Tondo passes a trust answer", async () => {
    expect(needsTrustDecision(workDir, trustEnv())).toBe(true);
    expect(await promptTemplates([])).toEqual([]);
    expect(await promptTemplates(trustArgs(workDir, trustEnv(), { [workDir]: true }))).toEqual([
      "tondo-hello",
    ]);
    expect(await promptTemplates(trustArgs(workDir, trustEnv(), { [workDir]: false }))).toEqual([]);
  });

  it.each([
    ["trust.json", { "<project>": true }, ["tondo-hello"]],
    ["trust.json", { "<project>": false }, []],
    ["settings.json", { defaultProjectTrust: "always" }, ["tondo-hello"]],
    ["settings.json", { defaultProjectTrust: "never" }, []],
  ])("settles trust by itself with %s holding %j", async (file, content, templates) => {
    const json = JSON.stringify(content).replace("<project>", workDir);
    mkdirSync(path.join(workDir, "agent"));
    writeFileSync(path.join(workDir, "agent", file), json);
    expect(needsTrustDecision(workDir, trustEnv())).toBe(false);
    // pi's own decision stands over an answer Tondo remembered.
    expect(trustArgs(workDir, trustEnv(), { [workDir]: true })).toEqual([]);
    expect(await promptTemplates([])).toEqual(templates);
  });
});
