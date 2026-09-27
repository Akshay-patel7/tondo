// The host runs in an Electron utility process and will own pi, git and the
// terminals. For now the page shows the fixture player that stands in for pi,
// and only tests start pi. Main hands the host a MessagePort to the page on
// every page load. The host sends each new port a snapshot of the thread, and
// after that only batches of events.
import type { MessagePortMain } from "electron";
import {
  parseClientMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type HostConfig,
  type HostMessage,
  type HostToMainMessage,
  type MainToHostMessage,
} from "../shared/protocol";
import { PiExitError } from "./piProcess";
import { openPlayer, type Player } from "./player";
import { Supervisor } from "./supervisor";

const v = PROTOCOL_VERSION;

/** The port of the page on screen. A new page load replaces it. */
let page: MessagePortMain | undefined;

function send(message: HostMessage): void {
  page?.postMessage(message);
}

function tellMain(message: HostToMainMessage): void {
  process.parentPort.postMessage(message);
}

/** Perf opens a longer thread by setting TONDO_TRANSCRIPT_MESSAGES. */
function messageCount(): number | undefined {
  const value = process.env.TONDO_TRANSCRIPT_MESSAGES;
  if (!value) return undefined;
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error(`TONDO_TRANSCRIPT_MESSAGES must be a positive integer, not "${value}"`);
  }
  return count;
}

/** What main passed as the host's first argument. */
function readConfig(): HostConfig {
  const json = process.argv[2];
  if (json === undefined) throw new Error("Main started the host without its config");
  return JSON.parse(json) as HostConfig;
}

/** Tests only, until the page can start pi: starts pi in `cwd` and sends it `prompt`. */
async function runPi(supervisor: Supervisor, cwd: string, prompt: string): Promise<void> {
  const pi = await supervisor.start(cwd, () => {});
  // Nothing stops this pi, so it exiting at all is worth a line in the log.
  pi.exited.then((exit) =>
    console.error(`pi ${pi.pid} in ${cwd}: ${new PiExitError(exit).message}`),
  );
  await pi.rpc.request({ type: "prompt", message: prompt }).catch((error: unknown) => {
    // The line above already reports a pi that exits before it answers.
    if (!(error instanceof PiExitError)) throw error;
  });
}

/** Runs V8's last-resort collection. Main exposes gc() to the host only under perf. */
async function collectGarbage(): Promise<void> {
  const { gc } = globalThis;
  if (!gc) throw new Error("The host can't collect garbage: gc() isn't exposed");
  await gc({ type: "major", execution: "async", flavor: "last-resort" });
}

function serve(player: Player, port: MessagePortMain): void {
  const snapshot = (): HostMessage => ({
    v,
    type: "snapshot",
    thread: player.thread,
    status: player.status,
  });
  const handle = (message: ClientMessage) => {
    switch (message.type) {
      case "play":
        player.play(message.fixture, message.speed).catch((error: unknown) => {
          console.error(`Tondo Host couldn't play ${message.fixture}:`, error);
          send({
            v,
            type: "error",
            message: `Playing ${message.fixture} failed: ${String(error)}`,
          });
        });
        break;
      case "stop":
        player.stop();
        break;
      case "reopen":
        port.postMessage(snapshot());
        break;
      case "ping":
        port.postMessage({ v, type: "pong", id: message.id } satisfies HostMessage);
        break;
    }
  };

  page?.close();
  page = port;
  port.on("message", ({ data }) => {
    const result = parseClientMessage(data);
    if (result.ok) {
      handle(result.message);
    } else {
      console.error(`Tondo Host rejected a message from the page: ${result.error}`);
      port.postMessage({ v, type: "error", message: result.error } satisfies HostMessage);
    }
  });
  port.on("close", () => {
    if (page === port) page = undefined;
  });
  port.start();
  port.postMessage(snapshot());
}

async function start(): Promise<void> {
  const supervisor = new Supervisor(readConfig(), (pgids) => {
    tellMain({ type: "process-groups", pgids });
  });
  const player = await openPlayer(send, messageCount());
  process.parentPort.on("message", ({ data, ports }) => {
    const message = data as MainToHostMessage;
    switch (message.type) {
      case "connect": {
        const [port] = ports;
        if (!port) throw new Error("Main sent connect without a port");
        serve(player, port);
        break;
      }
      case "collect-garbage":
        collectGarbage().then(
          () => tellMain({ type: "garbage-collected" }),
          (error: unknown) => {
            console.error("Tondo Host couldn't collect garbage:", error);
            process.exit(1);
          },
        );
        break;
      case "run-pi":
        runPi(supervisor, message.cwd, message.prompt).catch((error: unknown) => {
          console.error(`Tondo Host couldn't run pi in ${message.cwd}:`, error);
        });
        break;
    }
  });
  tellMain({ type: "ready" });
}

start().catch((error: unknown) => {
  console.error("Tondo Host failed to start:", error);
  process.exit(1);
});
