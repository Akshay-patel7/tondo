import { FILE_LINK_PREFIX, isLocalFileLink } from "../../shared/filePreview";

interface Node {
  type: string;
  url?: string;
  children?: Node[];
}

/** Rewrite URLs during the existing parse, before sanitization can discard local file URLs. */
export function localFileLinks(): (tree: Node) => void {
  return function transform(node: Node): void {
    if (
      (node.type === "link" || node.type === "definition") &&
      typeof node.url === "string" &&
      isLocalFileLink(node.url)
    ) {
      node.url = FILE_LINK_PREFIX + encodeURIComponent(node.url);
    }
    for (const child of node.children ?? []) transform(child);
  };
}
