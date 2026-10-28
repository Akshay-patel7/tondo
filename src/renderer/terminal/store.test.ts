import { beforeEach, expect, it } from "vitest";
import type { TerminalState } from "../../shared/terminal";
import {
  receiveTerminal,
  resetTerminals,
  currentTerminal,
  selectTerminal,
  useScriptTerminals,
  useTerminalSelection,
  useTerminals,
} from "./store";

const shell: TerminalState = {
  id: "shell",
  kind: "shell",
  status: "running",
  error: null,
  exitCode: null,
};
const script: TerminalState = { ...shell, id: "script", script: { name: "Build", cwd: "/work" } };
beforeEach(resetTerminals);

it("stores and selects new scripts independently without switching on status updates", () => {
  receiveTerminal({ type: "terminal-state", threadId: "a", terminal: shell });
  receiveTerminal({ type: "terminal-state", threadId: "a", terminal: script });
  expect(useTerminals.getState().get("a")).toEqual(shell);
  expect(useScriptTerminals.getState().get("a")).toEqual([script]);
  expect(useTerminalSelection.getState().get("a")).toBe(script.id);
  expect(currentTerminal("a")).toEqual(script);
  selectTerminal("a", shell.id);
  receiveTerminal({
    type: "terminal-state",
    threadId: "a",
    terminal: { ...script, status: "exited", exitCode: 7 },
  });
  expect(useTerminalSelection.getState().get("a")).toBe(shell.id);
  expect(currentTerminal("a")).toEqual(shell);
  expect(useScriptTerminals.getState().get("a")?.[0]?.exitCode).toBe(7);
});

it("closes only the addressed terminal and ignores stale closes without crossing threads", () => {
  receiveTerminal({ type: "terminal-state", threadId: "a", terminal: shell });
  receiveTerminal({ type: "terminal-state", threadId: "a", terminal: script });
  receiveTerminal({ type: "terminal-state", threadId: "b", terminal: { ...script, id: "other" } });
  receiveTerminal({ type: "terminal-state", threadId: "a", terminal: null, terminalId: "stale" });
  expect(useTerminals.getState().get("a")).toEqual(shell);
  receiveTerminal({ type: "terminal-state", threadId: "a", terminal: null, terminalId: script.id });
  expect(useScriptTerminals.getState().has("a")).toBe(false);
  expect(useScriptTerminals.getState().get("b")).toHaveLength(1);
  expect(useTerminals.getState().get("a")).toEqual(shell);
  receiveTerminal({ type: "terminal-state", threadId: "a", terminal: null, terminalId: shell.id });
  expect(useTerminals.getState().has("a")).toBe(false);
  resetTerminals();
  expect(useScriptTerminals.getState().size).toBe(0);
  expect(useTerminalSelection.getState().size).toBe(0);
});
