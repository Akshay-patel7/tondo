import { describe, expect, it } from "vitest";
import { NO_EXTENSION_UI as NO_UI } from "../shared/protocol";
import { applyUiRequest, readUiRequest, responseTo, stripAnsi, withoutDialog } from "./extensionUi";
import type { PiRecord } from "./piRpc";

const NOW = 1_000_000;

function request(fields: Record<string, unknown>): PiRecord {
  return { type: "extension_ui_request", id: "req-1", ...fields };
}

/** The UI after each request, in order, from nothing shown. */
function uiAfter(...records: Record<string, unknown>[]) {
  return records.reduce(
    (ui, fields) => applyUiRequest(ui, readUiRequest(request(fields), NOW)),
    NO_UI,
  );
}

describe("readUiRequest", () => {
  // These are the records pi 0.87.1 wrote for an extension calling each method.
  it("reads each dialog, and when a timed one expires", () => {
    expect(
      readUiRequest(request({ method: "select", title: "Pick one", options: ["a", "b"] }), NOW),
    ).toEqual({
      kind: "dialog",
      dialog: {
        id: "req-1",
        method: "select",
        title: "Pick one",
        options: ["a", "b"],
        expiresAt: null,
      },
      options: ["a", "b"],
    });
    expect(
      readUiRequest(
        request({ method: "confirm", title: "Sure?", message: "Really?", timeout: 1000 }),
        NOW,
      ),
    ).toMatchObject({
      kind: "dialog",
      dialog: { method: "confirm", title: "Sure?", message: "Really?", expiresAt: NOW + 1000 },
    });
    expect(
      readUiRequest(request({ method: "input", title: "Name?", placeholder: "type a name" }), NOW),
    ).toMatchObject({ kind: "dialog", dialog: { method: "input", placeholder: "type a name" } });
    expect(readUiRequest(request({ method: "input", title: "Name?" }), NOW)).toMatchObject({
      kind: "dialog",
      dialog: { method: "input", placeholder: "" },
    });
    expect(
      readUiRequest(request({ method: "editor", title: "Edit", prefill: "l1\nl2" }), NOW),
    ).toMatchObject({
      kind: "dialog",
      dialog: { method: "editor", prefill: "l1\nl2", expiresAt: null },
    });
  });

  it("expires a dialog when pi's timer would fire", () => {
    const expiry = (timeout: unknown) => {
      const read = readUiRequest(
        request({ method: "select", title: "t", options: ["a"], timeout }),
        NOW,
      );
      return read.kind === "dialog" ? read.dialog.expiresAt : "not a dialog";
    };
    expect(expiry(undefined)).toBeNull();
    expect(expiry(0)).toBeNull();
    expect(expiry(2500)).toBe(NOW + 2500);
    // Node runs timers outside 1 ms to 2^31 − 1 ms after 1 ms, pi's among them.
    expect(expiry(-5)).toBe(NOW + 1);
    expect(expiry(2 ** 31)).toBe(NOW + 1);
    // An editor has no timeout in pi.
    const editor = readUiRequest(request({ method: "editor", title: "t", timeout: 5 }), NOW);
    expect(editor.kind === "dialog" && editor.dialog.expiresAt).toBeNull();
  });

  it("strips color codes from what it shows, and keeps pi's options for the answer", () => {
    const colored = "\u001B[38;2;138;190;183mAllow\u001B[39m";
    expect(
      readUiRequest(
        request({
          method: "select",
          title: "\u001B[1mRun?\u001B[22m",
          options: [colored, "Block"],
        }),
        NOW,
      ),
    ).toEqual({
      kind: "dialog",
      dialog: {
        id: "req-1",
        method: "select",
        title: "Run?",
        options: ["Allow", "Block"],
        expiresAt: null,
      },
      options: [colored, "Block"],
    });
  });

  it("cancels dialogs it can't show, and ignores requests without an id", () => {
    expect(readUiRequest(request({ method: "select", title: "t", options: [] }), NOW)).toEqual({
      kind: "bad-dialog",
      id: "req-1",
    });
    expect(readUiRequest(request({ method: "select", title: "t", options: [1] }), NOW)).toEqual({
      kind: "bad-dialog",
      id: "req-1",
    });
    expect(readUiRequest(request({ method: "confirm", title: 3, message: "m" }), NOW)).toEqual({
      kind: "bad-dialog",
      id: "req-1",
    });
    expect(readUiRequest(request({ method: "editor", title: "t", prefill: 4 }), NOW)).toEqual({
      kind: "bad-dialog",
      id: "req-1",
    });
    expect(
      readUiRequest(
        { type: "extension_ui_request", method: "confirm", title: "t", message: "m" },
        NOW,
      ),
    ).toEqual({ kind: "ignored" });
  });

  it("reads the requests that need no answer", () => {
    expect(
      readUiRequest(request({ method: "notify", message: "hello", notifyType: "warning" }), NOW),
    ).toEqual({
      kind: "notify",
      level: "warning",
      message: "hello",
    });
    // pi leaves notifyType out for info.
    expect(readUiRequest(request({ method: "notify", message: "plain" }), NOW)).toEqual({
      kind: "notify",
      level: "info",
      message: "plain",
    });
    expect(readUiRequest(request({ method: "setTitle", title: "pi - probe" }), NOW)).toEqual({
      kind: "title",
      title: "pi - probe",
    });
    expect(readUiRequest(request({ method: "set_editor_text", text: "prefilled" }), NOW)).toEqual({
      kind: "editor-text",
      text: "prefilled",
    });
    expect(readUiRequest(request({ method: "setFooter" }), NOW)).toEqual({ kind: "ignored" });
    expect(readUiRequest(request({ method: "notify" }), NOW)).toEqual({ kind: "ignored" });
  });
});

describe("applyUiRequest", () => {
  it("keeps statuses in the order their keys first appeared, and clears them", () => {
    const ui = uiAfter(
      { method: "setStatus", statusKey: "git", statusText: "main" },
      { method: "setStatus", statusKey: "tests", statusText: "running" },
      { method: "setStatus", statusKey: "git", statusText: "\u001B[32mmain*\u001B[39m" },
    );
    expect(ui.statuses).toEqual([
      { key: "git", text: "main*" },
      { key: "tests", text: "running" },
    ]);
    // pi leaves statusText out to clear the key, and an empty text shows nothing either.
    const cleared = [
      { method: "setStatus", statusKey: "git" },
      { method: "setStatus", statusKey: "tests", statusText: "" },
    ].reduce((current, fields) => applyUiRequest(current, readUiRequest(request(fields), NOW)), ui);
    expect(cleared.statuses).toEqual([]);
  });

  it("places widgets above the composer unless told otherwise, and clears them", () => {
    const ui = uiAfter(
      { method: "setWidget", widgetKey: "plan", widgetLines: ["1. read", "2. fix"] },
      {
        method: "setWidget",
        widgetKey: "todo",
        widgetLines: ["later"],
        widgetPlacement: "belowEditor",
      },
      { method: "setWidget", widgetKey: "plan" },
    );
    expect(ui.widgets).toEqual([{ key: "todo", lines: ["later"], placement: "belowEditor" }]);
  });

  it("returns the same object when nothing changes", () => {
    const ui = uiAfter(
      { method: "setStatus", statusKey: "k", statusText: "same" },
      { method: "setWidget", widgetKey: "w", widgetLines: ["a"] },
      { method: "setTitle", title: "t" },
    );
    for (const fields of [
      { method: "setStatus", statusKey: "k", statusText: "same" },
      { method: "setStatus", statusKey: "gone" },
      { method: "setWidget", widgetKey: "w", widgetLines: ["a"] },
      { method: "setWidget", widgetKey: "gone" },
      { method: "setTitle", title: "t" },
      { method: "notify", message: "toasts don't change what's shown" },
    ]) {
      expect(applyUiRequest(ui, readUiRequest(request(fields), NOW))).toBe(ui);
    }
  });

  it("queues dialogs oldest first until each is answered", () => {
    const first = readUiRequest(
      request({ id: "a", method: "confirm", title: "First", message: "" }),
      NOW,
    );
    const second = readUiRequest(request({ id: "b", method: "input", title: "Second" }), NOW);
    const ui = applyUiRequest(applyUiRequest(NO_UI, first), second);
    expect(ui.dialogs.map((dialog) => dialog.id)).toEqual(["a", "b"]);
    expect(withoutDialog(ui, "a").dialogs.map((dialog) => dialog.id)).toEqual(["b"]);
    expect(withoutDialog(ui, "missing")).toBe(ui);
  });
});

describe("stripAnsi", () => {
  it("removes colors, cursor moves, titles and hyperlinks", () => {
    expect(stripAnsi("\u001B[38;2;138;190;183mcolored status\u001B[39m")).toBe("colored status");
    expect(stripAnsi("\u001B[1;31mbold red\u001B[0m and \u001B[2Kplain")).toBe(
      "bold red and plain",
    );
    expect(stripAnsi("\u001B]0;window title\u0007text")).toBe("text");
    expect(stripAnsi("\u001B]8;;https://example.com\u001B\\link\u001B]8;;\u001B\\")).toBe("link");
    expect(stripAnsi("\u009B31mC1 red")).toBe("C1 red");
  });

  it("leaves other text alone", () => {
    expect(stripAnsi("[38;2m isn't an escape without ESC")).toBe(
      "[38;2m isn't an escape without ESC",
    );
    expect(stripAnsi("tabs\tand\nnewlines")).toBe("tabs\tand\nnewlines");
  });
});

/** The dialog request `fields` make, with id "d" and title "Q". */
function dialogRequest(fields: Record<string, unknown>) {
  const read = readUiRequest(request({ id: "d", title: "Q", ...fields }), NOW);
  if (read.kind !== "dialog") throw new Error(`not a dialog: ${JSON.stringify(read)}`);
  return read;
}

describe("responseTo", () => {
  it("answers a select with pi's own option, color codes and all", () => {
    const colored = "\u001B[31mAllow\u001B[39m";
    const { dialog: select, options } = dialogRequest({
      method: "select",
      options: [colored, "Block"],
    });
    expect(responseTo(select, { value: "Allow" }, options ?? undefined)).toEqual({
      type: "extension_ui_response",
      id: "d",
      value: colored,
    });
    expect(() => responseTo(select, { value: "Maybe" }, options ?? undefined)).toThrow(
      '"Q" has no option like that.',
    );
    expect(() => responseTo(select, { confirmed: true }, options ?? undefined)).toThrow(
      '"Q" has no option like that.',
    );
  });

  it("answers a confirm yes or no, and text dialogs with text", () => {
    const { dialog: confirm } = dialogRequest({ method: "confirm", message: "m" });
    expect(responseTo(confirm, { confirmed: false }, undefined)).toEqual({
      type: "extension_ui_response",
      id: "d",
      confirmed: false,
    });
    expect(() => responseTo(confirm, { value: "yes" }, undefined)).toThrow(
      '"Q" needs a yes or no.',
    );
    for (const method of ["input", "editor"]) {
      const { dialog: text } = dialogRequest({ method });
      expect(responseTo(text, { value: "" }, undefined)).toEqual({
        type: "extension_ui_response",
        id: "d",
        value: "",
      });
      expect(() => responseTo(text, { confirmed: true }, undefined)).toThrow('"Q" needs text.');
    }
  });

  it("cancels any dialog", () => {
    for (const fields of [
      { method: "select", options: ["a"] },
      { method: "confirm", message: "" },
      { method: "input" },
      { method: "editor" },
    ]) {
      expect(responseTo(dialogRequest(fields).dialog, { cancelled: true }, undefined)).toEqual({
        type: "extension_ui_response",
        id: "d",
        cancelled: true,
      });
    }
  });
});
