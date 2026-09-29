// Records the fixtures in fixtures/ by running the real pi (the pinned
// devDependency) in RPC mode with pi-ai's faux provider and saving every
// record pi writes to stdout, stamped with the milliseconds since the prompt.
// Run it with `pnpm fixtures`. It never touches ~/.pi/agent.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type AssistantMessage,
  type JsonObject,
} from "@earendil-works/pi-ai";
import {
  longReply,
  seededRandom,
  shortReply,
  thinking,
  toolCommand,
  userPrompt,
} from "./fixtures/content.mts";
import type { FauxScript } from "./fixtures/faux-ext.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const piCli = path.join(
  repoRoot,
  "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
);
const extension = path.join(repoRoot, "scripts/fixtures/faux-ext.ts");
const toolExtension = path.join(repoRoot, "scripts/fixtures/tool-ext.ts");
const outDir = path.join(repoRoot, "fixtures");
/** Bounds a hung pi. A healthy run finishes long before it. */
const DEADLINE_MS = 5 * 60_000;

type PiRecord = { type: string } & Record<string, unknown>;
interface Recorded {
  t: number;
  record: PiRecord;
}
interface Waiter {
  test: (record: PiRecord) => boolean;
  resolve: (record: PiRecord) => void;
  reject: (error: Error) => void;
}

interface PiOptions {
  /** More arguments for pi, such as another extension. */
  args?: string[];
  /** Files to create, by path relative to the folder pi runs in. */
  files?: Record<string, string>;
}

/** One pi process in RPC mode, with the stdout framing pi's rpc.md asks for. */
class Pi {
  records: Recorded[] = [];
  private clock = performance.now();
  private stderr = "";
  private waiters: Waiter[] = [];
  private readonly child;
  private readonly exited: Promise<number | null>;

  constructor(script: FauxScript, workDir: string, { args = [], files = {} }: PiOptions = {}) {
    const scriptPath = path.join(workDir, "script.json");
    writeFileSync(scriptPath, JSON.stringify(script));
    const project = path.join(workDir, "project");
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
      writeFileSync(path.join(project, file), content);
    }
    mkdirSync(project, { recursive: true });
    this.child = spawn(
      process.execPath,
      [
        piCli,
        "--mode",
        "rpc",
        "--no-extensions",
        "-e",
        extension,
        "--no-skills",
        "--no-context-files",
        "--no-session",
        "--offline",
        "--provider",
        "faux",
        "--model",
        "faux-1",
        ...args,
      ],
      {
        cwd: project,
        env: {
          ...process.env,
          PI_CODING_AGENT_DIR: path.join(workDir, "agent"),
          TONDO_FAUX_SCRIPT: scriptPath,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.exited = new Promise((resolve) =>
      this.child.on("exit", (code) => {
        for (const waiter of this.waiters) {
          waiter.reject(new Error(`pi exited with code ${code}.\n${this.stderr}`));
        }
        resolve(code);
      }),
    );
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => (this.stderr += chunk));

    // Split on LF only and strip a trailing CR. Don't use readline, which also
    // splits on U+2028 and U+2029 inside JSON strings.
    let buffered = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      buffered += chunk;
      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline).replace(/\r$/, "");
        buffered = buffered.slice(newline + 1);
        if (line) this.receive(JSON.parse(line) as PiRecord);
        newline = buffered.indexOf("\n");
      }
    });
  }

  private receive(record: PiRecord): void {
    const t = Math.round((performance.now() - this.clock) * 10) / 10;
    this.records.push({ t, record });
    this.waiters = this.waiters.filter((waiter) => {
      if (!waiter.test(record)) return true;
      waiter.resolve(record);
      return false;
    });
  }

  send(command: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  /** Clears the log, restarts the clock and sends the command. */
  sendFresh(command: Record<string, unknown>): void {
    this.records = [];
    this.clock = performance.now();
    this.send(command);
  }

  /** Resolves with the first record that passes `test`. */
  until(test: (record: PiRecord) => boolean): Promise<PiRecord> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`pi did not answer within ${DEADLINE_MS} ms.\n${this.stderr}`)),
        DEADLINE_MS,
      );
      this.waiters.push({
        test,
        resolve: (record) => {
          clearTimeout(timer);
          resolve(record);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  async prompt(message: string): Promise<Recorded[]> {
    const settled = this.until((record) => record.type === "agent_settled");
    this.sendFresh({ id: "prompt", type: "prompt", message });
    await settled;
    return this.records;
  }

  /** Closing stdin is pi's shutdown signal. */
  async close(): Promise<void> {
    this.child.stdin.end();
    let timer: NodeJS.Timeout | undefined;
    const code = await Promise.race([
      this.exited,
      new Promise<"hung">((resolve) => (timer = setTimeout(() => resolve("hung"), 10_000))),
    ]);
    clearTimeout(timer);
    if (code === "hung") {
      this.child.kill("SIGKILL");
      throw new Error("pi did not exit after stdin closed.");
    }
    if (code !== 0) throw new Error(`pi exited with code ${code}.\n${this.stderr}`);
  }
}

async function withPi<T>(
  script: FauxScript,
  run: (pi: Pi) => Promise<T>,
  options?: PiOptions,
): Promise<T> {
  const workDir = mkdtempSync(path.join(tmpdir(), "tondo-fixtures-"));
  const pi = new Pi(script, workDir, options);
  try {
    const result = await run(pi);
    await pi.close();
    return result;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Writes `data` as fixtures/<name>, formatted the way `pnpm format` formats it. */
function writeJson(name: string, data: unknown): void {
  const file = path.join(outDir, name);
  writeFileSync(file, JSON.stringify(data));
  execFileSync(path.join(repoRoot, "node_modules/.bin/oxfmt"), [file]);
}

function writeJsonl(name: string, records: Recorded[]): void {
  const file = path.join(outDir, name);
  writeFileSync(file, records.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  console.log(`${name}: ${records.length} records, last at ${records.at(-1)?.t} ms`);
}

/** 80,000 characters is 20,000 tokens by the faux provider's 4-characters-per-token count. */
const LONG_REPLY = longReply(1, 80_000);
const LONG_PROMPT = "Walk me through the parser rewrite, with code.";

async function recordStream(tokensPerSecond: number): Promise<void> {
  const records = await withPi(
    { tokensPerSecond, responses: [fauxAssistantMessage(fauxText(LONG_REPLY))] },
    (pi) => pi.prompt(LONG_PROMPT),
  );
  writeJsonl(`stream-${tokensPerSecond}.jsonl`, records);
}

async function recordTools(): Promise<void> {
  const random = seededRandom(2);
  const responses = [
    fauxAssistantMessage(
      [
        fauxThinking(thinking(random)),
        fauxText("I'll list the source files first."),
        fauxToolCall("bash", { command: toolCommand(random) }, { id: "call_tools_1" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxText(shortReply(random, 1500))),
  ];
  const records = await withPi({ tokensPerSecond: 1000, responses }, (pi) =>
    pi.prompt("Which files does the parser touch?"),
  );
  writeJsonl("tools.jsonl", records);
}

const PARSER = `import { tokenize, type Token } from "./lexer";

export interface Node {
  kind: string;
  value: string;
}

export function parse(source: string): Node[] {
  const nodes: Node[] = [];
  for (const token of tokenize(source)) {
    nodes.push(toNode(token));
  }
  return nodes;
}

function toNode(token: Token): Node {
  return { kind: token.type, value: token.text };
}
`;

const LEXER = `export interface Token {
  type: "word" | "number" | "space";
  text: string;
}

export function* tokenize(source: string): Generator<Token> {
  for (const match of source.matchAll(/(\\d+)|(\\s+)|(\\S+)/g)) {
    const [text, number, space] = match;
    yield { type: number ? "number" : space ? "space" : "word", text };
  }
}
`;

/** A reply that calls each tool in `list`. The calls' ids are `${id}_0`, `${id}_1` and so on. */
function calls(id: string, list: [string, JsonObject][]): AssistantMessage {
  return fauxAssistantMessage(
    list.map(([name, args], index) => fauxToolCall(name, args, { id: `${id}_${index}` })),
    { stopReason: "toolUse" },
  );
}

/**
 * A turn that calls every tool pi has built in, plus word_count from
 * scripts/fixtures/tool-ext.ts, in a small project. pi runs them for real.
 * Its get_messages transcript is fixtures/tool-cards.json, which the tool
 * card tests open as a session. grep and find need ripgrep and fd on PATH,
 * since pi runs offline and won't download them. pi's powershell tool runs
 * only on Windows, so elsewhere its call fails, and the fixture keeps that
 * failed card.
 */
async function recordToolCards(): Promise<void> {
  const responses = [
    calls("look", [
      ["ls", { path: "src" }],
      ["find", { pattern: "*.ts" }],
      ["grep", { pattern: "export function", path: "src" }],
      ["read", { path: "src/parser.ts" }],
      ["bash", { command: "wc -l src/*.ts" }],
      ["powershell", { command: "Get-ChildItem src" }],
      ["word_count", { path: "README.md" }],
    ]),
    calls("change", [
      [
        "edit",
        {
          path: "src/parser.ts",
          edits: [
            {
              oldText: "  for (const token of tokenize(source)) {\n    nodes.push(toNode(token));",
              newText:
                '  for (const token of tokenize(source)) {\n    if (token.type === "space") continue;\n    nodes.push(toNode(token));',
            },
          ],
        },
      ],
      [
        "write",
        {
          path: "src/kinds.ts",
          content:
            'export const KINDS = ["word", "number"] as const;\n\nexport type Kind = (typeof KINDS)[number];\n',
        },
      ],
    ]),
    fauxAssistantMessage(
      fauxText("The parser skips spaces now, and src/kinds.ts lists the kinds a node can have."),
    ),
  ];
  await withPi(
    { responses },
    async (pi) => {
      await pi.prompt("Make the parser skip spaces, and list the node kinds in their own file.");
      const answered = pi.until((record) => record.type === "response" && record.id === "messages");
      pi.send({ id: "messages", type: "get_messages" });
      const response = (await answered) as {
        success?: boolean;
        data?: { messages?: { role: string; isError?: boolean; toolName?: string }[] };
      };
      const messages = response.data?.messages;
      if (!response.success || !messages) throw new Error("get_messages failed");
      const failed = messages.filter((message) => message.role === "toolResult" && message.isError);
      // powershell fails everywhere but Windows, and the fixture keeps that failure.
      if (failed.some((message) => message.toolName !== "powershell")) {
        throw new Error(`A tool failed: ${JSON.stringify(failed)}`);
      }
      writeJson("tool-cards.json", response.data);
      console.log(`tool-cards.json: ${messages.length} messages`);
    },
    {
      args: [
        "-e",
        toolExtension,
        "--tools",
        "read,bash,powershell,edit,write,grep,find,ls,word_count",
      ],
      files: {
        "README.md": "# Parser\n\nA small parser that turns source text into nodes.\n",
        "src/parser.ts": PARSER,
        "src/lexer.ts": LEXER,
      },
    },
  );
}

async function recordError(): Promise<void> {
  const random = seededRandom(4);
  const responses = [
    fauxAssistantMessage(fauxText(shortReply(random, 600)), {
      stopReason: "error",
      errorMessage: "Faux provider error: the request was rejected.",
    }),
  ];
  const records = await withPi({ tokensPerSecond: 1000, responses }, (pi) =>
    pi.prompt("Explain the cache."),
  );
  writeJsonl("error.jsonl", records);
}

async function recordAbort(): Promise<void> {
  const records = await withPi(
    { tokensPerSecond: 200, responses: [fauxAssistantMessage(fauxText(LONG_REPLY))] },
    async (pi) => {
      // Abort after 50 deltas (about 200 tokens), the way Esc would.
      let deltas = 0;
      const streaming = pi.until((record) => {
        const update = record.assistantMessageEvent as { type?: string } | undefined;
        if (update?.type === "text_delta") deltas++;
        return deltas === 50;
      });
      const settled = pi.prompt(LONG_PROMPT);
      await streaming;
      pi.send({ id: "abort", type: "abort" });
      return settled;
    },
  );
  writeJsonl("abort.jsonl", records);
}

async function recordTranscript(): Promise<void> {
  // 150 tool turns (user, tool call, tool result, reply) and 200 plain turns
  // (user, reply) make exactly 1,000 messages. pi adds its system prompt as
  // one more message at the start.
  const random = seededRandom(3);
  const kinds = [...Array<"tool">(150).fill("tool"), ...Array<"plain">(200).fill("plain")];
  for (let index = kinds.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [kinds[index], kinds[swap]] = [kinds[swap]!, kinds[index]!];
  }

  const prompts: string[] = [];
  const responses: AssistantMessage[] = [];
  kinds.forEach((kind, turn) => {
    prompts.push(userPrompt(random));
    const size = random() < 0.1 ? 6000 : 300 + Math.floor(random() * 2000);
    if (kind === "tool") {
      responses.push(
        fauxAssistantMessage(
          [
            ...(random() < 0.5 ? [fauxThinking(thinking(random))] : []),
            fauxToolCall("bash", { command: toolCommand(random) }, { id: `call_${turn}` }),
          ],
          { stopReason: "toolUse" },
        ),
      );
    }
    responses.push(fauxAssistantMessage(fauxText(shortReply(random, size))));
  });

  await withPi({ responses }, async (pi) => {
    // oxlint-disable-next-line eslint/no-await-in-loop -- a conversation's prompts run in order.
    for (const prompt of prompts) await pi.prompt(prompt);
    const answered = pi.until((record) => record.type === "response" && record.id === "messages");
    pi.send({ id: "messages", type: "get_messages" });
    const response = (await answered) as {
      success?: boolean;
      data?: { messages?: { role: string }[] };
    };
    const messages = response.data?.messages;
    if (!response.success || !messages) throw new Error("get_messages failed");
    const system = messages.filter((message) => message.role === "system").length;
    if (system !== 1 || messages.length !== 1001) {
      throw new Error(
        `Expected 1 system message and 1,000 more, got ${system} of ${messages.length}`,
      );
    }
    writeJson("transcript-1000.json", response.data);
    console.log(`transcript-1000.json: ${messages.length} messages`);
  });
}

mkdirSync(outDir, { recursive: true });
const only = process.argv[2];
const recorders: Record<string, () => Promise<void>> = {
  "stream-1000": () => recordStream(1000),
  "stream-200": () => recordStream(200),
  tools: recordTools,
  "tool-cards": recordToolCards,
  error: recordError,
  abort: recordAbort,
  transcript: recordTranscript,
};
for (const [name, record] of Object.entries(recorders)) {
  // One pi at a time, so recordings don't compete for the CPU and skew their timing.
  // oxlint-disable-next-line eslint/no-await-in-loop
  if (!only || only === name) await record();
}
