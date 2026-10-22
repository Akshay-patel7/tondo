import { describe, expect, it } from "vitest";
import { parseClientMessage, PROTOCOL_VERSION } from "./protocol";
import { IMAGE_FIXTURE } from "./imageFixture";

const v = PROTOCOL_VERSION;

function rejection(data: unknown): string {
  const result = parseClientMessage(data);
  if (result.ok) throw new Error(`Expected ${JSON.stringify(data)} to be rejected`);
  return result.error;
}

describe("parseClientMessage", () => {
  it("update requests accept only a host-offered id, never commands, sources or force flags", () => {
    const id = "0199c5e0-4a2b-7c3d-9e8f-1a2b3c4d5e6f";
    for (const message of [
      { v, type: "check-pi-updates", manual: "yes" },
      { v, type: "apply-pi-update", id: "npm:test-plugin" },
      { v, type: "apply-pi-update", id, command: "npm install" },
      { v, type: "apply-pi-update", id, source: "npm:test-plugin" },
      { v, type: "apply-pi-update", id, force: true },
    ])
      expect(parseClientMessage(message).ok).toBe(false);
  });

  it("rejects nonboolean draft input provenance", () => {
    expect(
      parseClientMessage({
        v,
        type: "set-draft",
        threadId: "t",
        text: "draft",
        userInput: "yes",
      }).ok,
    ).toBe(false);
  });

  it("accepts every message the page sends, as a copy", () => {
    const threadId = "0199c5e0-4a2b-7c3d-9e8f-1a2b3c4d5e6f";
    for (const message of [
      { v, type: "add-project" },
      { v, type: "choose-files", id: "request-1" },
      { v, type: "remove-project", projectId: 1 },
      { v, type: "set-collapsed", projectId: 1, collapsed: true },
      { v, type: "new-thread", projectId: 2 },
      { v, type: "get-project-git", projectId: 2 },
      { v, type: "check-pi-updates", manual: false },
      { v, type: "check-pi-updates", manual: true },
      { v, type: "apply-pi-update", id: threadId },
      { v, type: "open-thread", threadId },
      { v, type: "rename-thread", threadId, name: "Parser fix" },
      { v, type: "pin-thread", threadId, pinned: true },
      { v, type: "mark-unread", threadId },
      { v, type: "delete-thread", threadId },
      { v, type: "set-draft", threadId, text: "" },
      { v, type: "set-draft", threadId, text: "half a thought" },
      { v, type: "set-draft", threadId, text: "extension text", userInput: false },
      { v, type: "set-draft", threadId, text: "typed text", userInput: true },
      { v, type: "list-files", threadId, id: 1 },
      { v, type: "list-checkpoints", threadId },
      { v, type: "read-checkpoint", threadId, id: 1, turn: 2 },
      { v, type: "set-draft-images", threadId, images: [IMAGE_FIXTURE] },
      { v, type: "set-draft-images", threadId, images: [] },
      {
        v,
        type: "prompt",
        threadId,
        text: "",
        streamingBehavior: "steer",
        imageIds: [IMAGE_FIXTURE.id],
      },
      { v, type: "set-sidebar-hidden", hidden: true },
      { v, type: "refresh" },
      { v, type: "trust", threadId, trusted: true },
      { v, type: "trust", threadId, trusted: false },
      { v, type: "prompt", threadId, text: "Fix the parser", streamingBehavior: "steer" },
      { v, type: "prompt", threadId, text: "then run the tests", streamingBehavior: "followUp" },
      { v, type: "stop", threadId },
      { v, type: "dequeue", threadId },
      { v, type: "set-model", threadId, provider: "anthropic", modelId: "claude-opus-4-5" },
      { v, type: "set-thinking-level", threadId, level: "high" },
      { v, type: "restart", threadId },
      { v, type: "answer", threadId, dialogId: "d1", answer: { value: "apple" } },
      { v, type: "answer", threadId, dialogId: "d1", answer: { value: "" } },
      { v, type: "answer", threadId, dialogId: "d2", answer: { confirmed: false } },
      { v, type: "answer", threadId, dialogId: "d3", answer: { cancelled: true } },
      { v, type: "compact", threadId, instructions: "" },
      { v, type: "compact", threadId, instructions: "Keep the plan" },
      { v, type: "copy-reply", threadId },
      { v, type: "export", threadId, path: "" },
      { v, type: "export", threadId, path: "notes/thread.html" },
      { v, type: "session-info", threadId },
      { v, type: "trust-status", threadId },
      { v, type: "reload", threadId },
      { v, type: "reveal", path: "/tmp/pi-session.html" },
      { v, type: "ping", id: 0 },
      { v, type: "set-settings", patch: {} },
      { v, type: "set-settings", patch: { theme: "dark" } },
      { v, type: "set-settings", patch: { palette: "slate" } },
      { v, type: "set-settings", patch: { expandThinking: true } },
      { v, type: "set-settings", patch: { expandThinking: false } },
      { v, type: "set-settings", patch: { panelWidths: { sidebar: 200, changes: 800 } } },
      { v, type: "set-settings", patch: { panelWidths: { sidebar: 480 } } },
      { v, type: "set-settings", patch: { panelWidths: { changes: 280 } } },
      { v, type: "set-settings", patch: { theme: "light", palette: "default" } },
      { v, type: "set-settings", patch: { pool: { maxLive: 1, idleMinutes: 240 } } },
      { v, type: "set-settings", patch: { pool: { maxLive: 12 } } },
      {
        v,
        type: "set-settings",
        patch: { shortcuts: { palette: "mod+shift+p", settings: null, "new-thread": "default" } },
      },
      { v, type: "set-settings", patch: { piPath: "/opt/pi/bin/pi" } },
      { v, type: "set-settings", patch: { piPath: null } },
      { v, type: "choose-pi-path" },
      { v, type: "choose-worktree-directory" },
      { v, type: "set-settings", patch: { worktreeDirectory: "/work/trees" } },
      { v, type: "set-settings", patch: { worktreeDirectory: null } },
      { v, type: "retry-pi" },
      { v, type: "get-pi-config-files", threadId: null },
      { v, type: "get-pi-config-files", threadId },
      { v, type: "get-pi-accounts" },
      { v, type: "terminal-open", threadId, kind: "login", provider: "anthropic" },
      { v, type: "terminal-open", threadId, kind: "login", provider: "GitHub Copilot" },
    ]) {
      const result = parseClientMessage(message);
      expect(result).toEqual({ ok: true, message });
      if (result.ok) expect(result.message).not.toBe(message);
    }
  });

  it("checks checkpoint identities and forbids paths or Git arguments from the page", () => {
    for (const turn of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
      expect(rejection({ v, type: "read-checkpoint", threadId: "t", id: 1, turn })).toContain(
        "valid integers",
      );
    }
    expect(rejection({ v, type: "list-checkpoints", threadId: "" })).toContain("threadId");
    expect(rejection({ v, type: "read-checkpoint", threadId: "t", id: -1, turn: 1 })).toContain(
      "valid integers",
    );
    expect(
      rejection({ v, type: "read-checkpoint", threadId: "t", id: 1, turn: 1, path: "/outside" }),
    ).toContain("unexpected field");
  });

  it("rejects anything that isn't an object", () => {
    expect(rejection(null)).toBe("a message must be an object, not null");
    expect(rejection(undefined)).toBe("a message must be an object, not undefined");
    expect(rejection("stop")).toBe('a message must be an object, not "stop"');
    expect(rejection(1)).toBe("a message must be an object, not 1");
    expect(rejection([v, "stop"])).toBe("a message must be an object, not an array");
  });

  it("rejects a missing or different protocol version", () => {
    expect(rejection({ type: "stop" })).toBe(`protocol version undefined isn't ${v}`);
    expect(rejection({ v: v + 1, type: "stop" })).toBe(`protocol version ${v + 1} isn't ${v}`);
    expect(rejection({ v: String(v), type: "stop" })).toBe(`protocol version "${v}" isn't ${v}`);
  });

  it("rejects unknown message types", () => {
    expect(rejection({ v })).toBe("unknown message type undefined");
    expect(rejection({ v, type: "play" })).toBe('unknown message type "play"');
    expect(rejection({ v, type: "snapshot" })).toBe('unknown message type "snapshot"');
  });

  it("rejects a trust answer that isn't true or false", () => {
    expect(rejection({ v, type: "trust", threadId: "t" })).toBe(
      "trust: trusted must be true or false, not undefined",
    );
    expect(rejection({ v, type: "trust", threadId: "t", trusted: "yes" })).toBe(
      'trust: trusted must be true or false, not "yes"',
    );
  });

  it("rejects a thread id that isn't a short string", () => {
    for (const [threadId, shown] of [
      [undefined, "undefined"],
      ["", '""'],
      [7, "7"],
      ["x".repeat(201), `"${"x".repeat(40)}…"`],
    ] as const) {
      for (const type of [
        "open-thread",
        "mark-unread",
        "delete-thread",
        "list-files",
        "stop",
        "dequeue",
        "restart",
        "copy-reply",
        "session-info",
        "trust-status",
        "reload",
      ]) {
        expect(rejection({ v, type, threadId })).toBe(
          `${type}: threadId must be a string of 1 to 200 characters, not ${shown}`,
        );
      }
    }
    expect(parseClientMessage({ v, type: "stop", threadId: "x".repeat(200) }).ok).toBe(true);
  });

  it("rejects a project id that isn't an integer", () => {
    for (const [projectId, shown] of [
      [undefined, "undefined"],
      ["1", '"1"'],
      [1.5, "1.5"],
    ] as const) {
      for (const type of ["remove-project", "new-thread"]) {
        expect(rejection({ v, type, projectId })).toBe(
          `${type}: projectId must be an integer, not ${shown}`,
        );
      }
    }
    expect(rejection({ v, type: "set-collapsed", projectId: 1, collapsed: "no" })).toBe(
      'set-collapsed: collapsed must be true or false, not "no"',
    );
  });

  it("rejects a blank name, a draft that isn't text and flags that aren't true or false", () => {
    expect(rejection({ v, type: "rename-thread", threadId: "t", name: "  " })).toBe(
      'rename-thread: name must be a string that isn\'t blank, not "  "',
    );
    expect(rejection({ v, type: "set-draft", threadId: "t", text: null })).toBe(
      "set-draft: text must be a string, not null",
    );
    expect(rejection({ v, type: "pin-thread", threadId: "t", pinned: 1 })).toBe(
      "pin-thread: pinned must be true or false, not 1",
    );
    expect(
      parseClientMessage({ v, type: "archive-thread", threadId: "t", archived: true }).ok,
    ).toBe(false);
    expect(
      parseClientMessage({ v, type: "delete-thread", threadId: "t", path: "/outside" }).ok,
    ).toBe(false);
    expect(rejection({ v, type: "set-sidebar-hidden", hidden: "yes" })).toBe(
      'set-sidebar-hidden: hidden must be true or false, not "yes"',
    );
  });

  it("rejects invalid file-index request ids and a renderer-supplied project path", () => {
    for (const id of [undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      expect(rejection({ v, type: "list-files", threadId: "t", id })).toContain(
        "id must be a nonnegative integer",
      );
    }
    expect(
      rejection({ v, type: "list-files", threadId: "t", id: 1, project: "/outside" }),
    ).toContain("unexpected field");
  });

  it("rejects invalid attachment edits and image references", () => {
    for (const images of [
      null,
      [{ ...IMAGE_FIXTURE, mimeType: "image/svg+xml" }],
      [{ ...IMAGE_FIXTURE, data: "file:///etc/passwd" }],
    ]) {
      expect(parseClientMessage({ v, type: "set-draft-images", threadId: "t", images }).ok).toBe(
        false,
      );
    }
    for (const imageIds of [null, [1], [""], ["x", "x"], ["../x"], ["a", "b", "c", "d", "e"]]) {
      expect(
        rejection({
          v,
          type: "prompt",
          threadId: "t",
          text: "hi",
          streamingBehavior: "steer",
          imageIds,
        }),
      ).toContain("invalid image ids");
    }
    expect(
      parseClientMessage({
        v,
        type: "prompt",
        threadId: "t",
        text: "",
        streamingBehavior: "steer",
        imageIds: [],
      }).ok,
    ).toBe(false);
  });

  it("rejects a prompt without text", () => {
    for (const [text, shown] of [
      ["", '""'],
      [" \n\t", '" \\n\\t"'],
      [undefined, "undefined"],
      [["hi"], "an array"],
    ] as const) {
      expect(
        rejection({ v, type: "prompt", threadId: "t", text, streamingBehavior: "steer" }),
      ).toBe(`prompt: text must be a string that isn't blank, not ${shown}`);
    }
  });

  it("rejects a prompt that doesn't say how to queue", () => {
    expect(rejection({ v, type: "prompt", threadId: "t", text: "hi" })).toBe(
      'prompt: streamingBehavior must be "steer" or "followUp", not undefined',
    );
    expect(
      rejection({ v, type: "prompt", threadId: "t", text: "hi", streamingBehavior: "all" }),
    ).toBe('prompt: streamingBehavior must be "steer" or "followUp", not "all"');
  });

  it("rejects a model or thinking level that isn't a string", () => {
    expect(rejection({ v, type: "set-model", threadId: "t", provider: "faux" })).toBe(
      'set-model: provider and modelId must be strings, not "faux" and undefined',
    );
    expect(rejection({ v, type: "set-thinking-level", threadId: "t", level: 3 })).toBe(
      "set-thinking-level: level must be a string, not 3",
    );
  });

  it("rejects a dialog answer that isn't exactly one field of the right type", () => {
    const answer = (value: unknown) =>
      rejection({ v, type: "answer", threadId: "t", dialogId: "d", answer: value });
    for (const [value, shown] of [
      [undefined, "undefined"],
      ["apple", '"apple"'],
      [["apple"], "an array"],
      [{}, "an object"],
      [{ value: 1 }, "an object"],
      [{ confirmed: "yes" }, "an object"],
      [{ cancelled: false }, "an object"],
      [{ value: "apple", cancelled: true }, "an object"],
      [{ choice: "apple" }, "an object"],
    ] as const) {
      expect(answer(value)).toBe(
        `answer: answer must hold one value, confirmed or cancelled field, not ${shown}`,
      );
    }
    expect(
      rejection({ v, type: "answer", threadId: "t", dialogId: "", answer: { cancelled: true } }),
    ).toBe('answer: dialogId must be a string of 1 to 200 characters, not ""');
  });

  it("rejects slash command details that aren't text", () => {
    expect(rejection({ v, type: "compact", threadId: "t" })).toBe(
      "compact: instructions must be a string, not undefined",
    );
    expect(rejection({ v, type: "export", threadId: "t", path: 1 })).toBe(
      "export: path must be a string, not 1",
    );
    expect(rejection({ v, type: "reveal", path: "" })).toBe(
      'reveal: path must be a string that isn\'t empty, not ""',
    );
  });

  it("rejects ping ids that aren't safe integers", () => {
    for (const [id, shown] of [
      [1.5, "1.5"],
      ["1", '"1"'],
      [2 ** 53, String(2 ** 53)],
      [undefined, "undefined"],
    ] as const) {
      expect(rejection({ v, type: "ping", id })).toBe(`ping: id must be an integer, not ${shown}`);
    }
  });

  it("rejects fields a message doesn't have", () => {
    expect(rejection({ v, type: "stop", threadId: "t", fixture: "tools" })).toBe(
      'stop: unexpected field "fixture"',
    );
    expect(rejection({ v, type: "ping", id: 1, sentAt: 0 })).toBe(
      'ping: unexpected field "sentAt"',
    );
    expect(rejection({ v, type: "add-project", folder: "/etc" })).toBe(
      'add-project: unexpected field "folder"',
    );
  });

  it("copies a settings patch rather than passing the page's object on", () => {
    const pool = { maxLive: 3 };
    const result = parseClientMessage({ v, type: "set-settings", patch: { pool } });
    if (!result.ok || result.message.type !== "set-settings") throw new Error("rejected");
    expect(result.message.patch.pool).toEqual(pool);
    expect(result.message.patch.pool).not.toBe(pool);
  });

  it.each([
    [{ patch: null }, "set-settings: patch must be an object"],
    [{ patch: [] }, "set-settings: patch must be an object"],
    [{ patch: { language: "en" } }, 'set-settings: patch has an unexpected field "language"'],
    [{ patch: { theme: "blue" } }, "set-settings: theme must be"],
    [{ patch: { theme: "ocean" } }, "set-settings: theme must be"],
    [{ patch: { palette: "dark" } }, 'set-settings: palette must be "default", "slate", "ocean"'],
    [{ patch: { palette: "teal" } }, "set-settings: palette must be"],
    [{ patch: { palette: null } }, "set-settings: palette must be"],
    [{ patch: { expandThinking: "true" } }, "set-settings: expandThinking must be true or false"],
    [{ patch: { expandThinking: null } }, "set-settings: expandThinking must be true or false"],
    [{ patch: { expandThinking: 1 } }, "set-settings: expandThinking must be true or false"],
    [{ patch: { panelWidths: [] } }, "set-settings: panelWidths must be an object"],
    [{ patch: { panelWidths: null } }, "set-settings: panelWidths must be an object"],
    [
      { patch: { panelWidths: { sidebar: 199 } } },
      "set-settings: panelWidths.sidebar is out of range",
    ],
    [
      { patch: { panelWidths: { sidebar: 481 } } },
      "set-settings: panelWidths.sidebar is out of range",
    ],
    [
      { patch: { panelWidths: { changes: 279 } } },
      "set-settings: panelWidths.changes is out of range",
    ],
    [
      { patch: { panelWidths: { changes: 801 } } },
      "set-settings: panelWidths.changes is out of range",
    ],
    [
      { patch: { panelWidths: { sidebar: 256.5 } } },
      "set-settings: panelWidths.sidebar is out of range",
    ],
    [
      { patch: { panelWidths: { sidebar: "256" } } },
      "set-settings: panelWidths.sidebar is out of range",
    ],
    [
      { patch: { panelWidths: { other: 400 } } },
      'set-settings: panelWidths has an unexpected field "other"',
    ],
    [{ patch: { pool: 4 } }, "set-settings: pool must be an object"],
    [{ patch: { pool: { maxLive: 0 } } }, "set-settings: pool.maxLive is out of range: 0"],
    [{ patch: { pool: { maxLive: 13 } } }, "set-settings: pool.maxLive is out of range: 13"],
    [{ patch: { pool: { maxLive: 1.5 } } }, "set-settings: pool.maxLive is out of range"],
    [{ patch: { pool: { idleMinutes: 0 } } }, "set-settings: pool.idleMinutes is out of range"],
    [{ patch: { pool: { idleMinutes: 241 } } }, "set-settings: pool.idleMinutes is out of range"],
    [{ patch: { pool: { idleMs: 5 } } }, 'set-settings: pool has an unexpected field "idleMs"'],
    [{ patch: { shortcuts: [] } }, "set-settings: shortcuts must be an object"],
    [{ patch: { shortcuts: { quit: "mod+q" } } }, "set-settings: shortcuts has an unknown command"],
    [{ patch: { shortcuts: { palette: "mod+" } } }, "set-settings: shortcuts.palette must be"],
    [{ patch: { shortcuts: { palette: 5 } } }, "set-settings: shortcuts.palette must be"],
    [
      { patch: { worktreeDirectory: "" } },
      "set-settings: worktreeDirectory must be a path or null",
    ],
    [{ patch: { worktreeDirectory: 5 } }, "set-settings: worktreeDirectory must be a path or null"],
    [
      { patch: { worktreeDirectory: "/path\0bad" } },
      "set-settings: worktreeDirectory must be a path or null",
    ],
    [
      { patch: { worktreeDirectory: "x".repeat(4097) } },
      "set-settings: worktreeDirectory must be a path or null",
    ],
    [{ patch: { piPath: "" } }, "set-settings: piPath must be a path or null"],
    [{ patch: { piPath: 5 } }, "set-settings: piPath must be a path or null"],
    [{ patch: {}, extra: 1 }, 'set-settings: unexpected field "extra"'],
  ])("rejects the settings change %j", (fields, error) => {
    expect(rejection({ v, type: "set-settings", ...fields })).toContain(error);
  });

  it("rejects pi messages with fields they don't have or a bad thread id", () => {
    expect(rejection({ v, type: "choose-pi-path", path: "/x" })).toContain("unexpected field");
    expect(rejection({ v, type: "retry-pi", threadId: "t" })).toContain("unexpected field");
    expect(rejection({ v, type: "get-pi-config-files" })).toContain("threadId must be");
    expect(rejection({ v, type: "get-pi-config-files", threadId: 5 })).toContain(
      "threadId must be",
    );
  });

  it("speaks version 26, which adds sidebar thread models", () => {
    expect(PROTOCOL_VERSION).toBe(26);
  });

  it("rejects extra fields when marking a thread unread", () => {
    expect(rejection({ v, type: "mark-unread", threadId: "t", unread: false })).toContain(
      "unexpected field",
    );
  });

  it.each([
    {},
    { id: "" },
    { id: 1 },
    { id: "x".repeat(101) },
    { id: "../file" },
    { id: "request-1", paths: ["/not-a-user-selection"] },
  ])("rejects malformed or path-injecting picker requests: %j", (fields) => {
    expect(parseClientMessage({ v, type: "choose-files", ...fields }).ok).toBe(false);
  });

  it("takes find-files with a thread, a request id and a short query", () => {
    const message = { v, type: "find-files", threadId: "t", id: 1, query: "main.ts" };
    expect(parseClientMessage(message)).toEqual({ ok: true, message });
  });

  it.each([
    [{ threadId: "t", id: -1, query: "a" }],
    [{ threadId: "t", id: 1, query: 3 }],
    [{ threadId: "t", id: 1, query: "a".repeat(4097) }],
    [{ threadId: "t", id: 1, query: "a", extra: 1 }],
  ])("rejects find-files %j", (fields) => {
    expect(parseClientMessage({ v, type: "find-files", ...fields }).ok).toBe(false);
  });

  it("rejects get-pi-accounts with any field besides its type", () => {
    expect(rejection({ v, type: "get-pi-accounts", threadId: "t" })).toBe(
      'get-pi-accounts: unexpected field "threadId"',
    );
  });

  it("takes a provider only for a login terminal, and only a plain provider name", () => {
    const open = (kind: string, provider: unknown) =>
      rejection({ v, type: "terminal-open", threadId: "t", kind, provider });
    expect(open("shell", "anthropic")).toBe(
      "terminal-open: only a login terminal takes a provider",
    );
    for (const provider of [
      "anthropic\r",
      "anthropic\rrm -rf ~",
      "\u001b[201~anthropic",
      "x".repeat(65),
      "",
      " anthropic",
      "anthropic ",
      "a/b",
      7,
      null,
    ]) {
      expect(open("login", provider)).toContain("terminal-open: provider must be 1 to 64");
    }
    expect(
      parseClientMessage({
        v,
        type: "terminal-open",
        threadId: "t",
        kind: "login",
        provider: "x".repeat(64),
      }).ok,
    ).toBe(true);
  });

  it("describes hostile values without calling them", () => {
    const hostile = { toString: 1, valueOf: 1 };
    expect(rejection(hostile)).toBe(`protocol version undefined isn't ${v}`);
    expect(rejection({ v: hostile })).toBe(`protocol version an object isn't ${v}`);
    expect(rejection({ v, type: hostile })).toBe("unknown message type an object");
    expect(
      rejection({ v, type: "prompt", threadId: "t", text: hostile, streamingBehavior: "steer" }),
    ).toBe("prompt: text must be a string that isn't blank, not an object");
    expect(rejection({ v, type: "open-thread", threadId: hostile })).toBe(
      "open-thread: threadId must be a string of 1 to 200 characters, not an object",
    );
  });

  it("shortens long strings in errors", () => {
    expect(rejection({ v, type: "x".repeat(1000) })).toBe(
      `unknown message type "${"x".repeat(40)}…"`,
    );
  });
});
