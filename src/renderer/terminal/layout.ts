import type { TerminalSplit } from "../../shared/terminal";

export type TerminalNode =
  | string
  | {
      readonly id: string;
      readonly direction: TerminalSplit["direction"];
      readonly ratio: number;
      readonly first: TerminalNode;
      readonly second: TerminalNode;
    };

export interface TerminalLayout {
  readonly root: TerminalNode;
  readonly selected: string;
}

export function terminalIds(node: TerminalNode): string[] {
  return typeof node === "string"
    ? [node]
    : [...terminalIds(node.first), ...terminalIds(node.second)];
}

export function replaceTerminal(
  node: TerminalNode,
  id: string,
  replacement: TerminalNode,
): TerminalNode {
  if (typeof node === "string") return node === id ? replacement : node;
  const first = replaceTerminal(node.first, id, replacement);
  const second = replaceTerminal(node.second, id, replacement);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function removeTerminal(node: TerminalNode, id: string): TerminalNode | null {
  if (typeof node === "string") return node === id ? null : node;
  const first = removeTerminal(node.first, id);
  const second = removeTerminal(node.second, id);
  if (first === null) return second;
  if (second === null) return first;
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export function resizeSplit(node: TerminalNode, id: string, ratio: number): TerminalNode {
  if (typeof node === "string") return node;
  if (node.id === id) return { ...node, ratio: Math.max(0.15, Math.min(0.85, ratio)) };
  const first = resizeSplit(node.first, id, ratio);
  const second = resizeSplit(node.second, id, ratio);
  return first === node.first && second === node.second ? node : { ...node, first, second };
}

export interface PaneRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Flat siblings keep existing xterms mounted when the split tree changes. All values are percentages. */
export function terminalRects(root: TerminalNode) {
  const panes: (PaneRect & { terminalId: string })[] = [];
  const dividers: (PaneRect & {
    id: string;
    direction: TerminalSplit["direction"];
    ratio: number;
  })[] = [];
  function visit(node: TerminalNode, rect: PaneRect): void {
    if (typeof node === "string") {
      panes.push({ ...rect, terminalId: node });
      return;
    }
    dividers.push({ ...rect, id: node.id, direction: node.direction, ratio: node.ratio });
    if (node.direction === "vertical") {
      const width = rect.width * node.ratio;
      visit(node.first, { ...rect, width });
      visit(node.second, { ...rect, left: rect.left + width, width: rect.width - width });
    } else {
      const height = rect.height * node.ratio;
      visit(node.first, { ...rect, height });
      visit(node.second, { ...rect, top: rect.top + height, height: rect.height - height });
    }
  }
  visit(root, { left: 0, top: 0, width: 100, height: 100 });
  return { panes, dividers };
}
