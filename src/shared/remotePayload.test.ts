import { expect, it, vi } from "vitest";
import { REMOTE_FRAME_BYTES } from "./remote";
import { remotePayloadFits } from "./remotePayload";

it("accepts ordinary plain JSON including escaped and Unicode text without mutating it", () => {
  const data = { title: "Hello 👋\n", values: [true, false, null, 42, { optional: undefined }] };
  const before = JSON.stringify(data);
  expect(remotePayloadFits(data)).toBe(true);
  expect(JSON.stringify(data)).toBe(before);
});

it("rejects large strings and broad or cyclic objects before IPC cloning", () => {
  expect(remotePayloadFits({ image: "x".repeat(REMOTE_FRAME_BYTES) })).toBe(false);
  expect(remotePayloadFits({ items: Array<string>(40_000).fill("small") })).toBe(false);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  expect(remotePayloadFits(cycle)).toBe(false);
});

it("does not serialize values or invoke toJSON hooks to find the size", () => {
  const toJSON = vi.fn(() => "not a protocol value");
  expect(remotePayloadFits({ toJSON })).toBe(false);
  expect(toJSON).not.toHaveBeenCalled();
  expect(remotePayloadFits(new Date())).toBe(false);
  expect(remotePayloadFits(1n)).toBe(false);
});
