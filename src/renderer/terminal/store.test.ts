import { beforeEach, expect, it } from "vitest";
import type { TerminalState, TerminalSplit } from "../../shared/terminal";
import { terminalIds } from "./layout";
import {
  receiveTerminal,
  resetTerminals,
  currentTerminal,
  selectTerminal,
  useTerminalLayouts,
  useTerminals,
  readTerminal,
} from "./store";

const shell: TerminalState = {
  id: "shell",
  kind: "shell",
  status: "running",
  error: null,
  exitCode: null,
};
const script: TerminalState = { ...shell, id: "script", script: { name: "Build", cwd: "/work" } };
function add(terminal: TerminalState, split?: TerminalSplit, threadId = "a") {
  receiveTerminal({ type: "terminal-state", threadId, terminal, ...(split ? { split } : {}) });
}
function close(terminalId: string, threadId = "a") {
  receiveTerminal({ type: "terminal-state", threadId, terminal: null, terminalId });
}
function layout() {
  return useTerminalLayouts.getState().get("a")!;
}
beforeEach(resetTerminals);

it("stores shells and scripts in a flat list without selecting status updates", () => {
  add(shell);
  add(script);
  expect(useTerminals.getState().get("a")).toEqual([shell, script]);
  expect(currentTerminal("a")).toEqual(script);
  selectTerminal("a", shell.id);
  add({ ...script, status: "exited", exitCode: 7 });
  expect(currentTerminal("a")).toEqual(shell);
  expect(useTerminals.getState().get("a")?.[1]?.exitCode).toBe(7);
});

it("keeps shells before scripts even when a script opened first", () => {
  add(script);
  add(shell);
  expect(useTerminals.getState().get("a")).toEqual([shell, script]);
});

it("splits just the target pane and only replaces the focused pane for a new or hidden shell", () => {
  add(shell);
  add(script, { terminalId: shell.id, direction: "vertical" });
  const first = layout().root;
  selectTerminal("a", shell.id);
  expect(layout().root).toBe(first);
  add({ ...shell, id: "second" }, { terminalId: shell.id, direction: "horizontal" });
  expect(terminalIds(layout().root)).toEqual(["shell", "second", "script"]);
  add({ ...shell, id: "third" });
  expect(terminalIds(layout().root)).toEqual(["shell", "third", "script"]);
  selectTerminal("a", "second");
  expect(terminalIds(layout().root)).toEqual(["shell", "second", "script"]);
  const before = layout();
  selectTerminal("a", "unknown");
  expect(layout()).toBe(before);
});

it("collapses closed splits, keeps hidden sessions and does not let stale closes cross threads", () => {
  add(shell);
  add(script, { terminalId: shell.id, direction: "vertical" });
  add({ ...script, id: "other" }, undefined, "b");
  close("stale");
  expect(useTerminals.getState().get("a")).toEqual([shell, script]);
  close(shell.id);
  expect(layout()).toEqual({ root: script.id, selected: script.id });
  expect(currentTerminal("a")).toEqual(script);
  add({ ...shell, id: "hidden" });
  close("hidden");
  expect(layout().root).toBe(script.id);
  close(script.id);
  expect(useTerminals.getState().has("a")).toBe(false);
  expect(useTerminalLayouts.getState().has("a")).toBe(false);
  expect(useTerminals.getState().get("b")).toHaveLength(1);
  resetTerminals();
  expect(useTerminalLayouts.getState().size).toBe(0);
});

it("bounds visible panes and handles an origin closed before a split arrives", () => {
  add(shell);
  for (let i = 0; i < 5; i++)
    add({ ...shell, id: `s${i}` }, { terminalId: layout().selected, direction: "vertical" });
  expect(terminalIds(layout().root)).toHaveLength(4);
  add({ ...shell, id: "late" }, { terminalId: "closed", direction: "horizontal" });
  expect(terminalIds(layout().root)).toHaveLength(4);
  expect(currentTerminal("a")?.id).toBe("late");
});

it("routes output by attachment without notifying any React terminal store", () => {
  add(shell);
  const sessions = useTerminals.getState();
  const layouts = useTerminalLayouts.getState();
  const output: string[] = [];
  const unread = readTerminal("a", (message) => output.push(message.data));
  receiveTerminal({
    type: "terminal-output",
    threadId: "a",
    terminalId: shell.id,
    attachment: "a",
    sequence: 1,
    data: "hello",
  });
  unread();
  receiveTerminal({
    type: "terminal-output",
    threadId: "a",
    terminalId: shell.id,
    attachment: "a",
    sequence: 2,
    data: "stale",
  });
  expect(output).toEqual(["hello"]);
  expect(useTerminals.getState()).toBe(sessions);
  expect(useTerminalLayouts.getState()).toBe(layouts);
});
