import { expect, it } from "vitest";
import {
  terminalRects,
  terminalIds,
  replaceTerminal,
  removeTerminal,
  resizeSplit,
  type TerminalNode,
} from "./layout";
const tree: TerminalNode = {
  id: "root",
  direction: "vertical",
  ratio: 0.4,
  first: "a",
  second: { id: "nested", direction: "horizontal", ratio: 0.6, first: "b", second: "c" },
};

it("calculates nested pane rectangles without nesting the rendered terminals", () => {
  expect(terminalRects(tree).panes).toEqual([
    { terminalId: "a", left: 0, top: 0, width: 40, height: 100 },
    { terminalId: "b", left: 40, top: 0, width: 60, height: 60 },
    { terminalId: "c", left: 40, top: 60, width: 60, height: 40 },
  ]);
  expect(terminalRects(tree).dividers).toHaveLength(2);
});
it("replaces only the target leaf and collapses each removed split", () => {
  expect(terminalIds(replaceTerminal(tree, "b", "new"))).toEqual(["a", "new", "c"]);
  expect(replaceTerminal(tree, "missing", "new")).toBe(tree);
  expect(removeTerminal(tree, "missing")).toBe(tree);
  expect(terminalIds(removeTerminal(tree, "a")!)).toEqual(["b", "c"]);
  expect(removeTerminal(removeTerminal(tree, "b")!, "c")).toBe("a");
  expect(removeTerminal("a", "a")).toBeNull();
});
it("resizes only the addressed split and clamps the ratio", () => {
  const changed = resizeSplit(tree, "nested", 1);
  expect(terminalRects(changed).panes[1]?.height).toBe(85);
  expect(terminalRects(changed).panes[0]?.width).toBe(40);
  expect(terminalRects(resizeSplit(tree, "root", -1)).panes[0]?.width).toBe(15);
  expect(resizeSplit(tree, "missing", 0.5)).toBe(tree);
});
