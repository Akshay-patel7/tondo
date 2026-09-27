import { once } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { PiCommandError, PiRpc, STDERR_TAIL_CHARS, type PiRecord } from "./piRpc";

/** Written after a test's output, so the test knows when the client has read all of it. */
const MARKER = '{"type":"test_marker"}\n';

function connect(stdin: Writable = new PassThrough()) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const records: PiRecord[] = [];
  const problems: string[] = [];
  let marker = Promise.withResolvers<void>();
  const rpc = new PiRpc(
    { stdin, stdout, stderr },
    {
      onRecord: (record) => {
        if (record.type === "test_marker") marker.resolve();
        else records.push(record);
      },
      onProtocolError: (message) => problems.push(message),
    },
  );
  return {
    rpc,
    stdout,
    stderr,
    records,
    problems,
    /** The commands written since the last call. */
    sent(): PiRecord[] {
      const text = (stdin as PassThrough).read() as Buffer | null;
      return (text?.toString() ?? "")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as PiRecord);
    },
    /** Writes `text` as pi's output and resolves once the client has read it. */
    async pi(text: string): Promise<void> {
      marker = Promise.withResolvers<void>();
      stdout.write(text + MARKER);
      await marker.promise;
    },
  };
}

/** A stdin whose writes finish only when the test says, like a pipe pi isn't reading. */
class HeldStdin extends Writable {
  readonly lines: string[] = [];
  private readonly held: (() => void)[] = [];

  constructor() {
    // Any write fills the buffer, so write() returns false every time.
    super({ highWaterMark: 1 });
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: () => void): void {
    this.lines.push(chunk.toString());
    this.held.push(done);
  }

  /** Finishes the writes so far and resolves once the stream has drained. */
  async release(): Promise<void> {
    const drained = once(this, "drain");
    for (const done of this.held.splice(0)) done();
    await drained;
  }
}

describe("PiRpc", () => {
  it("matches responses to commands by id, in whatever order they come", async () => {
    const { rpc, sent, pi } = connect();
    const state = rpc.request({ type: "get_state" });
    const commands = rpc.request({ type: "get_commands" });
    const [first, second] = sent();
    expect(first).toEqual({ type: "get_state", id: "tondo-1" });
    expect(second).toEqual({ type: "get_commands", id: "tondo-2" });
    await pi(
      '{"id":"tondo-2","type":"response","command":"get_commands","success":true,"data":"commands"}\n' +
        '{"id":"tondo-1","type":"response","command":"get_state","success":true,"data":"state"}\n',
    );
    expect((await state).data).toBe("state");
    expect((await commands).data).toBe("commands");
  });

  it("rejects a command pi reports failing, with pi's reason", async () => {
    const { rpc, pi } = connect();
    const prompt = rpc.request({ type: "prompt", message: "hi" });
    const failed = expect(prompt).rejects.toThrow(
      new PiCommandError("pi couldn't run prompt: Agent is already processing."),
    );
    await pi(
      '{"id":"tondo-1","type":"response","command":"prompt","success":false,"error":"Agent is already processing."}\n',
    );
    await failed;
  });

  it("passes every other record on in order, including types it doesn't know", async () => {
    const { records, pi } = connect();
    await pi('{"type":"agent_start"}\n{"type":"from_a_newer_pi","x":1}\n{"type":"agent_end"}\n');
    expect(records).toEqual([
      { type: "agent_start" },
      { type: "from_a_newer_pi", x: 1 },
      { type: "agent_end" },
    ]);
  });

  it("reports lines it can't use and keeps reading", async () => {
    const { records, problems, pi } = connect();
    const parseError =
      '{"type":"response","command":"parse","success":false,"error":"Failed to parse command"}';
    const late = '{"id":"tondo-9","type":"response","command":"abort","success":true}';
    await pi(
      `not json\n[1]\nnull\n{"no":"type"}\n\n${parseError}\n${late}\n{"type":"agent_end"}\n`,
    );
    expect(problems).toEqual([
      "pi wrote a line that isn't JSON: not json",
      "pi wrote a record without a type: [1]",
      "pi wrote a record without a type: null",
      'pi wrote a record without a type: {"no":"type"}',
      `pi answered no waiting command: ${parseError}`,
      `pi answered no waiting command: ${late}`,
    ]);
    expect(records).toEqual([{ type: "agent_end" }]);
  });

  it("fails a command pi doesn't answer in time, and reports the late answer", async () => {
    const { rpc, problems, pi } = connect();
    await expect(rpc.request({ type: "get_state" }, 10)).rejects.toThrow(
      new PiCommandError("pi didn't answer get_state within 10 ms."),
    );
    const late = '{"id":"tondo-1","type":"response","command":"get_state","success":true}';
    await pi(`${late}\n`);
    expect(problems).toEqual([`pi answered no waiting command: ${late}`]);
  });

  it("holds commands while pi isn't reading its input, then sends them in order", async () => {
    const stdin = new HeldStdin();
    const { rpc } = connect(stdin);
    rpc.send({ type: "one" });
    rpc.send({ type: "two" });
    rpc.send({ type: "three" });
    expect(stdin.lines).toEqual(['{"type":"one"}\n']);
    await stdin.release();
    expect(stdin.lines).toEqual(['{"type":"one"}\n', '{"type":"two"}\n']);
    await stdin.release();
    expect(stdin.lines).toEqual(['{"type":"one"}\n', '{"type":"two"}\n', '{"type":"three"}\n']);
  });

  it("fails waiting and later commands once closed", async () => {
    const { rpc } = connect();
    const waiting = rpc.request({ type: "get_state" });
    const exited = new Error("pi exited");
    rpc.close(exited);
    await expect(waiting).rejects.toBe(exited);
    await expect(rpc.request({ type: "get_state" })).rejects.toBe(exited);
    expect(() => rpc.send({ type: "extension_ui_response", id: "1", cancelled: true })).toThrow(
      exited,
    );
  });

  it("lets a handler's error go up instead of blaming pi for it", () => {
    const stdout = new PassThrough();
    const problems: string[] = [];
    // oxlint-disable-next-line eslint/no-new -- the client wires itself to the streams, and the test drives it through them.
    new PiRpc(
      { stdin: new PassThrough(), stdout, stderr: new PassThrough() },
      {
        onRecord: () => {
          throw new Error("a bug in Tondo");
        },
        onProtocolError: (message) => problems.push(message),
      },
    );
    // emit() runs the client's listener in this call, so its throw reaches the test.
    expect(() => stdout.emit("data", '{"type":"agent_start"}\n')).toThrow("a bug in Tondo");
    expect(problems).toEqual([]);
  });

  it("reports output that ends inside a record", async () => {
    const { stdout, problems } = connect();
    stdout.end('{"type":"agent_end"}\n{"type":"message_upd');
    await once(stdout, "end");
    expect(problems).toEqual(['pi\'s output ended inside a record: {"type":"message_upd']);
  });

  it("keeps only the end of stderr", async () => {
    const { rpc, stderr } = connect();
    const text = `${"a".repeat(STDERR_TAIL_CHARS)}the end`;
    stderr.end(text);
    await once(stderr, "end");
    expect(rpc.stderrTail()).toBe(text.slice(-STDERR_TAIL_CHARS));
  });
});
