// The network gateway has its own event loop and heap, without another Electron
// utility process's baseline footprint. Only this opt-in worker loads HTTP/ws.
import { parentPort, workerData } from "node:worker_threads";
import { startRemoteServer } from "./remoteServer";
import type { HostToRemote } from "../shared/remote";

const port = parentPort;
if (!port) throw new Error("The remote gateway must run in a worker");
const config = workerData as { root: string };
void startRemoteServer({ root: config.root, post: (message) => port.postMessage(message) }).then(
  (server) => {
    port.on("message", (message: HostToRemote | { type: "collect-garbage" }) => {
      if (message.type !== "collect-garbage") {
        server.deliver(message);
        return;
      }
      const { gc } = globalThis;
      if (!gc) {
        port.postMessage({ type: "garbage-collection-failed" });
        return;
      }
      void gc({ type: "major", execution: "async", flavor: "last-resort" }).then(() =>
        port.postMessage({ type: "garbage-collected" }),
      );
    });
    port.postMessage({ state: "ready", code: server.code, port: server.port });
  },
  (error: unknown) => {
    port.postMessage({
      state: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    port.close();
  },
);
