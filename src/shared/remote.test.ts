import { describe, expect, it } from "vitest";
import { parseClientMessage, PROTOCOL_VERSION as v, type ClientMessage } from "./protocol";
import { remoteRequestAllowed } from "./remote";

describe("remote settings protocol", () => {
  it.each([true, false])("accepts the saved on/off value: %s", (remoteAccess) => {
    expect(parseClientMessage({ v, type: "set-settings", patch: { remoteAccess } })).toMatchObject({
      ok: true,
      message: { patch: { remoteAccess } },
    });
  });
  it.each([null, "true", 1, {}])("rejects invalid remote settings: %j", (remoteAccess) => {
    expect(parseClientMessage({ v, type: "set-settings", patch: { remoteAccess } })).toMatchObject({
      ok: false,
    });
  });
  it.each(["set-model", "set-thinking-level"])(
    "grants remote %s on the selected thread",
    (type) => {
      expect(remoteRequestAllowed({ type } as ClientMessage)).toBe(true);
    },
  );
  it.each([
    "set-settings",
    "trust",
    "choose-files",
    "terminal-write",
    "git-action",
    "apply-pi-update",
    "open-ide",
    "set-draft",
    "dequeue",
  ])("does not grant remote %s", (type) => {
    expect(remoteRequestAllowed({ type } as ClientMessage)).toBe(false);
  });
});
