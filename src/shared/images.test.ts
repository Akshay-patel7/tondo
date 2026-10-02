import { describe, expect, it } from "vitest";
import { IMAGE_FIXTURE } from "./imageFixture";
import { IMAGE_BYTES, imageBytes, imagesError } from "./images";

describe("image attachments", () => {
  it("accepts bounded rasters and counts their decoded bytes", () => {
    expect(imagesError([])).toBeNull();
    expect(imagesError([IMAGE_FIXTURE])).toBeNull();
    for (const data of ["YQ==", "YWI=", "YWJj"])
      expect(imageBytes(data)).toBe(Buffer.from(data, "base64").length);
    for (const [mimeType, signature] of [
      ["image/jpeg", "\xff\xd8\xff"],
      ["image/gif", "GIF89a"],
      ["image/webp", "RIFF1234WEBP"],
    ]) {
      expect(
        imagesError([
          {
            ...IMAGE_FIXTURE,
            mimeType,
            data: Buffer.from(signature!, "binary").toString("base64"),
          },
        ]),
      ).toBeNull();
    }
  });

  it("rejects URLs, SVG, malformed base64, mismatched signatures and unexpected fields", () => {
    for (const patch of [
      { data: "https://example.com/image.png" },
      { data: "iVBORw0KGgo!" },
      { data: "" },
      { mimeType: "image/svg+xml" },
      { mimeType: "image/jpeg" },
      { path: "/private/file.png" },
      { id: "" },
      { name: "" },
      { name: "a".repeat(256) },
    ])
      expect(imagesError([{ ...IMAGE_FIXTURE, ...patch }])).not.toBeNull();
    for (const value of [null, {}, [null], [IMAGE_FIXTURE, IMAGE_FIXTURE]])
      expect(imagesError(value)).not.toBeNull();
  });

  it("bounds count and bytes before processing a large base64 string", () => {
    expect(
      imagesError(Array.from({ length: 5 }, (_, i) => ({ ...IMAGE_FIXTURE, id: String(i) }))),
    ).toContain("at most 4");
    expect(
      imagesError([{ ...IMAGE_FIXTURE, data: "a".repeat(Math.ceil(IMAGE_BYTES / 3) * 4 + 4) }]),
    ).toContain("5 MiB");
    const padded = Buffer.concat([
      Buffer.from(IMAGE_FIXTURE.data, "base64"),
      Buffer.alloc(4 * 1024 * 1024),
    ]).toString("base64");
    expect(
      imagesError(
        Array.from({ length: 3 }, (_, i) => ({ ...IMAGE_FIXTURE, id: String(i), data: padded })),
      ),
    ).toContain("10 MiB");
  });
});
