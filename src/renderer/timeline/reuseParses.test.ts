import { describe, expect, test } from "vitest";
import { cacheParses } from "./reuseParses";

type Tree = { value: string; data: Record<string, unknown> };

function counted() {
  const parsed: string[] = [];
  const cached = cacheParses((document: string) => {
    parsed.push(document);
    return { value: document, data: {} };
  });
  const parse = (document: string) => cached(document, undefined as never) as Tree;
  return { parse, parsed };
}

describe("cacheParses", () => {
  test("parses text it has seen once", () => {
    const { parse, parsed } = counted();
    parse("# Title\n\n");
    expect(parse("# Title\n\n").value).toBe("# Title\n\n");
    expect(parsed).toEqual(["# Title\n\n"]);
  });

  test("gives each parse its own tree, so a plugin changing one leaves the next alone", () => {
    const { parse } = counted();
    parse("text").data.changed = true;
    parse("text").data.changed = true;
    expect(parse("text").data).toEqual({});
  });

  test("keeps only the latest text of a block that grows frame by frame", () => {
    const { parse, parsed } = counted();
    const block = "A paragraph pi is still writing, long enough to stream. ";
    parse(block);
    parse(`${block}More`);
    parse(`${block}More words**`);
    parse(block);
    expect(parsed).toEqual([block, `${block}More`, `${block}More words**`, block]);
  });

  test("keeps finished blocks that follow one another", () => {
    const { parse, parsed } = counted();
    const first = "The first paragraph of a finished reply, long enough to matter.\n\n";
    const second = "The second paragraph, which starts differently from the first.\n\n";
    parse(first);
    parse(second);
    parse(first);
    parse(second);
    expect(parsed).toEqual([first, second]);
  });
});
