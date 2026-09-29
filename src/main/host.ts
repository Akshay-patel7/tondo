// Runs the host utility process, restarts it when it dies, and hands the page
// a new MessagePort to it after every page load and every host start. It also
// does what the host can't from a utility process: the folder dialog,
// notifications, the clipboard and Finder.
// The restart backoff is T3 Code's calculateRestartDelay, and piping the
// host's output into main follows T3's handling of its backend's output, both
// in apps/desktop/src/backend/DesktopBackendManager.ts.
// Copyright (c) 2026 T3 Tools Inc. MIT License.
import {
  MessageChannelMain,
  utilityProcess,
  type UtilityProcess,
  type WebContents,
} from "electron";
import {
  PORT_MESSAGE,
  type Attention,
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
  /** Shows the folder dialog. Resolves with the folder, or null if you cancel. */
  chooseFolder: () => Promise<string | null>;
  /** Raises a notification about a thread that needs you. */
  attention: (attention: Attention) => void;
  /** Puts text on the clipboard. */
  copy: (text: string) => void;
  /** Shows a file in Finder. */
  reveal: (file: string) => void;
  /** Gets everything the host prints, as it prints it. */
  onOutput: (stream: "stdout" | "stderr", text: string) => void;
}

export interface Host {
  /** Hands `page` a port to the host now, or once the host is ready. */
  connect(page: WebContents): void;
  /** Puts a thread on screen, as when you click its notification. */
  openThread(threadId: string): void;
  /** Collects the host's garbage. It works only when main has gc(), as under perf. */
  collectGarbage(): Promise<void>;
  /** The process groups the running host has reported. */
  readonly processGroups: readonly number[];
  /**
   * Stops the host for good, as the app quits. Resolves once the host has
   * exited and the process groups it reported are gone.
   */
  stop(): Promise<void>;
}

export function startHost(options: HostOptions): Host {
  const { entry, config, chooseFolder, onOutput } = options;
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
      stdio: "pipe",
      // Under perf, main has gc(). The host needs it too so perf can collect its garbage.
      execArgv: globalThis.gc ? ["--js-flags=--expose-gc"] : [],
    });
    child = current;
    // Electron sets these to null once the host exits, so they're read now.
    for (const stream of ["stdout", "stderr"] as const) {
      const output = current[stream];
      output?.setEncoding("utf8");
      output?.on("data", (text: string) => onOutput(stream, text));
    }
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
      } else if (message.type === "attention") {
        const { type: _type, ...attention } = message;
        options.attention(attention);
      } else if (message.type === "copy") {
        options.copy(message.text);
      } else if (message.type === "reveal") {
        options.reveal(message.path);
      } else if (message.type === "choose-project") {
        void chooseFolder()
          .catch((error: unknown) => {
            console.error("Tondo couldn't show the folder dialog:", error);
            return null;
          })
          .then((folder) => {
            // A host that died meanwhile has lost its project anyway.
            if (child !== current) return;
            current.postMessage({ type: "project-chosen", folder } satisfies MainToHostMessage);
          });
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
    openThread(threadId) {
      // A host that isn't ready opens the thread you had open when it starts.
      if (child && ready) {
        child.postMessage({ type: "open-thread", threadId } satisfies MainToHostMessage);
      }
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
