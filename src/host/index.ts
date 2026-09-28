// The host runs in an Electron utility process and owns pi. Git and the
// terminals come later. Main hands the host a MessagePort to the page on every
// page load. The host sends each new port a snapshot of the workspace and its
// thread, and after that only what changes.
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
import { threadFromMessages } from "../shared/thread";
import { LiveThread } from "./liveThread";
import { PiExitError } from "./piProcess";
import { Supervisor } from "./supervisor";

const v = PROTOCOL_VERSION;

/** The port of the page on screen. A new page load replaces it. */
let page: MessagePortMain | undefined;
/** The open project's thread. Stage 5 keeps one for each session. */
let thread: LiveThread | undefined;
/** Whether main is showing the folder dialog. */
let choosing = false;

function send(message: HostMessage): void {
  page?.postMessage(message);
}

function tellMain(message: HostToMainMessage): void {
  process.parentPort.postMessage(message);
}

function snapshot(): HostMessage {
  return (
    thread?.snapshot() ?? {
      v,
      type: "snapshot",
      workspace: { project: null, askingTrust: false, pi: { state: "stopped" } },
      thread: threadFromMessages([]),
    }
  );
}

/** What main passed as the host's first argument. */
function readConfig(): HostConfig {
  const json = process.argv[2];
  if (json === undefined) throw new Error("Main started the host without its config");
  return JSON.parse(json) as HostConfig;
}

/** Runs V8's last-resort collection. Main exposes gc() to the host only under perf. */
async function collectGarbage(): Promise<void> {
  const { gc } = globalThis;
  if (!gc) throw new Error("The host can't collect garbage: gc() isn't exposed");
  await gc({ type: "major", execution: "async", flavor: "last-resort" });
}

/** Closes the open thread, if any, and opens one in `folder`. */
function openProject(supervisor: Supervisor, folder: string): void {
  void thread?.close();
  thread = new LiveThread(folder, supervisor, send);
  send(thread.snapshot());
  withThread((opened) => opened.open());
}

/** Runs `work` on the open thread and tells the page if it fails. A pi that exited reports itself. */
function withThread(work: (thread: LiveThread) => Promise<void>): void {
  const done = thread ? work(thread) : Promise.reject(new Error("No project is open."));
  done.catch((error: unknown) => {
    if (error instanceof PiExitError) return;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Tondo Host: ${message}`);
    send({ v, type: "error", message });
  });
}

function handle(message: ClientMessage, port: MessagePortMain): void {
  switch (message.type) {
    case "open-project":
      if (!choosing) {
        choosing = true;
        tellMain({ type: "choose-project" });
      }
      break;
    case "trust":
      withThread((open) => open.trust(message.trusted));
      break;
    case "prompt":
      withThread((open) => open.prompt(message.text, message.streamingBehavior));
      break;
    case "stop":
      withThread((open) => open.stop());
      break;
    case "dequeue":
      withThread((open) => open.dequeue());
      break;
    case "set-model":
      withThread((open) => open.setModel(message.provider, message.modelId));
      break;
    case "set-thinking-level":
      withThread((open) => open.setThinkingLevel(message.level));
      break;
    case "restart":
      withThread((open) => open.restart());
      break;
    case "reopen":
      port.postMessage(snapshot());
      break;
    case "ping":
      port.postMessage({ v, type: "pong", id: message.id } satisfies HostMessage);
      break;
  }
}

function serve(port: MessagePortMain): void {
  page?.close();
  page = port;
  port.on("message", ({ data }) => {
    const result = parseClientMessage(data);
    if (result.ok) {
      handle(result.message, port);
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

function start(): void {
  const supervisor = new Supervisor(readConfig(), (pgids) => {
    tellMain({ type: "process-groups", pgids });
  });
  process.parentPort.on("message", ({ data, ports }) => {
    const message = data as MainToHostMessage;
    switch (message.type) {
      case "connect": {
        const [port] = ports;
        if (!port) throw new Error("Main sent connect without a port");
        serve(port);
        break;
      }
      case "project-chosen":
        choosing = false;
        if (message.folder !== null) openProject(supervisor, message.folder);
        break;
      case "collect-garbage":
        collectGarbage().then(
          () => tellMain({ type: "garbage-collected" }),
          (error: unknown) => {
            console.error("Tondo Host couldn't collect garbage:", error);
            process.exit(1);
          },
        );
        break;
    }
  });
  tellMain({ type: "ready" });
}

try {
  start();
} catch (error) {
  console.error("Tondo Host failed to start:", error);
  process.exit(1);
}
