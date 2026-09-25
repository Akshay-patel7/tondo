# Tondo build plan

This is the stage-by-stage plan for building Tondo v1. I, the coding agent, carry it out, and you review at the end of every stage. Each stage lists what to read in T3 Code first, what to verify before building on an assumption, what to build, the gotchas already found, and the proofs that close the stage.

[docs/stack.md](stack.md) holds the stack, the versions and the measurements behind them. This plan doesn't repeat them.

T3 Code is the reference app. T3 paths below are relative to commit [`53456bc0`](https://github.com/pingdotgg/t3code/tree/53456bc0129f61325dbaa498e2399c33b4360cb8) of pingdotgg/t3code (2026-09-24). T3 is MIT licensed. Code I adapt from it keeps T3's copyright notice in a header comment and gets a line in the README credits.

## Status

| Stage | Delivers | Size | Status |
|---|---|---|---|
| 0 | Foundation: toolchain, secure window, test layers, CI | M | In review |
| 1 | Streaming spike that settles React vs Solid | L | Not started |
| 2 | Host process and MessagePort transport | S | Not started |
| 3 | pi supervisor | M | Not started |
| 4 | First usable thread | M | Not started |
| 5 | Projects, threads, sidebar, process pool | M | Not started |
| 6 | Tool cards and edit diffs | M | Not started |
| 7 | Extension UI and slash commands | M | Not started |
| 8 | Composer | L | Not started |
| 9 | Per-turn diff panel | M | Not started |
| 10 | Integrated terminal | M | Not started |
| 11 | Git actions: branches, worktrees, pull requests | L | Not started |
| 12 | Visual design, onboarding, polish | L | Not started |
| 13 | Packaging, signing, updates | M | Not started |

S is one working session, M is two to four, L is five or more. These are guesses until Stages 0 and 1 calibrate them. Each stage also notes how much code T3 has for the same area, counted as non-test TypeScript lines at the pinned commit. T3 supports more agents and features than Tondo v1 needs, so those numbers are ceilings, not targets.

## What v1 includes

- Chat with pi: stream, abort, steer, queue follow-ups, switch models and thinking levels.
- Your pi setup as it is: extensions, packages, skills, prompt templates, settings, sessions.
- Projects and threads in a T3-style sidebar, with one pi process per open thread.
- Tool cards and edit diffs in the transcript.
- A diff panel for each turn's file changes.
- An integrated terminal.
- Git actions: branches, worktrees, pull requests.
- macOS and Linux builds.
- T3's layout (sidebar, timeline, composer, right panel) in Tondo's own visual style. You make the design calls.

After v1: session tree and fork navigation, Windows, reverting a turn.

## Ground rules

- A stage lands only after you OK its report, and until then its work stays uncommitted. After your OK, I commit on a branch, push it and open a pull request, so CI runs on both systems. You merge. Nothing else goes to git or GitHub without your go-ahead: no pushes to main, no merges, no comments. Commits are signed, one concern each, with a Conventional Commit subject and no body.
- Your pi setup stays untouched. Dev and test runs use a gitignored profile in `.dev/`: Tondo's own app data, a scratch `PI_CODING_AGENT_DIR`, and temporary session folders. Runs against your real `~/.pi/agent` happen only at the measurement points in Stages 3 and 12. I ask right before each run. Sessions go to a temporary folder, and no prompt goes out unless you agree, so no tokens get spent. Your extensions still load and may write to their own stores.
- Tests are deterministic. Real pi runs with a scripted model: a test extension registers pi-ai's faux provider, and pi runs offline with `--provider faux`. I verified this on pi 0.87.1. It needs no network and no API key, and real tools run. No test sleeps its way to green; tests wait for events. T3's AGENTS.md says it plainly: "A test that needs a timeout to pass is wrong."
- UI claims come with screenshots that I open and look at. For interactive browser QA I use the chrome_* tools against the renderer running in Chrome. The committed e2e suite uses Playwright's `_electron` driver.
- I stop only processes I started, by captured PID or process group, and check that their ports are free afterward. macOS has no `timeout` command, so scripts use Node deadlines instead.
- Budgets are fixed before anything is measured. If a stage misses an exit criterion, the stage stops and I report it. I don't lower the bar to finish.

## How each stage runs

1. Re-read the stage's section, AGENTS.md and my memory notes. Clone T3 at the pinned commit into a scratch folder if the stage cites it.
2. Run the stage's "verify first" checks. They're the cheapest experiments that could break the plan, so they come before any code that depends on them.
3. Build in small steps, each with its own test.
4. Run every "done when" proof and keep the output.
5. Write the stage report (template at the end), update the status table, and stop for your review.
6. After your OK, commit on a branch, push it and open a pull request. You merge.

## Architecture

```
main process (Electron): windows, tondo:// protocol, menus, starts and watches the host
 │
 ├── renderer (sandboxed, React)  ◄── MessagePort ──►  host (utility process)
 │                                                       ├── pi --mode rpc   thread A, JSONL on stdio
 │                                                       ├── pi --mode rpc   thread B
 │                                                       ├── pty shells      Stage 10
 │                                                       └── git, gh         Stages 9 and 11
 └── preload (sandboxed): hands the port to the page, nothing else
```

One package, five layers. A lint rule stops a layer from importing another layer's files.

| Folder | Runs in | Contains |
|---|---|---|
| `src/shared` | anywhere | Protocol types, the thread reducer, pure helpers. No DOM, no Node. |
| `src/main` | Electron main | Windows, protocol, menus, host lifecycle. Stays out of the data path and never loads native modules. |
| `src/preload` | sandboxed preload | Port handoff only. CommonJS, fully bundled. |
| `src/host` | utility process | pi supervisor, JSONL client, store, git, pty. |
| `src/renderer` | renderer | The React UI. |

The streaming path:

1. pi writes JSONL to stdout, and the host parses it.
2. The host runs the shared reducer for every open thread, so it can hand the renderer a snapshot of any thread at any moment.
3. For the visible thread only, the host batches events and posts one batch per frame.
4. The renderer applies each batch with the same reducer, and React commits once per frame.

Background threads send only their status: streaming, waiting for input, error, unread.

A new thread starts pi with `--session-id <uuid>`, so each thread maps to one pi session file for life. Opening a thread starts or reuses its pi process and loads the whole transcript with `get_messages`. The sidebar reads session file headers directly, read-only.

### Where Tondo departs from T3

| Area | T3 Code | Tondo | Reason |
|---|---|---|---|
| Agent connection | A local server the UI reaches over WebSocket | A utility process the UI reaches over a MessagePort | No port to open and no token to guard. Round trips measured under 0.1 ms (docs/stack.md). |
| Agents | Several coding agents behind adapters | pi only, through its RPC mode | Tondo is a pi app, so your pi setup runs unchanged. |
| Build | vite-plus with plugin-react 6 and custom Electron scripts | electron-vite 5, Vite 7, plugin-react 5.2 | electron-vite bundles main, preload and utility process together. Its stable release accepts Vite 5 to 7 only. |
| Markdown | react-markdown with an incremental parser | streamdown | Built for streaming: it memoizes blocks, so only the growing block re-renders. T3's incremental parser is a fallback in Stage 1. |
| Terminal | libghostty-vt compiled to WASM | xterm 6 | docs/stack.md's choice. If xterm falls short in Stage 10, T3's switch is worth a look. |

## Test layers

| Layer | Tooling | Proves | From |
|---|---|---|---|
| Unit | Vitest | Framing, reducer, protocol checks, git helpers | Stage 0 |
| Bench | Vitest bench | Reducer throughput | Stage 1 |
| Renderer in Chrome | Vite dev server with the fixture player, chrome_* tools | Interactive UI QA without Electron | Stage 1 |
| Fake pi | A Node script that replays fixtures and misbehaves on cue | The host survives crashes, bad lines and stalls | Stage 3 |
| pi contract | Real pi 0.87.1 with the faux provider | Tondo speaks pi's actual protocol | Stage 3 |
| E2E | Playwright `_electron`, with screenshots | Whole-app flows | Stage 0 |
| Perf | Playwright `_electron` with an in-page recorder | The budgets below | Stage 1 |
| Smoke | Launch the built app and scan its log | Bundling and packaging mistakes | Stages 0 and 13 |

The verified harness command, which Stage 1's fixture recorder and Stage 3's contract suite build on:

```sh
PI_CODING_AGENT_DIR=$(mktemp -d) pi --mode rpc --no-extensions -e ./faux-ext.ts \
  --no-skills --no-context-files --no-session --offline --provider faux --model faux-1
```

`--no-extensions` still loads files passed with `-e`. The faux provider's `tokensPerSecond` option sets the stream rate, which is what the perf fixtures need.

## Performance budgets

These are fixed now, before Stage 1 measures anything. They're measured on this Mac in a visible window, because Electron throttles timers and animation frames in background windows. The streaming scenario: a 20,000-token reply streams into a 1,000-message transcript at 200 and at 1,000 tokens per second while I type in the composer.

| Metric | Budget |
|---|---|
| Frame time, p95 | 16.7 ms or less |
| Frame time, p99 | 33 ms or less |
| Long tasks | None of 100 ms or more |
| Input to paint while streaming, p95 | 32 ms or less |
| Switch to a thread whose pi is running | Transcript painted at the bottom within 100 ms |
| Cold start | Window interactive within 1 s |
| Memory | Measured with macOS `footprint`, not RSS. Stage 1 sets the baseline, and a regression over 10% fails. |

Each scenario runs three times and the median counts. I also report a run at 4x CPU slowdown as a stand-in for slower machines. It informs; it doesn't gate.

## Stage 0: Foundation

Goal: an empty app shaped like the real one. It builds, opens a secure window, passes a smoke test, and runs every test layer on macOS and Ubuntu.

Read first: `AGENTS.md`, `apps/desktop/src/window/DesktopWindow.ts`, `apps/desktop/src/electron/ElectronProtocol.ts`, `apps/desktop/scripts/smoke-test.mjs`, `.agents/skills/test-t3-app/SKILL.md`.

Verify first:
- pnpm 10.33.4 is on PATH today. Check that it hands off to 12.6.0 through the `packageManager` field, and install 12.6.0 if it doesn't.
- pnpm reads `allowBuilds` from `pnpm-workspace.yaml` in a single-package repo.
- TypeScript 7 resolves pi's type declarations, which import with `.ts` extensions. Stage 3 imports pi's RPC types.
- The formatter must not load the `typescript` package, since TS 7 has no JavaScript API until 7.1. Check oxfmt and Prettier, and keep whichever works.
- The proof that the React Compiler ran. I expect the renderer bundle to import `react/compiler-runtime`, and the compiler's `logger` option to report every component it skips.

Build:
- `package.json` with `"packageManager": "pnpm@12.6.0"` and the exact versions from docs/stack.md, rechecked with `npm view` that day. @pierre/diffs has already moved from 1.4.3 to 1.5.0. No `"type": "module"`.
- `pnpm-workspace.yaml` with `allowBuilds` set to true for esbuild, and false for anything else that asks. Electron 44 has no install script, so it needs no entry. node-pty joins in Stage 10. pnpm's defaults stay: strict build review and a one-day minimum release age.
- electron-vite 5 on Vite 7, @vitejs/plugin-react 5.2 running babel-plugin-react-compiler 1.0 through its `babel` option, and Tailwind 4 through @tailwindcss/vite.
- Main, preload and host bundle as CommonJS, and the renderer as ESM. The preload bundles all its dependencies.
- One tsconfig per layer, each listing its `types` explicitly.
- oxlint with per-layer import restrictions. typescript-eslint is out, since TS 7 has no compiler API until 7.1.
- A secure window: `contextIsolation` and `sandbox` on, `nodeIntegration` off. The app loads from `tondo://` through `protocol.handle` with a strict CSP. Navigation, `window.open` and permission requests are denied, and http and https links open in the default browser. Every IPC handler checks its sender. macOS gets `hiddenInset` with traffic lights. Linux gets `hidden` with `titleBarOverlay`, since the window controls overlay works on Linux ([electron#41769](https://github.com/electron/electron/pull/41769)).
- A dev profile: `pnpm dev` keeps app data in `.dev/userData`, with a single-instance lock per profile.
- Scripts: `dev`, `build`, `typecheck`, `lint`, `format`, `test`, `e2e`, `smoke`. `perf` comes with Stage 1's harness, because a perf script with no scenarios can only fail.
- A smoke test modeled on T3's. It launches the built app with `ELECTRON_ENABLE_LOGGING=1`, waits for a ready line the renderer prints after first paint, and fails on "Cannot find module", "MODULE_NOT_FOUND", "Refused to execute", "Uncaught Error", "Uncaught TypeError" or "Uncaught ReferenceError". Its deadline only bounds failure.
- A Playwright `_electron` e2e skeleton that saves screenshots to `test-results/`.
- GitHub Actions for macOS and Ubuntu: install, typecheck, lint, unit, build, smoke, e2e. The repo is public, so macOS minutes are free. The workflow first runs on Stage 0's pull request.
- AGENTS.md with the commands, layer rules, verification rules, the dev profile and the rule for landing stages. `.gitignore` gains `node_modules/`, `out/`, `.dev/` and `test-results/`.

Gotchas:
- pnpm fails the install on unreviewed build scripts (`ERR_PNPM_IGNORED_BUILDS`) ([pnpm build settings](https://pnpm.io/settings/build)).
- Electron 44 has no postinstall. It downloads its binary the first time `require("electron")` runs, or when `pnpm exec install-electron` runs, which CI does as its own step. A failed download says "Electron failed to install correctly. Please delete `node_modules/electron` and run "npx install-electron --no" manually."
- electron-vite 5 accepts Vite 5 to 7. @vitejs/plugin-react 6 requires Vite 8 and has no `babel` option, so the React Compiler goes through plugin-react 5.2.
- electron-vite 5 replaced `externalizeDepsPlugin` with `build.externalizeDeps`, and anything in devDependencies gets bundled ([docs](https://electron-vite.org/guide/dependency-handling)).
- Sandboxed preloads can't use ESM and get only a few Node modules. A missing one fails with "Unable to load preload scripts -> Error: module not found". `"type": "module"` would make electron-vite emit the preload as `.mjs`, which a sandboxed preload can't load.
- TypeScript 6 and later default `types` to `[]`, so without an explicit list Node's globals vanish from main and host. `baseUrl` and `moduleResolution: node` are deprecated, and TS 7 turns those deprecations into errors.
- The React Compiler's default `panicThreshold` skips components it can't compile without a word. Use `critical_errors`, and fail CI on any skipped component.
- Playwright's Electron launch times out if the `EnableNodeCliInspectArguments` fuse is off. The e2e suite runs the unpackaged build, where fuses aren't applied.
- Ubuntu runners need `xvfb-run` for Electron ([playwright#34251](https://github.com/microsoft/playwright/issues/34251)). Ubuntu 24.04's AppArmor user-namespace restriction breaks Electron's launch even with `--no-sandbox`, so CI runs `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`.
- `utilityProcess.fork` works only after the app's `ready` event.

Done when:
- A clean clone installs with no unreviewed builds.
- `pnpm typecheck`, `lint`, `test`, `build`, `smoke` and `e2e` pass on this Mac. The report quotes the end of each output.
- A deliberate renderer-to-host import fails lint. The report shows the error, and the import is removed.
- The e2e suite asserts that the page has no `require` or `process`, that navigating to an outside URL is blocked, that `window.open` is denied, and that `tondo://` responses carry the CSP.
- The built renderer contains the React Compiler marker.
- After `pnpm dev`, new app data exists only under `.dev/`, and `~/Library/Application Support/Tondo` doesn't exist.
- The report includes a screenshot of the empty window.
- CI is green on both systems on Stage 0's pull request.

Size: M. T3's whole desktop shell (`apps/desktop/src`) is 39,281 lines; this stage needs a small slice of it.

## Stage 1: Streaming spike, the React gate

Goal: show that React 19 with the React Compiler, Legend List and streamdown keeps a long streaming reply within budget, before any other UI exists. If React still misses after the mitigations below, the same harness measures a Solid build and you decide.

It comes first because it's the largest open question in docs/stack.md, and every later UI stage depends on the answer.

Read first: `apps/web/src/components/chat/MessagesTimeline.tsx` and `MessagesTimeline.logic.ts`, `apps/web/src/markdown-incremental.ts`, `apps/web/src/lib/incrementalHighlighting.ts`, `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`, `packages/client-runtime/src/state/threadReducer.ts`, `apps/web/src/performance.bench.ts`, `patches/@legendapp__list@3.3.5.patch`, `scripts/legend-list-initial-reveal.test.ts`.

Verify first:
- T3 patches three Legend List 3.3.5 problems: end spacing when the tail size is unknown, row reordering (switched to `Element.moveBefore` so CSS transitions and iframes don't restart), and scroll-adjust padding. Check whether 3.4 fixed them. If not, port the patch with `pnpm patch` and copy T3's test, which runs the patched functions in `node:vm`.
- Shiki's WASM engine under Tondo's CSP. It needs `'wasm-unsafe-eval'`, or Shiki's JavaScript regex engine instead.
- How streamdown treats raw HTML, links and images. Model output is untrusted input.

Build:
- A fixture recorder: a script that runs real pi with the faux provider and saves its stdout. Fixtures: a 20,000-token reply with code blocks, tables and lists at 200 and 1,000 tokens per second, tool calls, thinking, an error and an abort. Plus a 1,000-message transcript in `get_messages` form.
- Thread reducer v0 in `src/shared`: pi events in, thread state out. Text built from deltas gets replaced by the `*_end` content and by `message_end.message`, which are authoritative. Unit tests run on the fixtures, and a bench measures throughput.
- A fixture player in a Web Worker, standing in for the host. It replays at recorded timing and posts one batch per frame. It also lets the renderer run in plain Chrome, which is how I QA it with the chrome_* tools.
- The timeline on Legend List 3.4, set up like T3's: `estimatedItemSize`, `initialScrollAtEnd`, `maintainScrollAtEnd` (off while you read history) and `maintainVisibleContentPosition`. Only the streaming row re-renders.
- Markdown through streamdown, and code through @streamdown/code (Shiki).
- A perf harness and its `pnpm perf` script. Playwright `_electron` drives the scenario in a visible window, the page records frame deltas, long tasks and event timing, and the results go to JSON and to a table in the report.
- Mitigations, re-measured after each one, stopping as soon as the budgets pass:
  1. Per-frame batching, the baseline.
  2. T3's paragraph pacing: deliver finished paragraphs and closed code blocks, at most one delivery every 400 ms, and flush at 24,000 buffered characters. These are T3's constants.
  3. Incremental markdown: cache the parsed prefix at each closed top-level code fence followed by a blank line, as T3's `markdown-incremental.ts` does.
  4. Highlight a code block only once it closes.
  5. A Solid build of the timeline on the same fixtures and harness. Only if 1 to 4 fail, and you decide.

Gotchas:
- Legend List's web issues: [#468](https://github.com/LegendApp/legend-list/issues/468) (content position isn't held when a header changes height in Chrome), [#463](https://github.com/LegendApp/legend-list/issues/463) (position isn't held when prepending near the bottom) and [#337](https://github.com/LegendApp/legend-list/issues/337) (scroll-at-end animation options). Loading the whole transcript at once, with no prepend paging, sidesteps #463.
- zustand 5: a selector that returns a new object on every render loops until React throws "Maximum update depth exceeded". Use atomic selectors or `useShallow`.
- streamdown on Tailwind 4 needs `@source` lines for the streamdown and @streamdown/code dist files, relative to the CSS file. Without them its styles silently disappear.
- Usage numbers are cumulative and can stay at 0 until the message ends.
- No continuously repainting animations, such as a blinking cursor. T3's AGENTS.md says they "peg the GPU on high-refresh displays".

Done when:
- The perf report meets every budget at both rates (three runs, medians), plus the 4x slowdown numbers for information.
- Reducer tests and the bench pass. Scroll behavior has tests: it opens at the bottom, stays at the bottom while streaming, and holds position while you read history.
- The report includes screenshots taken mid-stream.
- docs/stack.md records the outcome: React confirmed, or Solid chosen by you.

Size: L. T3's timeline and markdown code is 10,152 lines, and its thread reducer 864.

## Stage 2: Host process and transport

Goal: the utility-process host and its MessagePort link to the renderer, surviving renderer reloads and host crashes.

Build:
- The host runs as `utilityProcess.fork` of the host bundle, started after `ready` and named "Tondo Host".
- Main creates a `MessageChannelMain` for each page load. One port goes to the host. The other goes to the renderer through `webContents.postMessage`, the preload passes it on with `window.postMessage`, and the page accepts it only when `event.source === window`. A probe on Electron 44.4.5 already proved this layout.
- Typed, versioned messages defined in `src/shared`. The host validates everything the renderer sends.
- The Stage 1 fixture player moves from the Web Worker into the host.
- Renderer reload or renderer crash: main reloads the page, builds a new channel, and the host sends a snapshot.
- Host crash: main kills the process groups the host reported, restarts the host with backoff, and the renderer shows a reconnecting state.
- Transcripts cross the channel once, as a snapshot. After that only batches do.

Gotchas:
- `contextBridge` can't pass a MessagePort, hence the `window.postMessage` hop.
- Ports arrive in the host as `MessagePortMain` and deliver nothing until `.start()` is called.
- A utility process can pipe only stdout and stderr; stdin must be `ignore`. The host doesn't need stdin.

Done when:
- Unit tests cover message validation.
- E2E: killing the host by PID mid-stream shows the reconnecting state, then recovers.
- E2E: reloading the renderer brings back the same state.
- Measured: round-trip p95 under 1 ms, and the transfer time of a 5,000-message snapshot. The probe measured about 15 ms.

Size: S. T3 has no equivalent, since its UI talks to a local server over WebSocket.

## Stage 3: pi supervisor

Goal: find the right pi, start it with the right environment, speak its JSONL protocol without dropping or mangling a record, and never leave orphan processes.

Read first: `apps/desktop/src/shell/DesktopShellEnvironment.ts`, `packages/shared/src/shell.ts`, and pi's docs `rpc.md`, `rpc-commands.md`, `json.md`, `rpc-extension-ui.md`, `security.md` and `session-format.md`.

Verify first:
- Whether pi exits when stdin closes in the middle of a turn. I've only verified it while idle.
- Whether `--session-id` creates the session file at startup or at the first message. That decides how empty threads show up in the sidebar.

Build:
- Environment capture: run the login shell once (`$SHELL -ilc`, 5 s deadline) and print markers around `env -0`. Keep the whole environment, not just PATH, since provider keys such as `ANTHROPIC_API_KEY` often live in shell startup files. On macOS, fall back to `launchctl getenv PATH`. Remove `ELECTRON_*` variables. On Linux, restore `XDG_CURRENT_DESKTOP` from `ORIGINAL_XDG_CURRENT_DESKTOP` ([electron#47414](https://github.com/electron/electron/issues/47414)).
- pi discovery: a settings override wins, stored now and exposed in the UI in Stage 12. Otherwise resolve `pi` with the captured environment, follow version-manager shims to the real install, read its `package.json` (0.87.1 or newer), and spawn `<the node binary next to that install> <realpath of cli.js>` instead of `pi`.
- JSONL client: split on LF only and strip a trailing CR, with no `readline`. Read stdout continuously and respect stdin backpressure. Match responses by `id`, with a deadline per command. Ignore record types it doesn't know. Keep stderr in a ring buffer for error reports, and never parse it.
- Supervisor: each pi gets its own process group. Stopping means closing stdin, waiting, then SIGTERM to the group, then SIGKILL. The host reports every group to main.
- Project trust: if pi would need a decision (protected project files present and no saved decision in pi's `trust.json`), Tondo asks you, passes `--approve` or `--no-approve`, and remembers your answer itself. Tondo reads `trust.json` and never writes it.
- Logs: main and host write rotating logs in the app data folder. A pi error report carries the tail of its stderr.
- A test hook: non-packaged builds accept extra pi arguments from an environment variable, so tests can add `-e faux-ext.ts` and the offline flags.
- Fake pi: a Node script that replays fixtures and misbehaves on cue. It can crash mid-stream, send a malformed line, put U+2028 inside a string, use CRLF endings, send a 10 MB line, stop reading, or never answer a command.
- A contract suite against real pi with the faux provider: a prompt through to `agent_settled`, abort mid-stream, steer and follow-up while streaming, the bash tool, an extension dialog round trip, `get_commands` and `get_state`.
- An orphan test: SIGKILL the host mid-turn, then check that no process in any reported group survives.
- A real-setup measurement, following the ground rules: your pi configuration under Tondo's supervisor, measuring the time to first `get_state` and each process's footprint. These numbers set the pool policy in Stage 5.

Gotchas:
- On this Mac, a clean login shell resolves `pi` and `node` to asdf shims, and the `pi` shim fails in any folder that doesn't pin Node 24.15.0 ("No version is set for command pi"). pi's `#!/usr/bin/env node` shebang would also pick up whatever Node a folder pins, such as the 22.1.0 in your home folder's `.tool-versions`, while pi needs 22.19.0 or newer. That's why Tondo spawns an absolute node with the real `cli.js`.
- pi's own `RpcClient` spawns `node` from PATH, waits a fixed 100 ms, stops pi with SIGTERM and SIGKILL, and never answers extension UI requests. Tondo imports pi's types and nothing else from it.
- Node's `readline` splits lines on U+2028 and U+2029, which are legal inside JSON strings.
- pi waits when nobody reads its stdout, so a stalled reader stalls the agent.
- A `prompt` response with `success: true` means accepted, not finished. `agent_end` ends one low-level run, and retries, compaction or queued messages can follow. The turn is over at `agent_settled`. Subscribe before sending the prompt.
- A malformed command gets a `parse` error response with no `id`.
- Sending `prompt` while pi is streaming fails unless `streamingBehavior` is `"steer"` or `"followUp"`. `abort` answers only once pi is idle.
- RPC mode rejects `@file` arguments.
- RPC mode can't show pi's trust prompt. With the default `"ask"`, pi silently skips protected project resources: project settings, extensions, skills, prompt templates, themes and system prompt files. Context files such as AGENTS.md load regardless.
- pi doesn't lock session files. The same session open in terminal pi and in Tondo can interleave writes. This goes in the README's known limits.

Done when:
- Framing, client and supervisor tests pass, including every fake-pi fault.
- The contract suite passes against pi 0.87.1.
- The orphan test passes, and the report shows the process list before and after.
- The real-setup numbers are in docs/stack.md.

Size: M. T3 has no pi code; its login-shell handling is the part worth copying.

## Stage 4: First usable thread

Goal: open a project and work with pi in one thread end to end: send, stream, abort, steer, queue follow-ups, pick a model and thinking level, and see retries, compaction and errors.

Read first: `apps/web/src/components/ChatView.tsx` and `ChatView.logic.ts`, and in `apps/web/src/components/chat/`: `ChatComposer.tsx`, `ModelPickerContent.tsx`, `ContextWindowMeter.tsx`.

Build:
- Open a project folder. A new thread starts pi there with `--session-id`.
- The Stage 1 timeline, fed by live events through the host.
- A plain textarea composer for now (TipTap arrives in Stage 8), with the keys from pi's usage docs. Enter sends, and while pi works it steers the current task. Alt+Enter queues a follow-up. Alt+Up returns queued messages to the composer. Escape stops: `clear_queue`, then `abort`, then the returned text goes back into the composer. Shift+Enter adds a line.
- The queue, shown from `queue_update`.
- Model and thinking pickers (`get_available_models`, `set_model`, `get_available_thinking_levels`, `set_thinking_level`) and a context meter fed by usage.
- Banners for `auto_retry_*`, `compaction_*` and `extension_error`. If pi crashes, the thread shows the error and offers a restart.
- A design checkpoint. I show you two or three screenshots of this screen in different visual directions, you pick one, and I record the choice and its design tokens.

Done when:
- E2E against faux pi covers a prompt and its streamed reply, abort mid-stream, steer and follow-up (queue shown, then drained), a model change visible in `get_state`, the retry banner, and a pi crash followed by a restart.
- The perf harness on the live pipeline meets the budgets.
- The report has screenshots, and your design pick is recorded.

Size: M. T3's `ChatView` is 11,875 lines, and this stage builds a small core of it.

## Stage 5: Projects, threads and the sidebar

Goal: T3's sidebar for pi. Projects list their pi sessions as threads you can resume, rename and archive, a process pool keeps memory in check, and a command palette reaches everything.

Read first: in `apps/web/src/components/`: `Sidebar.tsx` and `Sidebar.logic.ts`, `AppSidebarLayout.tsx`, `CommandPalette.tsx` and `CommandPalette.logic.ts`. Also `apps/web/src/keybindings.ts`.

Verify first: `node:sqlite` inside the utility process. It worked in Electron 44.4.5 running as Node, but I haven't tried it in a utility process.

Build:
- A session index: read each session file's header line and its `session_info` entries (for names), read-only, cached by modification time. Honor session folder overrides in pi's order: `--session-dir`, then `PI_CODING_AGENT_SESSION_DIR`, then the `sessionDir` setting. Group threads by working folder.
- Tondo's store in the host, on `node:sqlite`: projects, which session file each thread uses, pinned and archived threads, drafts and UI state, with versioned migrations.
- The pool: one pi per open thread. Idle processes shut down after a timeout, and an LRU cap uses Stage 3's numbers. A busy thread is never evicted.
- New thread, rename (`set_session_name`), and resume by session path.
- The command palette and app shortcuts.

Gotchas:
- pi names a session folder after its working folder (`--<path with / \ : turned into ->--`). A worktree thread's sessions therefore live under the worktree's folder name, not the project's (Stage 11). The store keeps the thread-to-file mapping instead of guessing.
- pi reads a project's `sessionDir` setting before the trust decision.
- pi migrates v1 and v2 session files when it loads them, so the header reader has to accept every version.
- Tests never index your live sessions folder. They use generated or copied fixtures, following T3's rule to seed test data from a copy.

Done when:
- A fixture folder with 500 sessions shows in the sidebar, and the report states the indexing time.
- Resuming a thread shows its full transcript.
- An idle process gets evicted, and its PID is gone.
- With 10 faux threads streaming at once, the visible thread stays within budget.
- Store migrations have tests.

Size: M. T3's sidebar and command palette are 9,773 lines.

## Stage 6: Tool cards and edit diffs

Goal: every tool call renders as a card, and edit and write calls show real diffs, rendered by @pierre/diffs in a worker pool.

Read first: `apps/web/src/components/DiffPanel.tsx`, `apps/web/src/components/chat/ChangedFilesTree.tsx`, `patches/@pierre%2Fdiffs@1.3.0-beta.10.patch`.

Build:
- Cards for pi's built-in tools (its settings docs list `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find` and `ls`) and a generic card for extension tools showing the name, arguments and result text.
- Live bash output from `tool_execution_update`.
- Cards start collapsed, and long output is virtualized.
- Diffs through the @pierre/diffs worker pool (`WorkerPoolManager`).

Gotchas:
- Whether `partialResult` replaces or extends earlier output depends on the tool.
- T3 patched @pierre/diffs so the virtualized height cache resets when the code width changes, which matters for wrapped lines. Check 1.5.0 before porting the patch.
- Extensions' custom tool renderers don't exist over RPC, so their calls get the generic card. The README's known limits already say so.
- The CSP must allow the workers (`worker-src`).

Done when:
- A fixture with every built-in tool plus an extension tool renders correctly (screenshots).
- A 5,000-line diff renders with no long task of 100 ms or more.
- The streaming budgets still hold with cards in the transcript.

Size: M. T3's diff panel and changed-files tree are 1,478 lines, with @pierre/diffs doing the heavy work.

## Stage 7: Extension UI and slash commands

Goal: your extensions' UI works in Tondo, and the slash menu offers everything pi exposes over RPC, plus Tondo's own versions of pi's terminal-only commands.

Read first: in `apps/web/src/components/chat/`: `ComposerCommandMenu.tsx`, `composerSlashCommandSearch.ts`, `ComposerPendingApprovalPanel.tsx`. Also pi's docs `rpc-extension-ui.md` and `slash-commands.md`.

Build:
- Dialogs for `select`, `confirm`, `input` and `editor` requests, answered with an `extension_ui_response` carrying the request's id, with a countdown when the request has a timeout. A request from a background thread badges the thread and raises an OS notification.
- `notify` becomes a toast, `setStatus` a status line, `setWidget` lines above or below the composer, `setTitle` the window title while that thread is visible, and `set_editor_text` the composer's text.
- The slash menu, from `get_commands`: extension commands, prompt templates, and skills (named `skill:<name>`).
- pi's built-in commands never go to pi as text. Each maps to Tondo UI or to a clear message:

| pi command | In Tondo |
|---|---|
| `/model`, `/scoped-models` | Model picker |
| `/thinking` | Thinking level picker |
| `/new`, `/resume`, `/name` | New thread, thread switcher, rename |
| `/session` | Session info from `get_state` and `get_session_stats` |
| `/compact [instructions]` | The `compact` command |
| `/copy` | Copy the last reply (`get_last_assistant_text`) |
| `/export [path]` | `export_html` |
| `/reload` | Restart the thread's pi |
| `/login`, `/logout` | The integrated terminal running pi (Stage 10) |
| `/settings` | Tondo settings, with links to pi's settings files |
| `/hotkeys` | Shortcut sheet |
| `/trust` | Tondo's trust prompt |
| `/tree`, `/fork`, `/clone` | After v1, with the tree and fork UI |
| `/import`, `/share`, `/bug`, `/changelog`, `/llama`, `/quit` | Not in v1, and a message says so |

Gotchas:
- A built-in sent through `prompt` reaches the model as plain text. pi's RPC docs say built-ins "would not execute if sent via `prompt`".
- Over RPC, `ctx.ui.custom()` returns `undefined`, custom header, footer and editor components do nothing, widgets are plain lines, and themes aren't supported.
- Dialogs with a timeout resolve on pi's side when time runs out, so Tondo has to close them at the same moment.

Done when:
- A test extension that calls every UI method passes an e2e round trip.
- The slash menu lists a test command, a prompt template and a skill.
- A unit test walks the built-in list from pi's `slash-commands.md` and fails on any unmapped name.

Size: M.

## Stage 8: Composer

Goal: a composer as good as T3's, on TipTap 3.

Read first: `apps/web/src/components/chat/ChatComposer.tsx`, `apps/web/src/composerDraftStore.ts`, and in `apps/web/src/components/chat/`: `composerPromptHistory.ts`, `ComposerImageThumbnail.tsx`, `ExpandedImageDialog.tsx`.

Verify first: what pi's own editor puts in the prompt when you pick a file after typing `@`, the path or the file's contents. Tondo has to produce the same prompt, since RPC rejects `@file` arguments.

Build:
- TipTap with Markdown in and out, and drafts per thread in the store.
- `@` file mentions from a file index in the host (`git ls-files` plus untracked files, capped), producing what pi's editor produces.
- Images by paste and drop, sent as `prompt` images (base64 data with a MIME type), with thumbnails.
- Prompt history on Up, and Shift+Enter, Alt+Enter, Alt+Up and Escape as in Stage 4.

Gotchas, mostly from T3's composer:
- The draft store owns the Markdown and TipTap owns the document. Replace the editor's content only when the controlled text really changed, or every cursor move lands in the undo history.
- Offsets in the store aren't ProseMirror positions.
- Copy through the Markdown serializer. A newline splits a paragraph.
- Programmatic cursor moves must scroll the caret into view.
- Enter during IME composition (`event.isComposing`) must not send.

Done when: e2e covers IME composition not sending, a pasted image reaching pi (the faux provider records it), inserting a mention, a draft surviving a restart, and undo after programmatic edits.

Size: L. T3's composer, draft store and command menu are 11,598 lines.

## Stage 9: Per-turn diff panel

Goal: the right panel shows what each turn changed, using T3's hidden-ref checkpoints.

Read first: `apps/server/src/vcs/GitVcsDriver.ts` (the checkpoint code, with its limits at lines 392 to 396), `apps/server/src/checkpointing/`, `apps/server/src/orchestration/Layers/CheckpointReactor.ts`, `apps/web/src/components/RightPanelTabs.tsx` and `DiffPanel.tsx`.

Build:
- A baseline checkpoint at turn start if one is missing, and a completion checkpoint when the turn settles.
- Refs named `refs/tondo/checkpoints/<base64url(threadId)>/turn/<n>`. Capture uses a temporary index: `GIT_INDEX_FILE` pointing at a copy of the real index, `git add` into it, `write-tree`, then `commit-tree` with author and committer set through the environment (so it works without a git identity), then `update-ref`.
- Diffs between checkpoints through the Stage 6 renderer, with a changed-files tree.
- A thread's refs get deleted with the thread.
- Folders without git get a panel that says why it's empty.

Gotchas. All but the last come from comments in T3's checkpoint code:
- "an unclean restart can leave 0-byte files under refs/t3/** that break every later fetch and push". Checkpoint writes use `-c core.fsync=objects,reference -c core.fsyncMethod=fsync`.
- A forced kill can leave git's index lock behind. The temporary index keeps the real one out of it, and index commands run with `-c core.fsmonitor=false`.
- Sparse checkouts show false deletions unless the temporary index is seeded correctly. Embedded repositories without a first commit must be excluded.
- Caps: 10,000,000 bytes of diff output and 16 MiB for file listings.
- Git can be initialized during a turn. Keep the completion checkpoint and don't invent a baseline.
- A checkpoint covers the whole checkout, so two threads in the same folder see each other's edits in their turn diffs. Worktrees (Stage 11) fix that, and the panel says so when threads share a folder.
- Background `git status` runs with `GIT_OPTIONAL_LOCKS=0`, so it never fights pi's own git commands for the index lock. T3 doesn't set it. Git's docs recommend it for background processes.

Done when:
- Tests on generated repositories cover edits, new files, deletions, renames, binaries, a sparse checkout, an embedded repository, a diff over the cap, and a kill -9 during capture followed by a clean `git fsck`.
- E2E: faux pi edits a file, and the panel shows the diff (screenshot).

Size: M. T3's `GitVcsDriver.ts`, `CheckpointReactor.ts` and `checkpointing/` total 2,924 lines.

## Stage 10: Integrated terminal

Goal: a terminal drawer per thread, with node-pty in the host and xterm 6 in the renderer. It also hosts pi's `/login`.

Read first: `apps/server/src/terminal/PtyAdapter.ts`, `apps/web/src/components/ThreadTerminalDrawer.tsx`. T3 now draws its terminal with libghostty-vt compiled to WASM, so only its backend and drawer carry over.

Verify first:
- node-pty is built on Node-API, and its macOS prebuild already ran from Electron 44.4.5's main process (docs/stack.md). Confirm the same inside the utility process.
- Which xterm 6 addons exist and work under the CSP, the WebGL renderer in particular.
- Whether running pi processes see new credentials after `/login` writes `auth.json`, or need a restart.

Build:
- Pty sessions in the host with the captured environment, the thread's folder as cwd, and `TERM=xterm-256color`.
- xterm 6 in a resizable drawer.
- History caps like T3's: 5,000 lines or 8 MiB in the host, 512 KiB in the renderer. Terminal query and response traffic gets stripped from kept history.
- Closing a terminal kills its process group.
- "Sign in to a provider" opens a terminal running pi, where you run `/login`.

Gotchas:
- node-pty 1.1.0 on macOS ships `spawn-helper` without the execute bit, which fails with "posix_spawnp failed" ([node-pty#850](https://github.com/microsoft/node-pty/issues/850)). A postinstall `chmod +x` fixes it.
- node-pty's install script needs an `allowBuilds` entry.
- Native modules stay out of main, a T3 rule. The pty lives in the host.
- Packaging must unpack node-pty from the asar archive and drop the other architecture's prebuilds, as T3's `scripts/build-desktop-artifact.ts` does.

Done when:
- E2E runs a command and reads its output, and resizing works.
- 50 MB of output streams through with no long task of 100 ms or more.
- Closing the drawer leaves no process in the pty's group.

Size: M. T3's terminal backend and drawer are 5,105 lines.

## Stage 11: Git actions

Goal: branches, a worktree per thread, and pull requests, from a branch toolbar like T3's.

Read first: in `apps/web/src/components/`: `BranchToolbar.tsx` with `BranchToolbar.logic.ts`, `BranchToolbarBranchSelector.tsx` and `BranchToolbarEnvModeSelector.tsx`, and `GitActionsControl.tsx` with `GitActionsControl.logic.ts`. In `apps/server/src/`: `vcs/GitVcsDriverCore.ts`, `vcs/VcsStatusBroadcaster.ts`, `pullRequest/GitHubPullRequestCli.ts` and `storageCleanup.ts`.

Build:
- Status polling in the host with `GIT_OPTIONAL_LOCKS=0`, sent to the renderer only for the visible project.
- List, switch and create branches.
- Local or worktree mode per thread. A worktree thread gets `git worktree add -b <branch> <path> <base>` in a Tondo-managed folder, and its pi runs there. Removal uses `git worktree remove` and `git worktree prune`, and abandoned worktrees get cleaned up.
- Commit, push and pull request actions that you trigger, through `git` and the `gh` CLI. Tondo detects a missing or logged-out `gh`.

Gotchas:
- Removing a worktree with uncommitted changes needs `--force`, so Tondo asks first.
- Worktree threads keep their pi sessions under the worktree's folder name (Stage 5).
- `gh` can be missing, logged out, or pointed at GitHub Enterprise. Take the host from the remote URL.
- Switching branches while pi is mid-turn in the same checkout gets a warning and is blocked.

Done when:
- Tests run on generated repositories with a bare remote and a stub `gh` on PATH that records its arguments and returns canned JSON.
- E2E: a worktree thread's bash tool prints the worktree path, and a pull request gets created through the stub.

Size: L. T3's branch and git UI is 4,793 lines, `GitVcsDriverCore.ts` is 3,710, and `pullRequest/` alone is 19,752. From that last part, Tondo v1 needs create, view and status.

## Stage 12: Visual design and polish

Goal: your chosen style across the whole app, with onboarding, settings, empty states, accessibility, and a perf pass on your real setup.

Build:
- Design tokens in the Tailwind 4 theme, and components from shadcn 4 on Base UI. Components own their look: pick a variant, never restyle with `className`, as T3's rules say.
- Light and dark themes.
- Onboarding for pi not found, pi too old, no credentials (which leads to the `/login` terminal), and project trust.
- Settings: pi path, pool size, theme, shortcuts, and links to pi's config files.
- Keyboard paths through the sidebar, timeline, composer and panels, visible focus, and labels for screen readers.
- A real-setup perf pass, following the ground rules: copies of your real sessions and your extensions, measuring cold start, thread switch and footprint, then tuning the pool.

Done when:
- Every changed screen has before and after screenshots, and you've approved them.
- The budgets hold on your real setup.
- The report includes a keyboard-only walkthrough.

Size: L, set mostly by how many design rounds we do.

## Stage 13: Packaging, signing, updates

Goal: installable macOS and Linux builds that keep the Chromium sandbox wherever the platform allows, with fuses set and auto-update working.

Read first: `scripts/build-desktop-artifact.ts`.

Needs: your Apple Developer ID, which you don't have yet. Signing, notarization and macOS auto-update all depend on it.

Build:
- electron-builder: app id, asar, node-pty unpacked, per-architecture prebuilds.
- Fuses through `electronFuses`: run-as-node off, cookie encryption on, `NODE_OPTIONS` off, inspect arguments off (a separate e2e build keeps them on), and embedded asar integrity validation on.
- macOS: dmg plus zip, hardened runtime, entitlements that start from T3's (allow-jit, allow-unsigned-executable-memory, disable-library-validation) and get trimmed to what Tondo needs, then signing and notarization with your Developer ID.
- Linux: deb and AppImage.
- electron-updater with GitHub Releases, tested against a local static server.
- A release workflow that runs when you push a tag.
- The smoke test on packaged builds for both systems.

Gotchas:
- macOS auto-update works only for signed apps, and it needs the zip target.
- Ubuntu 24.04 and later restrict unprivileged user namespaces. An Electron app without an AppArmor profile aborts with "The SUID sandbox helper binary was found, but is not configured correctly" ([electron#41066](https://github.com/electron/electron/issues/41066), [electron#42510](https://github.com/electron/electron/issues/42510)). electron-builder's deb installs an AppArmor profile, so the sandbox stays on. Its AppImage falls back to `--no-sandbox` when user namespaces are blocked, and Tondo's docs will say so.
- Electron 38 and later run natively on Wayland when it's available, and `ELECTRON_OZONE_PLATFORM_HINT` is gone since 39. Wayland doesn't support the minimized state, so restore and multi-monitor placement need testing.
- electron-builder's `latest` tag is 26.15.3, its `v26` tag 26.16.1, and 27 is in alpha. Stay on 26.

Done when:
- Packaged builds pass the smoke test on this Mac and on Ubuntu 24.04.
- The fuses read back from the packaged app match the intended values.
- `spctl -a -vv` accepts the notarized app.
- Version N updates to N+1 from the local server.

Size: M. T3's `build-desktop-artifact.ts` is 3,930 lines.

## Decisions

You accepted these defaults on 2026-09-25.

- A finished stage lands as a pull request after you OK its report, as the ground rules describe.
- Tondo runs against your real pi setup only at the measurement points in Stages 3 and 12, within the limits in the ground rules.
- There's no Apple Developer ID yet. You get one before Stage 13.
- This plan is kept in the repo as docs/plan.md, and the status table changes as stages land.
- App id `io.github.akshay-patel7.tondo`.
- Minimum pi version 0.87.1, the one tested.
- Worktrees live in a Tondo-managed folder, as in T3, not next to your repositories.
- Linux ships as deb and AppImage, with the AppImage sandbox caveat documented.
- No telemetry and no crash-reporting service. Logs stay local.
- Reverting a turn waits until after v1. T3 can do it, and T3's own code warns that restoring a shared folder "can erase a sibling's work".

## Stage report template

```
Stage N: <name>
Shipped:              what exists now that didn't before
Proofs:               each command and the result I saw
Screenshots:          paths, each one opened and checked
Perf vs budgets:      table
Changes to the plan:  what changed and why
Not verified:         anything I couldn't prove, and why
Proposed commits:     one subject per concern
Next:                 the next stage's first step
```
