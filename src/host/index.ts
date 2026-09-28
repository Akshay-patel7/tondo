// The host runs in an Electron utility process and owns pi. Git and the
// terminals come later. Main hands the host a MessagePort to the page on every
// page load. The host sends each new port what the page shows, and after that
// only what changes.
import path from "node:path";
import type { MessagePortMain } from "electron";
import {
  parseClientMessage,
  PROTOCOL_VERSION,
  type HostConfig,
  type HostMessage,
  type HostToMainMessage,
  type MainToHostMessage,
} from "../shared/protocol";
import { POOL_LIMITS } from "./pool";
import { Store } from "./store";
import { Supervisor } from "./supervisor";
import { Workspace } from "./workspace";

/** The port of the page on screen. A new page load replaces it. */
let page: MessagePortMain | undefined;

function send(message: HostMessage): void {
  page?.postMessage(message);
}

function tellMain(message: HostToMainMessage): void {
  process.parentPort.postMessage(message);
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

function serve(port: MessagePortMain, workspace: Workspace): void {
  page?.close();
  page = port;
  port.on("message", ({ data }) => {
    const result = parseClientMessage(data);
    if (result.ok) {
      workspace.handle(result.message);
    } else {
      console.error(`Tondo Host rejected a message from the page: ${result.error}`);
      port.postMessage({
        v: PROTOCOL_VERSION,
        type: "error",
        message: result.error,
      } satisfies HostMessage);
    }
  });
  port.on("close", () => {
    if (page === port) page = undefined;
  });
  port.start();
  workspace.greet();
}

function start(): void {
  const config = readConfig();
  const store = Store.open(path.join(config.userData, "tondo.sqlite"));
  const supervisor = new Supervisor(config, (pgids) => {
    tellMain({ type: "process-groups", pgids });
  });
  const workspace = new Workspace({
    store,
    supervisor,
    limits: { ...POOL_LIMITS, ...config.pool },
    send,
    chooseFolder: () => tellMain({ type: "choose-project" }),
  });
  process.parentPort.on("message", ({ data, ports }) => {
    const message = data as MainToHostMessage;
    switch (message.type) {
      case "connect": {
        const [port] = ports;
        if (!port) throw new Error("Main sent connect without a port");
        serve(port, workspace);
        break;
      }
      case "project-chosen":
        workspace.projectChosen(message.folder);
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
  void workspace.start();
}

try {
  start();
} catch (error) {
  console.error("Tondo Host failed to start:", error);
  process.exit(1);
}
