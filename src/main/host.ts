// Runs the host utility process, restarts it when it dies, and hands the page
// a new MessagePort to it after every page load and every host start.
// The restart backoff is T3 Code's calculateRestartDelay, from
// apps/desktop/src/backend/DesktopBackendManager.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import {
  MessageChannelMain,
  utilityProcess,
  type UtilityProcess,
  type WebContents,
} from "electron";
import {
  PORT_MESSAGE,
  type HostConfig,
  type HostToMainMessage,
  type MainToHostMessage,
} from "../shared/protocol";
import { stopProcessGroups } from "./processGroups";

const FIRST_RESTART_DELAY_MS = 500;
const MAX_RESTART_DELAY_MS = 10_000;

export interface HostOptions {
  /** The built src/host/index.ts. */
  entry: string;
  config: HostConfig;
}

export interface Host {
  /** Hands `page` a port to the host now, or once the host is ready. */
  connect(page: WebContents): void;
  /** Collects the host's garbage. It works only when main has gc(), as under perf. */
  collectGarbage(): Promise<void>;
  /** The process groups the running host has reported. */
  readonly processGroups: readonly number[];
  /** Tests only, until the page can start pi: has the host start pi in `cwd` and send it `prompt`. */
  runPi(cwd: string, prompt: string): void;
  /**
   * Stops the host for good, as the app quits. Resolves once the host has
   * exited and the process groups it reported are gone.
   */
  stop(): Promise<void>;
}

export function startHost({ entry, config }: HostOptions): Host {
  let child: UtilityProcess | undefined;
  let ready = false;
  let page: WebContents | undefined;
  let processGroups: number[] = [];
  /** Settles once the groups every dead host left are gone. */
  let groupsStopped: Promise<unknown> = Promise.resolve();
  /** Restarts since the host was last ready. */
  let restarts = 0;
  let restartTimer: NodeJS.Timeout | undefined;
  let stopping: Promise<void> | undefined;

  const connectPage = () => {
    if (!child || !ready || !page || page.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage({ type: "connect" } satisfies MainToHostMessage, [port1]);
    page.postMessage(PORT_MESSAGE, null, [port2]);
  };

  const runningHost = (task: string) => {
    if (!child || !ready) throw new Error(`The host isn't running, so it can't ${task}`);
    return child;
  };

  const fork = () => {
    const current = utilityProcess.fork(entry, [JSON.stringify(config)], {
      serviceName: "Tondo Host",
      // Under perf, main has gc(). The host needs it too so perf can collect its garbage.
      execArgv: globalThis.gc ? ["--js-flags=--expose-gc"] : [],
    });
    child = current;
    // Electron emits this before exit when V8 hits a fatal error in the host.
    // Without a listener, the EventEmitter would throw it in main.
    current.on("error", (type, location, report) => {
      console.error(`Tondo Host hit a ${type} at ${location}:\n${report}`);
    });
    current.on("message", (message: HostToMainMessage) => {
      if (message.type === "ready") {
        ready = true;
        restarts = 0;
        connectPage();
      } else if (message.type === "process-groups") {
        processGroups = message.pgids;
      }
    });
    current.once("exit", (code) => {
      child = undefined;
      ready = false;
      const stopped = stopProcessGroups(processGroups).catch((error: unknown) => {
        console.error("Couldn't stop the process groups the host left:", error);
      });
      groupsStopped = Promise.all([groupsStopped, stopped]);
      processGroups = [];
      if (stopping) return;
      const delay = Math.min(FIRST_RESTART_DELAY_MS * 2 ** restarts, MAX_RESTART_DELAY_MS);
      restarts++;
      console.error(`Tondo Host exited with code ${code}. Restarting it in ${delay} ms.`);
      restartTimer = setTimeout(fork, delay);
    });
  };

  fork();
  return {
    connect(webContents) {
      page = webContents;
      connectPage();
    },
    async collectGarbage() {
      const current = runningHost("collect garbage");
      await new Promise<void>((resolve, reject) => {
        const onMessage = (message: HostToMainMessage) => {
          if (message.type !== "garbage-collected") return;
          current.off("message", onMessage);
          current.off("exit", onExit);
          resolve();
        };
        const onExit = (code: number) => {
          current.off("message", onMessage);
          reject(new Error(`The host exited with code ${code} while collecting garbage`));
        };
        current.on("message", onMessage);
        current.once("exit", onExit);
        current.postMessage({ type: "collect-garbage" } satisfies MainToHostMessage);
      });
    },
    get processGroups() {
      return processGroups;
    },
    runPi(cwd, prompt) {
      runningHost("run pi").postMessage({
        type: "run-pi",
        cwd,
        prompt,
      } satisfies MainToHostMessage);
    },
    stop() {
      stopping ??= (async () => {
        clearTimeout(restartTimer);
        const current = child;
        if (current) {
          // Not events.once, which would reject on the host's error event.
          const exited = new Promise((resolve) => current.once("exit", resolve));
          current.kill();
          await exited;
        }
        // fork()'s exit listener ran before ours, so this includes the groups
        // of the host just stopped.
        await groupsStopped;
      })();
      return stopping;
    },
  };
}
