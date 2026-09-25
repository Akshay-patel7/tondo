import path from "node:path";
import { describe, expect, it } from "vitest";
import { isExternalHttpUrl, isSameOrigin, resolveAppRequest } from "./securityPolicy";

describe("resolveAppRequest", () => {
  const root = path.resolve("/srv/tondo/renderer");
  const resolve = (url: string, method = "GET") => resolveAppRequest(root, method, url);

  it("serves index.html for the app root, with or without a slash", () => {
    const index = { kind: "file", filePath: path.join(root, "index.html") };
    expect(resolve("tondo://app/")).toEqual(index);
    expect(resolve("tondo://app")).toEqual(index);
  });

  it("maps paths to files under the root", () => {
    expect(resolve("tondo://app/assets/index-abc.js")).toEqual({
      kind: "file",
      filePath: path.join(root, "assets", "index-abc.js"),
    });
    expect(resolve("tondo://app/assets/index-abc.js", "HEAD").kind).toBe("file");
  });

  it("keeps dot segments inside the root", () => {
    expect(resolve("tondo://app/../../etc/passwd")).toEqual({
      kind: "file",
      filePath: path.join(root, "etc", "passwd"),
    });
  });

  it("refuses encoded slashes that climb out of the root", () => {
    expect(resolve("tondo://app/..%2F..%2Fetc%2Fpasswd")).toEqual({ kind: "error", status: 404 });
  });

  it("refuses a sibling folder that shares the root's name as a prefix", () => {
    expect(resolve("tondo://app/..%2Frenderer-evil%2Fx.js")).toEqual({
      kind: "error",
      status: 404,
    });
  });

  it("refuses other hosts", () => {
    expect(resolve("tondo://evil/index.html")).toEqual({ kind: "error", status: 404 });
  });

  it("refuses methods other than GET and HEAD", () => {
    expect(resolve("tondo://app/", "POST")).toEqual({ kind: "error", status: 405 });
  });

  it("rejects malformed encoding and null bytes", () => {
    expect(resolve("tondo://app/%E0%A4%A")).toEqual({ kind: "error", status: 400 });
    expect(resolve("tondo://app/index.html%00.js")).toEqual({ kind: "error", status: 400 });
  });
});

describe("isSameOrigin", () => {
  it("matches the app's own URLs", () => {
    expect(isSameOrigin("tondo://app/settings", "tondo://app/")).toBe(true);
    expect(isSameOrigin("http://localhost:5173/x", "http://localhost:5173/")).toBe(true);
  });

  it("rejects other hosts, ports and schemes", () => {
    expect(isSameOrigin("tondo://evil/", "tondo://app/")).toBe(false);
    expect(isSameOrigin("http://localhost:5174/", "http://localhost:5173/")).toBe(false);
    expect(isSameOrigin("https://app/", "tondo://app/")).toBe(false);
  });

  it("rejects strings that aren't URLs", () => {
    expect(isSameOrigin("not a url", "tondo://app/")).toBe(false);
  });
});

describe("isExternalHttpUrl", () => {
  it("accepts http and https", () => {
    expect(isExternalHttpUrl("https://example.com/")).toBe(true);
    expect(isExternalHttpUrl("http://example.com/")).toBe(true);
  });

  it("rejects every other scheme", () => {
    for (const url of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "tondo://app/",
      "mailto:a@b.c",
    ]) {
      expect(isExternalHttpUrl(url)).toBe(false);
    }
    expect(isExternalHttpUrl("not a url")).toBe(false);
  });
});
