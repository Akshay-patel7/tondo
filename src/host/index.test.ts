import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PROTOCOL_VERSION } from "../shared/protocol";

type FakeWorkspace = Record<
  | "handle"
  | "greet"
  | "disconnected"
  | "applySettings"
  | "start"
  | "projectChosen"
  | "piChosen"
  | "openThread"
  | "closeTerminals",
  ReturnType<typeof vi.fn>
>;

const host = vi.hoisted(() => ({
  workspace: undefined as FakeWorkspace | undefined,
  workspaceOptions: undefined as Record<string, (...args: never[]) => void> | undefined,
  supervisorGroups: undefined as ((pgids: number[]) => void) | undefined,
  checkpointGroups: undefined as ((pgids: number[]) => void) | undefined,
}));

vi.mock("./store", () => ({ Store: { open: vi.fn(() => ({})) } }));
vi.mock("./checkpoints", () => ({
  watchCheckpointGroups: (report: (pgids: number[]) => void) => {
    host.checkpointGroups = report;
  },
}));
vi.mock("./supervisor", () => ({
  Supervisor: vi.fn(function (_config: unknown, report: (pgids: number[]) => void) {
    host.supervisorGroups = report;
  }),
}));
vi.mock("./workspace", () => ({
  Workspace: class {
    constructor(options: Record<string, (...args: never[]) => void>) {
      host.workspaceOptions = options;
      host.workspace = this as unknown as FakeWorkspace;
    }
    handle = vi.fn();
    greet = vi.fn();
    disconnected = vi.fn();
    applySettings = vi.fn();
    start = vi.fn(async () => {});
    projectChosen = vi.fn();
    piChosen = vi.fn();
    openThread = vi.fn();
    closeTerminals = vi.fn(async () => {});
  },
}));

class FakePort extends EventEmitter {
  postMessage = vi.fn();
  start = vi.fn();
  close = vi.fn();
  receive(data: unknown): void {
    this.emit("message", { data });
  }
}

const parentPort = Object.assign(new EventEmitter(), { postMessage: vi.fn() });
const argv = process.argv;

function fromMain(data: unknown, ports: FakePort[] = []): void {
  parentPort.emit("message", { data, ports });
}

function connect(): FakePort {
  const port = new FakePort();
  fromMain({ type: "connect" }, [port]);
  return port;
}

function workspace(): FakeWorkspace {
  if (!host.workspace) throw new Error("The host didn't make its workspace");
  return host.workspace;
}

beforeEach(async () => {
  vi.resetModules();
  vi.spyOn(console, "error").mockImplementation(() => {});
  parentPort.removeAllListeners();
  parentPort.postMessage.mockClear();
  Object.defineProperty(process, "parentPort", { value: parentPort, configurable: true });
  process.argv = [...argv.slice(0, 2), JSON.stringify({ userData: "/tmp/tondo-user-data" })];
  await import("./index");
});

afterEach(() => {
  process.argv = argv;
  Reflect.deleteProperty(process, "parentPort");
});

it("applies the settings, tells main it's ready and starts the workspace", () => {
  expect(workspace().applySettings).toHaveBeenCalledTimes(1);
  expect(workspace().start).toHaveBeenCalledTimes(1);
  expect(parentPort.postMessage.mock.calls).toEqual([[{ type: "ready" }]]);
});

it("hands the page's valid messages to the workspace", () => {
  const port = connect();
  expect(port.start).toHaveBeenCalledTimes(1);
  expect(workspace().greet).toHaveBeenCalledTimes(1);
  const message = { v: PROTOCOL_VERSION, type: "git-refresh", threadId: "t1" };
  port.receive(message);
  expect(workspace().handle).toHaveBeenCalledWith(message);
  expect(port.postMessage).not.toHaveBeenCalled();
});

it("answers a rejected Git action with its request id, not a page error", () => {
  const port = connect();
  port.receive({
    v: PROTOCOL_VERSION,
    type: "git-action",
    threadId: "t1",
    id: 7,
    expectedBranch: null,
    action: { kind: "switch", branch: " " },
  });
  expect(workspace().handle).not.toHaveBeenCalled();
  expect(port.postMessage.mock.calls).toEqual([
    [
      {
        v: PROTOCOL_VERSION,
        type: "git-result",
        threadId: "t1",
        id: 7,
        error: "Tondo rejected this Git action. A field is blank, too long or not allowed.",
      },
    ],
  ]);
});

it("answers any other rejected message with an error", () => {
  const port = connect();
  port.receive({ v: PROTOCOL_VERSION - 1, type: "git-refresh", threadId: "t1" });
  expect(workspace().handle).not.toHaveBeenCalled();
  expect(port.postMessage.mock.calls).toEqual([
    [
      {
        v: PROTOCOL_VERSION,
        type: "error",
        message: `protocol version ${PROTOCOL_VERSION - 1} isn't ${PROTOCOL_VERSION}`,
      },
    ],
  ]);
});

it("replaces the page's port on reload and disconnects only when the current port closes", () => {
  const first = connect();
  const second = connect();
  expect(first.close).toHaveBeenCalledTimes(1);
  first.emit("close");
  expect(workspace().disconnected).not.toHaveBeenCalled();
  second.emit("close");
  expect(workspace().disconnected).toHaveBeenCalledTimes(1);
});

it("routes main's messages to the workspace", async () => {
  fromMain({ type: "project-chosen", folder: "/p" });
  fromMain({ type: "pi-chosen", file: "/bin/pi" });
  fromMain({ type: "open-thread", threadId: "t1" });
  expect(workspace().projectChosen).toHaveBeenCalledWith("/p");
  expect(workspace().piChosen).toHaveBeenCalledWith("/bin/pi");
  expect(workspace().openThread).toHaveBeenCalledWith("t1");
  fromMain({ type: "stop-terminals" });
  expect(workspace().closeTerminals).toHaveBeenCalledTimes(1);
  await workspace().closeTerminals.mock.results[0]?.value;
  expect(parentPort.postMessage).toHaveBeenLastCalledWith({ type: "terminals-stopped" });
});

it("relays native file selections to the page without reading their contents", () => {
  const page = connect();
  const result = {
    type: "files-chosen",
    id: "request-1",
    paths: ["/outside/file.csv"],
    error: null,
  };
  fromMain(result);
  expect(page.postMessage).toHaveBeenLastCalledWith({ v: PROTOCOL_VERSION, ...result });
});

it("routes file picker requests to main", () => {
  host.workspaceOptions?.chooseFiles?.("request-1" as never);
  expect(parentPort.postMessage).toHaveBeenLastCalledWith({
    type: "choose-files",
    id: "request-1",
  });
});

it("reports every process group it owns to main as one list", () => {
  host.supervisorGroups?.([1]);
  host.checkpointGroups?.([2]);
  host.workspaceOptions?.gitGroups?.([3] as never);
  host.workspaceOptions?.terminalGroups?.([4] as never);
  expect(parentPort.postMessage).toHaveBeenLastCalledWith({
    type: "process-groups",
    pgids: [1, 2, 4, 3],
  });
});
