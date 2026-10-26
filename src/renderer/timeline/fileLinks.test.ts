import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Streamdown } from "streamdown";
import { describe, expect, test } from "vitest";
import { FILE_LINK_PREFIX, fileLinkTarget, isLocalFileLink } from "../../shared/filePreview";
import { REMARK_PLUGINS } from "./reuseParses";

describe("local file links", () => {
  test.each(["streaming", "static"] as const)(
    "the screenshot's links survive %s rendering",
    (mode) => {
      const text =
        "[Dark preview](test-results/history-dark.png) · [Performance report](.dev/perf/report.md)";
      const html = renderToStaticMarkup(
        createElement(
          Streamdown,
          {
            mode,
            remarkPlugins: REMARK_PLUGINS,
            linkSafety: { enabled: false },
          },
          text,
        ),
      );
      expect(html).not.toContain("[blocked]");
      expect(html).toContain(
        FILE_LINK_PREFIX + encodeURIComponent("test-results/history-dark.png"),
      );
      expect(html).toContain(FILE_LINK_PREFIX + encodeURIComponent(".dev/perf/report.md"));
    },
  );

  test.each([
    "./report.md",
    "../report.md",
    "/tmp/report.md",
    "file:///tmp/report%20one.md",
    "docs/report.md#L3",
  ])("preserves the original target %s", (target) => {
    expect(isLocalFileLink(target)).toBe(true);
    expect(fileLinkTarget(FILE_LINK_PREFIX + encodeURIComponent(target))).toBe(target);
  });

  test.each([
    "https://example.com",
    "//example.com/file",
    "javascript:alert(1)",
    "data:text/html,test",
    "mailto:test@example.com",
    "file://server/report.md",
    "#heading",
    "a\u0000b",
    "\\\\server\\file",
    " report.md",
  ])("doesn't treat %s as a local file", (target) => {
    expect(isLocalFileLink(target)).toBe(false);
  });

  test("unsafe URLs stay blocked, external links stay external, inline code stays untouched", () => {
    const html = renderToStaticMarkup(
      createElement(
        Streamdown,
        {
          mode: "static",
          remarkPlugins: REMARK_PLUGINS,
          linkSafety: { enabled: false },
        },
        "[Web](https://example.com) [Bad](javascript:alert%281%29) `[literal](report.md)`",
      ),
    );
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain("[blocked]");
    expect(html).toContain("[literal](report.md)");
    expect(html).not.toContain(FILE_LINK_PREFIX);
    expect(fileLinkTarget(FILE_LINK_PREFIX + "%zz")).toBeNull();
    expect(fileLinkTarget(FILE_LINK_PREFIX + encodeURIComponent("javascript:alert(1)"))).toBeNull();
  });
});
