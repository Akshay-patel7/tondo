import { expect, it } from "vitest";
import { RemoteBackoff } from "./reconnect";

it("backs off repeated failures and caps the delay", () => {
  const backoff = new RemoteBackoff();
  expect(Array.from({ length: 9 }, () => backoff.delay(0))).toEqual([
    500, 1000, 2000, 4000, 8000, 10000, 10000, 10000, 10000,
  ]);
});

it("does not reset backoff for short-lived sockets", () => {
  const backoff = new RemoteBackoff();
  backoff.connected(0);
  expect(backoff.delay(20)).toBe(500);
  backoff.connected(600);
  expect(backoff.delay(620)).toBe(1000);
  backoff.connected(1700);
  expect(backoff.delay(1720)).toBe(2000);
});

it("resets after a genuinely stable connection, not time spent disconnected", () => {
  const backoff = new RemoteBackoff();
  expect(backoff.delay(0)).toBe(500);
  expect(backoff.delay(60_000)).toBe(1000);
  backoff.connected(70_000);
  expect(backoff.delay(80_000)).toBe(500);
  expect(backoff.delay(90_000)).toBe(1000);
});

it("does not count time hidden or offline as a stable connection", () => {
  const backoff = new RemoteBackoff();
  expect(backoff.delay(0)).toBe(500);
  backoff.connected(500);
  backoff.disconnected(600);
  expect(backoff.delay(60_000)).toBe(1000);
});
