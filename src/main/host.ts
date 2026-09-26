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
import { PORT_MESSAGE, type HostToMainMessage, type MainToHostMessage } from "../shared/protocol";
import { killProcessGroups } from "./processGroups";

const FIRST_RESTART_DELAY_MS = 500;
const MAX_RESTART_DELAY_MS = 10_000;

export interface Host {
  /** Hands `page` a port to the host now, or once the host is ready. */
  connect(page: WebContents): void;
  /** Collects the host's garbage. It works only when main has gc(), as under perf. */
  collectGarbage(): Promise<void>;
  /** Stops the host for good, as the app quits. */
  stop(): void;
}

/** Forks the host from `entry`, the built src/host/index.ts. */
export function startHost(entry: string): Host {
  let child: UtilityProcess | undefined;
  let ready = false;
  let page: WebContents | undefined;
  let processGroups: number[] = [];
  /** Restarts since the host was last ready. */
  let restarts = 0;
  let restartTimer: NodeJS.Timeout | undefined;
  let stopped = false;

  const connectPage = () => {
    if (!child || !ready || !page || page.isDestroyed()) return;
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage({ type: "connect" } satisfies MainToHostMessage, [port1]);
    page.postMessage(PORT_MESSAGE, null, [port2]);
  };

  const fork = () => {
    const current = utilityProcess.fork(entry, [], {
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
      killProcessGroups(processGroups);
      processGroups = [];
      if (stopped) return;
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
    collectGarbage() {
      const current = child;
      if (!current || !ready) {
        return Promise.reject(new Error("The host isn't running, so it can't collect garbage"));
      }
      return new Promise((resolve, reject) => {
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
    stop() {
      stopped = true;
      clearTimeout(restartTimer);
      child?.kill();
    },
  };
}
