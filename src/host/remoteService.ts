import { Worker } from "node:worker_threads";
import type { HostToRemote, RemoteToHost, RemoteStatus } from "../shared/remote";

export interface RemoteService {
  deliver(message: HostToRemote): void;
  collectGarbage(): Promise<void>;
  close(): Promise<void>;
}

export function startRemoteService(options: {
  entry: string;
  root: string;
  status: (status: RemoteStatus) => void;
  message: (message: RemoteToHost) => void;
}): RemoteService {
  const worker = new Worker(options.entry, {
    workerData: { root: options.root },
    // Electron's --js-flags is not a Node Worker CLI argument. V8's exposed-gc
    // flag is already process-wide when the perf harness enabled it on the host.
    execArgv: [],
    resourceLimits: { maxOldGenerationSizeMb: 64 },
  });
  let closing = false;
  let failed = false;
  worker.on(
    "message",
    (
      message:
        | RemoteToHost
        | RemoteStatus
        | { type: "garbage-collected" | "garbage-collection-failed" },
    ) => {
      if (closing) return;
      if ("state" in message) {
        failed ||= message.state === "error";
        options.status(message);
      } else if ("clientId" in message) {
        options.message(message);
      }
    },
  );
  worker.on("error", (error) => {
    failed = true;
    if (!closing)
      options.status({
        state: "error",
        message: `Remote access stopped: ${error.message}. Toggle it to retry.`,
      });
  });
  worker.once("exit", () => {
    if (!closing && !failed)
      options.status({ state: "error", message: "Remote access stopped. Toggle it to retry." });
  });
  return {
    deliver(message) {
      if (!closing) worker.postMessage(message);
    },
    collectGarbage: () =>
      new Promise<void>((resolve, reject) => {
        const finish = (error?: Error) => {
          clearTimeout(deadline);
          worker.off("message", onMessage);
          worker.off("exit", onExit);
          if (error) reject(error);
          else resolve();
        };
        const onMessage = (message: { type?: string }) => {
          if (message.type === "garbage-collected") finish();
          if (message.type === "garbage-collection-failed")
            finish(new Error("The remote worker has no gc()"));
        };
        const onExit = () =>
          finish(new Error("The remote worker stopped during garbage collection"));
        const deadline = setTimeout(
          () => finish(new Error("Remote garbage collection timed out")),
          5000,
        );
        worker.on("message", onMessage);
        worker.once("exit", onExit);
        worker.postMessage({ type: "collect-garbage" });
      }),
    async close() {
      closing = true;
      await worker.terminate();
    },
  };
}
