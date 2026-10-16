# Tondo build plan

This is the stage-by-stage plan for building Tondo v1. I, the coding agent, carry it out, and you review at the end of every stage. Each stage lists what to read in T3 Code first, what to verify before building on an assumption, what to build, the gotchas already found, and the proofs that close the stage.

[docs/stack.md](stack.md) holds the stack, the versions and the measurements behind them. This plan doesn't repeat them.

T3 Code is the reference app. T3 paths below are relative to commit [`53456bc0`](https://github.com/pingdotgg/t3code/tree/53456bc0129f61325dbaa498e2399c33b4360cb8) of pingdotgg/t3code (2026-09-24). T3 is MIT licensed. Code I adapt from it keeps T3's copyright notice in a header comment and gets a line in the README credits.

## Status

| Stage | Delivers | Size | Status |
|---|---|---|---|
| 0 | Foundation: toolchain, secure window, test layers, CI | M | Done |
| 1 | Streaming spike that settles React vs Solid | L | Done |
| 2 | Host process and MessagePort transport | S | Done |
| 3 | pi supervisor | M | Done |
| 4 | First usable thread | M | Done |
| 5 | Projects, threads, sidebar, process pool | M | Done |
| 6 | Tool cards and edit diffs | M | Done |
| 7 | Extension UI and slash commands | M | Done |
| 8 | Composer | L | Done |
| 9 | Per-turn diff panel | M | Done |
| 10 | Integrated terminal | M | Done |
| 11 | Git actions: branches, worktrees, pull requests | L | Done |
| 12 | Visual design, onboarding, polish | L | Done |
| 13 | Packaging, signing, updates | M | Done |

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
- UI claims come with screenshots that I open and look at. The committed e2e suite uses Playwright's `_electron` driver.
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

These are fixed now, before Stage 1 measures anything. They're measured on this Mac in a visible window, because Electron throttles timers and animation frames in background windows, and on its built-in display at 2x and 120 Hz. Since Stage 6, `pnpm perf` fails on any other display. The streaming scenario: a 20,000-token reply streams into a 1,000-message transcript at 200 and at 1,000 tokens per second while I type in the composer.

| Metric | Budget |
|---|---|
| Frame time, p95 | 16.7 ms or less |
| Frame time, p99 | 33 ms or less |
| Long tasks | None of 100 ms or more |
| Input to paint while streaming, p95 | 32 ms or less |
| Switch to a thread whose pi is running | Transcript painted at the bottom within 100 ms |
| Cold start | Window interactive within 1 s |
| Memory | Measured with macOS `footprint`, not RSS, right after collecting garbage in every JavaScript heap. Stage 1 sets the baseline (recorded in docs/stack.md), and a regression over 10% fails. |

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
- A fixture player in a Web Worker, standing in for the host. It replays at recorded timing and posts one batch every 1/60 s, the timer the host will use, and the renderer commits at most one state change per animation frame. It also lets the renderer run in plain Chrome, which is how I QA it with the chrome_* tools.
- The timeline on Legend List 3.4, set up like T3's: `estimatedItemSize`, `initialScrollAtEnd`, `maintainScrollAtEnd` (off while you read history) and `maintainVisibleContentPosition`. Only the streaming row re-renders. It ends Legend List's opening scroll as soon as the list is ready (see Gotchas).
- Markdown through streamdown, and code through @streamdown/code (Shiki).
- A perf harness and its `pnpm perf` script. Playwright `_electron` drives the scenario in a visible window, the page records frame deltas, long tasks and event timing, and the results go to JSON and to a table in the report. It also times cold start and a thread switch, with a Reopen button standing in for the switch until Stage 5, and reads memory with `footprint` after collecting garbage.
- Mitigations, re-measured after each one, stopping as soon as the budgets pass:
  1. Per-frame batching, the baseline. It met every budget, so 2 to 5 weren't built.
  2. T3's paragraph pacing: deliver finished paragraphs and closed code blocks, at most one delivery every 400 ms, and flush at 24,000 buffered characters. These are T3's constants.
  3. Incremental markdown: cache the parsed prefix at each closed top-level code fence followed by a blank line, as T3's `markdown-incremental.ts` does.
  4. Highlight a code block only once it closes.
  5. A Solid build of the timeline on the same fixtures and harness. Only if 1 to 4 fail, and you decide.

Gotchas:
- Legend List's web issues: [#468](https://github.com/LegendApp/legend-list/issues/468) (content position isn't held when a header changes height in Chrome), [#463](https://github.com/LegendApp/legend-list/issues/463) (position isn't held when prepending near the bottom) and [#337](https://github.com/LegendApp/legend-list/issues/337) (scroll-at-end animation options). Loading the whole transcript at once, with no prepend paging, sidesteps #463.
- Legend List keeps its `initialScrollAtEnd` scroll alive for 2 s after the list is ready. A row added in that window restarts it with position upkeep off, so about 1,000 unmeasured rows are re-estimated at once and the view jumps about 325,000 px up the transcript for one frame. Any imperative scroll ends it, so the timeline calls `scrollToEnd` in `onReady`.
- `maintainScrollAtEnd` scrolls in the animation frame after the content grows, so the newest line can sit partly hidden for a frame or two. In two runs of the scroll test at 1,000 tokens per second, about 6% of frames ended more than 40 px short of the end, by at most 228 px, and the list caught up within 17 ms each time. At 4x CPU slowdown it trailed for up to 130 ms, and GitHub's macOS runner measured 130.6 ms. So `pnpm perf` checks this time on this Mac, and CI doesn't.
- Distance from the end can't tell a reader who scrolled away from rows that grew before Legend List scrolled to the new end. When the timeline decided from distance alone, a scroll callback could find the view more than 40 px short while nobody was scrolling and switch following off. That also turned `maintainScrollAtEnd` off, so the timeline could stop following for the rest of the reply. CI's Ubuntu runner caught it once (run 36211427525), and in an Ubuntu 24.04 container with 4 CPUs the stay-at-bottom test failed 3 of 20 runs. Following now switches off only when the view moves up and ends more than 40 px short, in `src/renderer/timeline/follow.ts`.
- zustand 5: a selector that returns a new object on every render loops until React throws "Maximum update depth exceeded". Use atomic selectors or `useShallow`.
- streamdown on Tailwind 4 needs `@source` lines for the streamdown and @streamdown/code dist files, relative to the CSS file. Without them its styles silently disappear.
- Usage numbers are cumulative and can stay at 0 until the message ends.
- No continuously repainting animations, such as a blinking cursor. T3's AGENTS.md says they "peg the GPU on high-refresh displays".

Done when:
- The perf report meets every budget at both rates (three runs, medians), plus the 4x slowdown numbers for information.
- Reducer tests and the bench pass. Scroll behavior has tests: it opens at the bottom, stays at the bottom while streaming, and holds position while you read history. The perf report checks that the view is never more than 40 px short of the end for over 100 ms, the thread-switch budget.
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
- If a renderer crashes while a Playwright command to its page is in flight, Chromium answers that command after it reports the crash, and Playwright 1.63 throws on the answer and fails the test. `page.waitForFunction` leaves a `Runtime.releaseObject` in flight as it returns. CI's Ubuntu runner caught it once (run 36337055916), and in an Ubuntu 24.04 container with 4 CPUs the crash test failed 14 of 40 runs. The test now leaves the page to main, which waits for the reply, crashes the renderer and reads the reloaded page.

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
- pi discovery: a settings override wins. Stage 12's Settings page sets it with Choose pi…, and Use pi from PATH clears it. Otherwise resolve `pi` with the captured environment, follow version-manager shims to the real install, read its `package.json` (0.87.1 or newer), and spawn `<the node binary next to that install> <realpath of cli.js>` instead of `pi`.
- JSONL client: split on LF only and strip a trailing CR, with no `readline`. Read stdout continuously and respect stdin backpressure. Match responses by `id`, with a deadline per command. Ignore record types it doesn't know. Keep stderr in a ring buffer for error reports, and never parse it.
- Supervisor: each pi gets its own process group. Stopping means closing stdin, waiting, then SIGTERM to the group, then SIGKILL. The host reports every group to main.
- Project trust: work out whether pi would need a decision (protected project files present, no saved decision in pi's `trust.json`, and pi's `defaultProjectTrust` set to `"ask"`), and pass `--approve` or `--no-approve` from the answer Tondo keeps in its own settings. Tondo reads `trust.json` and never writes it. Asking you moves to Stage 4, where you open a project.
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
- pi runs each bash command in a process group of its own. Closing stdin or SIGTERM makes pi stop those groups as it exits, but SIGKILL to pi's group leaves them running.
- On macOS, a SIGKILL sent to a process group while bash forks can miss the new child, which keeps running with launchd as its parent. The contract test used to run `echo $$; sleep 60` through pi's bash tool, stop pi and expect the group gone. A copy of it left `sleep` running in 4 of 1,000 runs on this Mac under load, and the test most likely failed on CI's macOS runner the same way (run 36339780999). Tests that kill a command now have it start `sleep` before it prints its pid. pi's `killProcessTree` sends one SIGKILL, and so do Tondo's `drainGroup` and `stopGroup`, so a command that forks just then can leave a process behind.

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
- Project trust: when Stage 3's check says a project needs a decision, ask before starting pi, and remember the answer in Tondo's settings, which get their first writer here.
- The Stage 1 timeline, fed by live events through the host.
- A plain textarea composer for now (TipTap arrives in Stage 8), with the keys from pi's usage docs. Enter sends, and while pi works it steers the current task. Alt+Enter queues a follow-up. Alt+Up returns queued messages to the composer. Escape stops: `clear_queue`, then `abort`, then the returned text goes back into the composer. Shift+Enter adds a line.
- The queue, shown from `queue_update`.
- Model and thinking pickers (`get_available_models`, `set_model`, `get_available_thinking_levels`, `set_thinking_level`) and a context meter fed by usage.
- Banners for `auto_retry_*`, `compaction_*` and `extension_error`. If pi crashes, the thread shows the error and offers a restart.
- A design checkpoint. I show you two or three screenshots of this screen in different visual directions, you pick one, and I record the choice and its design tokens.

Done when:
- E2E against faux pi covers a prompt and its streamed reply, abort mid-stream, steer and follow-up (queue shown, then drained), a model change visible in `get_state`, the retry banner, the trust question for a project that needs one, and a pi crash followed by a restart.
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
- pi creates the session file at the first reply, even with `--session-id` (Stage 3 checked this on pi 0.87.1). A new thread has no file until then, so the sidebar lists threads from Tondo's store, not only the files it finds. `get_state` names the file from the start. With a relative `sessionDir` setting that name is relative to the project folder.
- On the real setup a new pi answers about 1.4 s after it starts (docs/stack.md). Opening a thread whose pi was shut down waits that long for `get_messages`.

Done when:
- A fixture folder with 500 sessions shows in the sidebar, and the report states the indexing time.
- Resuming a thread shows its full transcript.
- An idle process gets evicted, and its PID is gone.
- With 10 faux threads streaming at once, the visible thread stays within budget.
- Store migrations have tests.

Size: M. The T3 files under Read first are 10,618 lines.

## Stage 6: Tool cards and edit diffs

Goal: every tool call renders as a card. Edit calls show real diffs and write calls the file they wrote, rendered by @pierre/diffs in a worker pool.

Read first: `apps/web/src/components/DiffPanel.tsx`, `apps/web/src/components/chat/ChangedFilesTree.tsx`, `patches/@pierre%2Fdiffs@1.3.0-beta.10.patch`.

Build:
- Cards for pi's built-in tools (its settings docs list `read`, `bash`, `powershell`, `edit`, `write`, `grep`, `find` and `ls`) and a generic card for extension tools showing the name, arguments and result text.
- Live bash output from `tool_execution_update`.
- Cards start collapsed, and long output is virtualized.
- Diffs through the @pierre/diffs worker pool (`WorkerPoolManager`).

Gotchas:
- Whether `partialResult` replaces or extends earlier output depends on the tool. pi's own terminal UI replaces the result it shows with each one, and bash sends all of its output so far, at most every 100 ms. Tondo does the same.
- T3 patched @pierre/diffs so the virtualized height cache resets when the code width changes, which matters for wrapped lines. 1.5.1 still lacks the reset, but Tondo's code views don't wrap lines, so the patch isn't needed.
- Extensions' custom tool renderers don't exist over RPC, so their calls get the generic card. The README's known limits already say so.
- The CSP must allow the workers (`worker-src`). @pierre/diffs also colors code with style attributes and themes each diff with a `<style>` element, which `style-src 'self'` blocks, so styles may be inline since Stage 6.
- pi's write reports no diff: its result is only "Successfully wrote to <path>", and no event carries the file's old content. Its card shows the file it wrote, as pi's terminal UI does. Stage 9's panel shows each turn's before and after.
- pi runs a reply's tool calls at the same time and sends their result messages in call order, so a finished call's result can wait for a slower call before it. `tool_execution_end` carries the result as soon as the call ends.
- A worker hands its colored diff back in one message, and the page takes it in with one task that grows with the diff: about 90 ms for 5,000 lines a side on this Mac. Diffs get colors up to 2,500 lines a side, and bigger ones show uncolored.

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
- pi tells the client nothing when a dialog times out, or when its extension withdraws it with an AbortSignal, and it ignores answers to requests it no longer waits for. Tondo closes a timed dialog on its own timer, started when the request arrives. A withdrawn dialog stays open in Tondo, and answering it does nothing.
- pi answers a `prompt` that runs an extension command only after the command's handler returns, and the handler can wait on a dialog for as long as you take. With the 30 s command deadline, Tondo would report a failure and put the command back in the composer after it ran, so `prompt` and `compact` wait with no deadline.
- Extensions color text with pi's theme even over RPC, so a status can arrive as `\u001b[38;2;138;190;183mtext\u001b[39m`. Tondo strips terminal escapes from what it shows, and answers a select with pi's own option, escapes included.
- Extensions can start showing things as soon as pi starts, before pi answers its first command, so a thread keeps what they show from then on.
- pi's hidden llama.cpp extension registers `/llama`, so `get_commands` lists it even with `--no-extensions`. pi's terminal UI hides an extension command named like a built-in and runs the built-in, and Tondo does the same.
- `get_commands` lists every skill pi loaded, and a scratch `PI_CODING_AGENT_DIR` still loads skills from `~/.agents/skills`. Tests keep `--no-skills` and pass `--skill` paths, which load anyway.
- The page is denied every permission, so `navigator.clipboard.writeText` fails with NotAllowedError. `/copy` goes through main's clipboard.
- On this Mac, macOS refuses notifications from the unpackaged app, which runs as Electron: `show()` fails with "UNErrorDomain error 1". The packaged app is a different app to macOS, so Stage 13 checks notifications again. The e2e suite replaces `Notification.prototype.show`.
- While a native select's list is open on macOS, Playwright's input doesn't reach the page, so no e2e test opens the model picker.
- pi's `compaction_end` message already says what failed ("Compaction failed: …", "Auto-compaction failed: …"), and a failed `compact` sends that event before its error answer. `/compact` reports a failure once. pi's `compact` also aborts the run in progress first.

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

Verified in Stage 8:
- pi-tui 0.87.1 completes files as `@path ` or `@"path with spaces" `. Interactive submission forwards this text literally. CLI file expansion is separate, and RPC rejects CLI file arguments.
- pi's `clear_queue` and `queue_update` expose text only. You chose idle-only image sends on 2026-10-02. Text steering and follow-ups stay unchanged. Image RPC prompts omit `streamingBehavior`, so pi rejects a busy-state race rather than queueing attachments that Tondo couldn't recover.
- Image drafts stay saved until pi acknowledges the send. A separate SQLite table keeps them out of sidebar reads and text saves. Local built-ins and known extension commands leave images in the draft.
- Image bounds are 4 PNG/JPEG/GIF/WebP files, 5 MiB and 16 million pixels each, 10 MiB total. Previews use blob URLs, with no remote image access. File suggestions cap the index at 10,000 paths and show 20 matches; names with quotes, backslashes or line breaks are omitted.
- The editor uses T3's plain mode, not rich Markdown. Cursor-only changes and local draft echoes don't replace the document. Programmatic text replacement and clipboard paste get separate undo boundaries.

Done when: e2e covers IME composition not sending, a pasted image reaching pi (the faux provider records it), inserting a mention, a draft surviving a restart, and undo after programmatic edits.

Size: L. T3's composer, draft store and command menu are 11,598 lines.

### Stage 8 report, 2026-10-02

Implemented, uncommitted for review:
- TipTap 3.31.4 with literal Markdown and undo, per-thread drafts, prompt history, and the existing slash commands and keyboard controls.
- Host-backed file completion with request correlation, bounded Git scans and visible errors.
- Image paste, drop and picker, removable thumbnails, preview dialogs and transcript images. A new SQLite migration stores attachments separately. Image-only drafts survive thread switches and app restart. pi rejection restores the text and keeps the images.

Proofs:
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, build and `pnpm smoke` passed. React Compiler compiled 77 functions with no skipped functions.
- `pnpm test`: 362 tests in 39 files passed, including real-pi contracts for literal file paths, unchanged image bytes and rejection of busy image sends.
- `pnpm e2e`: all 50 tests passed. A real clipboard paste reached the faux provider as a 2x2 image with RGBA `[180, 80, 50, 255]`. Tests cover persistence, image-only sends, rejection recovery, command behavior and programmatic-edit undo. Editing a recalled prompt ends history browsing even after undoing the edit.
- `pnpm perf`: all 17 tests passed in 12.1 minutes. The final build ran on the built-in display at 2x and 120 Hz with the window visible. The approved temporary display-placement override was removed afterward; macOS settings stayed unchanged.
- The full tracked diff, new files and lockfile were reviewed. `git diff --check` passed.

Final performance medians, three runs per scenario:

| Metric | Result | Budget |
|---|---|---|
| Streaming frame p95, across both rates and 10 threads | 9.0 to 9.2 ms | 16.7 ms |
| Streaming frame p99 | 9.3 ms | 33 ms |
| Long tasks of 100 ms or more, normal speed | None | None |
| Input to paint p95, single thread / 10 threads | 32 / 24 ms | 32 ms |
| Switch to a running thread | 90 ms | 100 ms |
| Cold start | 306 ms | 1,000 ms |
| Total footprint before streaming, 1,000 / 200 tok/s | 277.5 / 273.5 MiB | 279.4 MiB |
| Total footprint after 1,000 tok/s | 503.6 MiB | 510.4 MiB |
| Total footprint after 200 tok/s | 501.3 MiB | 522.5 MiB |
| Port round trip p95 | 0.10 ms | Under 1 ms |

Memory passes narrowly. At 1,000 tok/s the before readings ranged from 275.0 to 280.6 MiB and the after readings from 503.4 to 519.7 MiB. One run crossed both limits; the plan gates their medians. The earlier pre-image checkpoint had a 514 MiB after median, which missed its limit despite 17 passing tests. The runner records memory but does not assert it, so these comparisons are manual. The lower final median is not evidence of a memory fix. Input latency is at its limit too. Full reports are in `.dev/perf/stage8-final-2026-10-02T16-38-43/`; [stack.md](stack.md#measurements) also records the 4x slowdown results.

Screenshots opened and checked:
- `test-results/composer.e2e.ts-Markdown-p-7acc7-ines-without-importing-HTML/markdown.png`
- `test-results/composer.e2e.ts--completio-2be0c-never-expands-file-contents/files.png`
- `test-results/images.e2e.ts-paste-a-real-c1814-t-and-send-its-pixels-to-pi/attached.png`
- `test-results/images.e2e.ts-paste-a-real-c1814-t-and-send-its-pixels-to-pi/preview.png`
- `test-results/images.e2e.ts-paste-a-real-c1814-t-and-send-its-pixels-to-pi/sent.png`
- `.dev/perf/stage8-final-2026-10-02T16-38-43/mid-stream-1.png` and `mid-stream-2.png`

Changes to the plan: images send only while idle, as approved above. File and slash completions insert literal text, following T3's plain mode. Attachments persist separately from the text draft rather than passing their bytes through each keystroke save.

Limits of verification:
- IME coverage tests browser composition-key guards, not an OS input-method session. Drop coverage dispatches a DOM drop event, not a native Finder drag. The clipboard paste and picker use real input paths.
- This verification ran on macOS. Linux CI awaits the approved PR. Maximum-size image attachments are bounded but are not part of the streaming performance scenarios.
- A host crash after pi accepts a prompt but before Tondo clears its saved images can leave those images in the draft. Inspect the transcript before retrying; this does not provide exactly-once delivery.
- One early full Electron run timed out on the existing sidebar-hover menu test. It passed 10 isolated repetitions and later full runs without a patch. The cause remains unknown.

Proposed commits after approval:
1. `feat(composer): add Markdown editing and prompt history`
2. `feat(composer): complete project file mentions`
3. `feat(composer): persist and send image attachments`
4. `docs: record stage 8 verification`

Next: wait for your review. After approval and landing, read T3's checkpoint implementation and verify its Git behavior for Stage 9.

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

### Stage 9 report, 2026-10-02

Implemented in draft [PR #14](https://github.com/Akshay-patel7/tondo/pull/14). The initial report below records the memory failure. The [memory follow-up](#stage-9-memory-follow-up-2026-10-02) passes the unchanged budgets. Stage 9 awaits review.

Implemented:
- A baseline before the prompt RPC and a completion after `agent_settled`. Steering, retries and queued follow-ups share one turn. Escape can cancel a prompt while its baseline is being captured.
- Hidden refs through a copied, private index. Captures leave HEAD and the real index alone, disable fsmonitor, use durable object/ref writes and do not need a user identity or run commit hooks. Git processes and their filters are tracked for cleanup after a host crash.
- Sparse-index handling, embedded-repository exclusion, linked worktrees, bounded Git output and commands, and explicit errors rather than invented HEAD baselines.
- Persisted turn states and reasons. Reopening preserves completed diffs; a host crash leaves unfinished turns unavailable. Thread/project removal deletes only the affected threads' refs.
- A Changes button, turn selector, filterable changed-files tree and the existing lazy diff renderer. The panel explains pending, binary, metadata-only, empty and non-Git results. The protocol is version 7.

Proofs:
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, build and `pnpm smoke` passed. React Compiler compiled 82 functions without skips. The final smoke run reached renderer readiness in 283 ms. `git diff --check` passed, and temporary follow tracing is absent from the source and built app.
- `pnpm test`: 388 tests in 41 files passed. Generated repositories cover edits, additions, deletions, renames, binaries, symlinks, sparse modes, manual index flags, same-size writes, unusual paths, embedded repositories, the patch cap and ref cleanup. Killing capture with SIGKILL leaves a clean `git fsck` and the real index intact; a subsequent capture succeeds.
- `pnpm e2e`: 55 tests passed in 2.2 minutes. Faux pi edits real files; tests select files and turns, filter paths, toggle folders by keyboard, reload, restart the host, remove the project, cancel baseline preparation and kill the host during a blocked Git clean filter. Steering/follow-ups share one turn, and an aborted turn retains its edits.
- `pnpm bench` passed. The reducer processed 24.0 million events/s on the 1,000-message transcript. Listing 500 unchanged sessions took 2.2 ms; the first read took 15.4 ms.
- `pnpm perf`: 17 automated tests passed in 12.0 minutes on the built-in display at 2x and 120 Hz. This is not an all-budget pass: the runner records memory without asserting its limit.

Initial controlled performance medians, three runs per scenario:

| Metric | Result | Budget | Outcome |
|---|---|---|---|
| Streaming frame p95 / p99, both rates and 10 threads | 9.2 / 9.3 ms | 16.7 / 33 ms | Pass |
| Normal-speed long tasks of 100 ms or more | None | None | Pass |
| Input to paint p95, 1,000 / 200 tok/s / 10 threads | 32 / 24 / 24 ms | 32 ms | Pass |
| Time behind the end, 1,000 / 200 tok/s / 10 threads | 24 / 16.6 / 27.9 ms | 100 ms | Pass |
| Switch to a running thread | 90.5 ms | 100 ms | Pass |
| Cold start | 235 ms | 1,000 ms | Pass |
| Total footprint before 1,000 tok/s | 281.77 MiB | 279.4 MiB | Fail |
| Total footprint after 1,000 tok/s | 510.44 MiB | 510.4 MiB | Fail |
| Total footprint before / after 200 tok/s | 276.68 / 497.98 MiB | 279.4 / 522.5 MiB | Pass |
| Port round trip p95 | 0.10 ms | Under 1 ms | Pass |

The 1,000 tok/s before readings were 281.83, 274.30 and 281.77 MiB; after readings were 518.10, 510.44 and 507.19 MiB. Both medians exceeded their limits. The small after miss was still a miss. No memory A/B had yet established whether Stage 9 caused the increase. Reports are in `.dev/perf/stage9-controlled-2026-10-02T21-58-26/`; [stack.md](stack.md#measurements) also records the diff and 4x slowdown results.

The first full run, `.dev/perf/stage9-2026-10-02T21-16-02/`, passed its medians but recorded an 87.5-second follow-scroll outlier. You confirmed interacting with Tondo during that run, so it is not the controlled acceptance result. Five traced runs on main and six on Stage 9 all kept following, with maximum lag of 20.5 ms. The subsequent uninstrumented full run did not reproduce the outlier. The original run did not record input events, so interaction is a possible explanation, not a proven root cause. All temporary tracing was removed; the follow-scroll code is unchanged.

Screenshots opened and checked:
- `test-results/checkpoints.e2e.ts-faux-pi-233c8-ost-restart-and-page-reload/turn-diff.png`
- `test-results/checkpoints.e2e.ts-a-non-G-ae5b2--why-the-panel-has-no-diffs/non-git.png`
- `.dev/perf/stage9-controlled-2026-10-02T21-58-26/mid-stream-1.png` and `mid-stream-2.png`

Limits of verification and behavior:
- The performance budgets are measured on macOS. PR #14 runs functional CI on macOS and Ubuntu.
- The performance suite exercises the shared diff renderer, not checkpoint latency on a very large checkout.
- Checkpoints cover the whole checkout, including outside edits and other threads' work. A turn reuses the prior completion as its baseline, so edits between prompts can appear too. The panel warns about shared edits; worktree isolation remains Stage 11.
- A crash can leave private temporary-index directories or unreachable Git objects. Ref deletion does not run Git garbage collection.

### Stage 9 memory follow-up, 2026-10-02

The approved investigation reproduced a before-stream miss on main too, at 279.97 MiB over three runs. It did not establish a checkpoint-specific regression. Two existing sources of memory use were reduced:

- The empty-state prompt/button and composer now have small compositor layers. DevTools confirmed their separate layers; `vmmap` showed that the empty state no longer allocates the three 2432×416 raster tiles seen in the original build.
- A pnpm patch makes `@streamdown/code` share highlighters by theme pair and retain at most 128 highlighted results. The original plugin retained 452 results during one reply; clearing its cache released about 4.8 MiB. Evicted results are recomputed on demand. Four tests cover eviction/recomputation, concurrent languages and aliases, unknown fences and separate theme pairs.

The unchanged PR build and the fix each ran the 1,000 tok/s case twelve times in alternating blocks, on the built-in 2x/120 Hz display. Total before-stream memory fell from 276.44 to 266.92 MiB; the GPU accounted for 8.96 MiB of that reduction. After-stream renderer memory fell from 176.45 to 172.89 MiB. Total after-stream memory fell from 506.92 to 504.57 MiB, but that smaller difference is inconclusive, with a two-sided permutation p of 0.083. [stack.md](stack.md#stage-9-memory-follow-up) records the ranges and individual samples.

After removing all measurement instrumentation, the unchanged full suite passed 17 tests in 12.5 minutes. Medians of three runs:

| Metric | Result | Fixed budget |
|---|---|---|
| Total footprint before / after 1,000 tok/s | 266.24 / 505.63 MiB | 279.4 / 510.4 MiB |
| Total footprint before / after 200 tok/s | 266.65 / 485.65 MiB | 279.4 / 522.5 MiB |
| Frame p95 / p99, worst normal-speed scenario | 10.1 / 10.3 ms | 16.7 / 33 ms |
| Input to paint p95, all normal-speed scenarios | 32 ms | 32 ms |
| Longest time behind the end, worst scenario median | 19.5 ms | 100 ms |
| Switch to a running thread | 89.6 ms | 100 ms |
| Cold start | 241 ms | 1,000 ms |

The memory comparison used unrounded values. Every individual single-thread memory reading passed too. Input remains at its limit, and the after-1,000-tok/s median has only 4.77 MiB of headroom. No normal-speed task exceeded 50 ms. Full reports and screenshots are in `.dev/perf/stage9-memory-2026-10-02T23-37-51-876Z/`; diagnostic results are in `.dev/stage9-memory/`.

Final local checks passed: frozen install, typecheck, lint, format check, 392 unit/contract tests in 42 files, both benchmark suites, build, smoke and 55 Electron tests. React Compiler compiled 82 functions without skips; smoke reached renderer readiness in 265 ms. The new cache test initially required identical internal Shiki state after recomputation. That assertion was too strict under CPU load; it now checks eviction, source and theme without depending on timing-sensitive token scopes. The rebuilt production files match the measured build byte for byte.

Opened and checked the new empty-window, file-completion, turn-diff and both mid-stream screenshots. The layer probes recorded no page or console errors. Checkpoint behavior and the limits above are unchanged. The PR records fresh-clone and platform CI checks for the pushed commits.

Next: review PR #14. It remains a draft; nothing has been merged, and Stage 10 has not started.

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
- Shared history caps of 50,000 lines or 32 MiB for host retention and renderer replay. xterm also bounds scrollback by line count and a four-byte-cell text budget. Terminal query and response traffic gets stripped from kept history.
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

### Stage 10 report (2026-10-03)

Shipped:

- One host-owned PTY per thread, with its project folder, captured environment and `TERM=xterm-256color`. xterm and node-pty load only when needed. Switching threads detaches the view without stopping the shell; page reload replays its history.
- A drawer resized by dragging or the keyboard, with WebGL and a tested DOM fallback. Terminal output bypasses React. The host pauses the PTY at its 64 KiB acknowledgement window; the renderer acknowledges each parsed chunk.
- Host history capped at 5,000 lines or 8 MiB. Replay to a renderer is capped at 512 KiB, and xterm scrollback has a corresponding four-byte-cell text budget. These are text limits, not a 512 KiB cap on xterm's cell and GPU allocations. A stateful filter removes terminal queries, replies and control strings from retained history.
- Close and normal app quit capture descendant job-control groups before stopping the shell, then escalate from TERM to KILL. Main retains reported groups as a fallback if the host dies.
- Provider sign-in in a separate interactive pi with `--no-session`. `/login` and `/logout` in the composer open that drawer. The user runs the command there, then chooses Refresh models while the chat pi is idle. Other running threads need `/reload` too.
- Exact dependency versions, node-pty's build permission, and an install-time macOS helper permission fix. Main still loads no native module; the CSP is unchanged.

Verify-first results:

- node-pty 1.1.0 spawned a shell in Electron 44.4.5's utility process and changed `stty size` from 24×80 to 40×100 without a native rebuild. A fresh macOS install also ran a PTY successfully. Linux compiled node-pty with Python, make and g++.
- xterm 6.0.0, Fit 0.11.0 and WebGL 0.19.0 ran under the production CSP. E2E also forces WebGL unavailable and runs a real command through the DOM fallback.
- An isolated pi 0.87.1 RPC process reported zero authenticated Anthropic models both before and after an external synthetic credential write, then 15 after restart. Tondo therefore offers an explicit refresh instead of silently restarting active threads. The interactive-login E2E proves the refresh exposes Claude after saving a synthetic API key.

Proofs:

| Check | Observed result |
|---|---|
| Fresh install | macOS helper mode 0755; real PTY ran and exited 0. Linux native build succeeded. |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | Pass |
| `pnpm test` | 437 tests in 45 files pass |
| Build and `pnpm smoke` | Pass; 84 React functions compiled |
| `pnpm e2e` | 60 pass on the final macOS run |
| Focused Linux E2E under Ubuntu 24.04 / OrbStack | All 14 terminal, slash-command and window-security tests pass |
| Close and quit | Shell and background-job groups empty after Close; quit also kills a separate job group that ignores HUP and TERM |

An earlier macOS run hit the existing image-only-send-after-Stop race. An unchanged `main` build at `5de2191` reproduced the same error in 4 of 10 focused runs: "Wait for pi to finish before sending images." No image-send code or test was changed. A later full run passed, but that does not resolve the race. Logs are in `.dev/stage10/main-images.log`.

Screenshots opened and checked: `test-results/terminal.png` and `test-results/terminal-login.png`. The close test also writes `terminal-processes.txt` in its Playwright result folder, with both groups present before Close and none afterward.

Perf vs budgets: the full approved run passed all 18 checks in 13.0 minutes on the built-in 2×/120 Hz display. Reports are in `.dev/perf/2026-10-03T01-56-03/`. Screenshot review then exposed 5 px of terminal clipping: FitAddon counted padding on its mount as cell space. Moving that padding outside the measured mount fixed it. The final macOS and Linux suites pass the new geometry assertion, and the terminal performance rerun passes in `.dev/perf/2026-10-03T02-16-20/`.

| Metric | Budget | Observed result |
|---|---|---|
| 50 MiB terminal output, tasks ≥100 ms | None | 0 in all three native runs; 0 at 4× too |
| 50 MiB terminal output, elapsed | Informational | 1.893 s median, samples 1.910 / 1.886 / 1.893 s; 8.141 s at 4× |
| Streaming frame p95 / p99 | ≤16.7 / ≤33 ms | 10.0–10.1 / 10.3 ms across the native scenarios |
| Streaming input-to-paint p95 | ≤32 ms | 32 ms |
| Long tasks ≥100 ms, native streaming and diffs | None | 0 |
| Switch to a running thread | ≤100 ms | 91 ms |
| Cold start | ≤1 s | 240 ms |
| Page/host round-trip p95 | <1 ms | 0.10 ms |
| Memory medians | Stage 1 baseline +10% | Pass; single-thread total before/after 267/507 MiB at 1,000 tok/s and 270/490 MiB at 200 tok/s |

The terminal rerun's `terminal-1x.png` was opened and checked too; the completion marker and shell prompt are fully visible. The informational 4× colored-diff run had one 229 ms task. Input latency is still at its budget, and the 1,000 tok/s memory median remains close to its limit.

Changes to the plan: the hardware-dependent 50 MiB gate lives in `pnpm perf`, not CI's E2E suite. No performance budget or CSP rule changed. Provider refresh is explicit because running pi processes did not notice an external credential write.

Not verified: a real provider OAuth login or a paid model request. The login test uses a synthetic API key in a temporary profile. Full Linux regression and x64 Linux CI remain for the PR. Forced-host-crash cleanup of separate terminal job-control groups is not covered; normal Close and app quit are covered. Packaging must still unpack node-pty from asar and remove other architectures' prebuilds in Stage 13.

Proposed commits:

- `feat(terminal): add host-owned PTY sessions`
- `feat(terminal): add resizable drawers and provider sign-in`
- `test(terminal): gate output throughput and record stage results`

Next: after this stage is approved and merged, start Stage 11 by reading T3's Git action and worktree code at the pinned commit.

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

### Stage 11 report (2026-10-03)

The original build failed its memory budget. This report preserves that result. PR #16 merged, then the user authorized a [CI and memory follow-up](#stage-11-ci-and-memory-follow-up-2026-10-03), including its PR and merge. The follow-up passes the unchanged budgets.

#### Implemented

- A Git toolbar with local branch selection, branch creation, per-thread worktrees, stage-all-and-commit, push, and PR create/status/browser links. Each write needs an explicit action. PR creation requires an already-pushed branch and never pushes implicitly.
- Host-only Git and `gh` commands through the login-shell environment, without a shell command string. Requests carry thread IDs and bounded action fields, never repository paths. Commands have a 60-second deadline and 4 MiB output cap. Main tracks their process groups, including hooks and helpers.
- Visible-checkout status polling every two seconds with `GIT_OPTIONAL_LOCKS=0` and filesystem-monitor hooks disabled for status. Unchanged results are not resent. GitHub status is cached for 30 seconds; refresh and writes invalidate it. Reads finish before writes so an older PR poll cannot overwrite a newly created PR.
- A SQLite ownership ledger and worktrees under `<userData>/worktrees/<thread-id>`. A new worktree starts a new thread rather than moving an existing session. pi, terminals, file completion, session discovery and turn checkpoints all use that checkout.
- Branch writes are blocked during active turns in the same checkout, including background threads. Open terminals block branch changes even after the pool stops their pi. New prompts during a Git action are restored to the draft with an error instead of racing the operation.
- Removal preserves branches and external pi session files. Dirty or ignored files require explicit force confirmation. A session inside the worktree blocks removal. Failed removal preserves checkpoints and does not stop pi when preflight already finds the problem. Startup cleanup inspects only recorded worktrees whose owning thread is gone, and preserves changed branches, dirty/ignored files, symlinks and folders used by projects.

#### Proofs

Commands ran on macOS. Logs are in `.dev/stage11/`.

| Check | Observed result |
|---|---|
| `pnpm typecheck` | Exit 0 |
| `pnpm lint` | Exit 0, warnings forbidden |
| `pnpm format:check` | All 209 matched files passed |
| `pnpm test` | 49 files, 456 tests passed |
| `pnpm build` | Exit 0; React Compiler compiled 87 functions |
| `pnpm smoke` | Passed; renderer ready in 271 ms |
| `pnpm exec playwright test` | 64 passed in 3.0 minutes |
| Git e2e, repeated three times | 12 passed in 49.8 seconds |
| Final `pnpm perf` | 18 automated checks passed in 13.0 minutes; manual memory check failed |

Generated repositories and bare remotes prove non-forced branch switching, literal commit messages, staged/untracked changes, push, stale-branch rejection, unchanged index bytes during status, detached HEAD, non-repositories and worktree cleanup. A recording `gh` stub proves the Enterprise hostname, explicit repository/head/base/title arguments, PR body on stdin, missing CLI and logged-out behavior. A subprocess test exceeds the output cap with a child helper and verifies the group is gone.

The whole-app test runs real pi offline. Its bash tool prints the worktree path, and its session header records that path in a separate session folder. The test checks worktree-only file completion, turn diffs, terminal cwd, separate commits, explicit push, PR creation through the stub, browser URL, page reload and cold restart. Refused removal keeps ignored files and checkpoint refs. Confirmed removal keeps the branch and external session. The pooled-terminal regression failed against the earlier build and passed after the guard checked stored threads rather than only live pi processes.

#### Screenshots

Both were opened and inspected after the final functional run:

- `test-results/git-worktree-pr.png`: the worktree branch, explicit action results and PR link.
- `test-results/git-safe-removal.png`: the removal dialog, separate destructive checkbox and refusal for ignored files.

#### Perf vs budgets

Final artifacts: `.dev/perf/stage11-final-2026-10-03T04-16-58/`. The visible window passed the unchanged built-in 2x/120 Hz display guard. No placement override or timing wait was added. Values are medians of three runs unless noted.

| Metric | Budget | Final result |
|---|---|---|
| Frame p95 / p99, 1,000 tok/s | 16.7 / 33 ms | 10.1 / 10.3 ms |
| Frame p95 / p99, 200 tok/s and 10 streaming threads | 16.7 / 33 ms | 10.0 / 10.3 ms |
| Input-to-paint p95 | 32 ms | 32 ms in all three scenarios |
| Long tasks at normal speed | None at least 100 ms | None in streaming, diffs or terminal output |
| Switch to running thread | 100 ms | 89.4 ms |
| Cold start | 1 second | 250.6 ms |
| Total before streaming, 1,000 / 200 tok/s | 279.4 MiB | 269.912 / 273.037 MiB |
| Total after 1,000 tok/s | 510.4 MiB | **511.506 MiB, fail** |
| Total after 200 tok/s | 522.5 MiB | 497.600 MiB |
| Terminal output | No task at least 100 ms | 50 MiB in 1.893 seconds, no long tasks |
| Port round trip p95 | Under 1 ms | 0.10 ms |

The three after-1,000-tok/s readings were 521.584, 510.803 and 511.506 MiB. All exceed 510.4 MiB; the median exceeds it by 1.106 MiB. The automated runner records memory but does not assert its budget. Its green result is not an all-budget pass.

The earlier run, `.dev/perf/stage11-2026-10-03T03-45-37/`, passed with 272.459 MiB before and 508.038 MiB after at 1,000 tok/s. It preceded the final cleanup and terminal-guard fixes, so it does not replace the final result. There is no controlled A/B against main yet and no evidence attributing the excess to those fixes. The stage stops here without lowering a limit or rerunning until a favorable number appears. Further measurements need approval.

#### Changes to the plan

- Worktree mode is chosen by creating a new thread. Existing sessions are not silently moved.
- "Abandoned" means a recorded worktree without a stored owner. Archiving or leaving a thread empty is not consent to delete its checkout.
- PR creation, push and commit remain separate confirmations. Selective staging, fetch, pull, merge and force-push UI are not included.
- No dependencies or performance budgets changed.

#### Not verified

- Linux execution and GitHub CI were not checked before this report. The draft PR's checks are reported separately.
- Live GitHub or Enterprise writes, real credentials, signing prompts, and arbitrary third-party hooks. Git/PR writes in tests stayed in generated repositories or the stub.
- Large-repository checkout durations, unusual fork/multi-URL remote setups, and protection against concurrent writes by external editors or shells.
- The cause of the memory miss. A controlled comparison with main is the next step, not an assumed Git-specific fix.

#### Draft review commit split

1. `docs: mark stage 10 done`
2. `feat(git): add checked git actions and pull request status`
3. `feat(worktrees): isolate thread checkouts and preserve owned files`
4. `feat(git): add branch toolbar and action confirmations`
5. `test(git): verify isolated checkouts and explicit publishing`
6. `docs: record stage 11 results`

### Stage 11 CI and memory follow-up, 2026-10-03

The follow-up fixes CI failures, image admission after Stop and terminal shutdown. It also removes an existing GPU memory cost in Markdown rendering.

- On macOS, a helper can have exited while its PID still awaits reaping. The zombie answers `kill(pid, 0)` even though its process group has stopped. The process tests now poll for PID disappearance, and the zombie test asserts this difference. The focused suites passed twenty consecutive runs.
- A Git test mistook the previous thread's visible Model picker for the new thread's readiness. It now waits for the target heading before waiting for pi. The unchanged Linux build failed 3 of 40 Git cases; the readiness fix passed 40 of 40. Forty repeated macOS Git cases passed too. No guard assertion or timeout was weakened.
- After Stop, the composer can become idle while the completion checkpoint is still saving files. The host rejected an image in that interval. A deterministic test holds a real Git clean filter open and reproduced the rejection with every busy flag false except checkpoint work. Image prompts now wait through the existing checkpoint-preparation path. Active pi work, queued prompts and pending sends still block them. The pool and Git actions retain the full busy guard. The deterministic case and the original image test passed 24 repeated runs after the fix.
- Markdown code-action controls now use an opaque theme background instead of backdrop blur. Twelve interleaved runs per build lowered median total memory after streaming from 509.780 to 460.670 MiB. GPU footprint accounts for most of the reduction. [stack.md](stack.md#stage-11-ci-and-memory-follow-up) records the samples and attribution. The memory runner now asserts the existing limits on unrounded medians; replaying the original failed result correctly fails the new assertion.

The first macOS checks passed typecheck, lint, formatting, 456 unit tests in 49 files, build and smoke. Smoke reported 285 ms to renderer readiness. Full E2E passed 66 tests in 3.2 minutes after the image fix; the earlier full run's image failure is retained in `.dev/stage11-fix/root-e2e.log`. Code-control screenshots in both themes were opened and inspected, and the test clicks Copy and checks its exact text without changing the user's clipboard.

Fresh-clone verification then caught a queue test using the Stop button as proof that pi was running. Stop also appears during checkpoint preparation. The steering and queue-recall tests now wait for the tool's running state before sending queued prompts; sixty focused repetitions passed. This changes tests only, not the measured application. The first clone's 65-pass/1-fail E2E log is retained in `.dev/stage11-fix/landing/tip-e2e.log`.

The first PR #17 CI run passed all 66 E2E tests on Ubuntu but left a closed provider-sign-in terminal visible on macOS. The PTY's exit event can arrive after process-group cleanup and session removal; publishing that late event reopened the drawer with `Exited (0)`. New unit tests force that ordering for both removed and replaced sessions and failed before the fix. Terminal state now publishes only while the same session is still registered. A naturally exited terminal still retains its output until explicitly closed.

After the terminal fix, every code commit passed frozen install, typecheck, lint, formatting, unit tests and build in a fresh clone. The tip passed 459 unit tests in 49 files, benchmarks, smoke, all 66 E2E tests and twenty repeated provider sign-ins. Local Ubuntu 24.04 arm64 passed 456 unit tests with three platform skips, smoke and all 66 E2E tests. Both jobs in [CI run 37108556803](https://github.com/Akshay-patel7/tondo/actions/runs/37108556803) passed too. Logs and screenshots are retained in `.dev/stage11-fix/`.

The initial full performance run passed 18 checks in 13.0 minutes, including the new memory assertions. Its after-stream medians were 461.866 MiB at 1,000 tok/s and 440.709 MiB at 200 tok/s. Artifacts remain in `.dev/perf/stage11-ci-memory-2026-10-03T07-00-41-978Z/`.

The build with the terminal fix passed another full 18-check performance run in 13.0 minutes. It used the built-in 2x/120 Hz display, the original measurement helper and no placement override. The final artifacts are in `.dev/perf/stage11-ci-terminal-2026-10-03T08-17-19-796Z/`.

| Metric | Unchanged limit | Final median |
|---|---|---|
| Total before, 1,000 / 200 tok/s | 279.4 MiB | 270.881 / 272.256 MiB |
| Total after 1,000 tok/s | 510.4 MiB | 461.178 MiB |
| Total after 200 tok/s | 522.5 MiB | 439.475 MiB |
| Frame p95 / p99, 1,000 tok/s | 16.7 / 33 ms | 10.1 / 10.3 ms |
| Frame p95 / p99, 200 tok/s and ten streaming threads | 16.7 / 33 ms | 10.0 / 10.3 ms |
| Input p95, single-thread / ten-thread cases | 32 ms | 32 / 32 ms |
| Switch to a running thread | 100 ms | 90.3 ms |
| Cold start | 1,000 ms | 241.1 ms |
| Normal-speed tasks at least 100 ms | None | None in streaming, diffs or terminal output |
| Terminal output | No task at least 100 ms | 50 MiB in 1.892 seconds |
| Port round-trip p95 | Under 1 ms | 0.10 ms |

The raw memory medians pass, and every individual single-thread reading passes too. The after-1,000-tok/s readings were 473.100, 455.475 and 461.178 MiB. Input latency is at its limit in all three cases. At informational 4x slowdown, the colored diff had one 221 ms task. Both final mid-stream screenshots, the normal-speed terminal screenshot and the closed sign-in drawer screenshot were opened and inspected.

The earlier macOS create-worktree dialog timeout did not recur in the forty repeated Git cases; its specific cause remains unproven. Live GitHub writes, real credentials, arbitrary hooks and unusual remote layouts remain outside the generated-repository tests. No dependencies, safety policy or performance limits changed. Stage 12 remains unstarted.

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

### Stage 12 report (2026-10-10)

You went to bed at the start of the stage and said "Go with your recommendation." So I made every open call myself, as in Stage 5. Each one is listed under Changes to the plan below, with its reason. Nothing is committed.

#### Shipped

- **Components.** `src/renderer/ui` holds 25 components: alert, alert-dialog, badge, button, checkbox, combobox, context-menu, dialog, dropdown-menu, empty, input, kbd, label, number-field, popover, scroll-area, select, separator, sheet, spinner, switch, textarea, toggle, toggle-group and tooltip. They come from shadcn 4.21.4's `base-nova` style on Base UI 1.8.0, with `cn` in `src/renderer/lib/cn.ts`. Icons are lucide's. The old `ui/IconButton.tsx`, `ui/Menu.tsx` and `ui/icons.tsx` are deleted, and every screen uses the new components.
- **Tokens.** The Warm tokens in `src/renderer/index.css` gained popover, card-foreground, secondary, input, success, info, warning-foreground and control-border. The focus ring is an outline. Reduced motion turns transitions and animations off, and switching themes suppresses transitions (544 transitions on a switch before, 0 after).
- **No restyling.** The `tondo/no-restyle` lint rule (`scripts/lint/no-restyle.mjs`) fails any class on a ui component outside `src/renderer/ui` unless it's layout, and any className it can't read statically.
- **Themes.** Settings offers System, Light and Dark. Main applies the choice through `nativeTheme.themeSource`, so `prefers-color-scheme` follows it. The terminal and the code views follow the theme too. Before, the terminal stayed dark in light mode. In light mode xterm's minimum contrast ratio is 4.5.
- **Onboarding**, shown where each problem happens:
  - pi not found: the setup card "pi isn't installed".
  - pi too old: "Tondo needs a newer pi", naming both versions.
  - Both cards offer Open settings, Choose pi… and Check again.
  - No provider credentials: the model picker reads "No model" instead of `unknown/unknown`. A "Sign in to a provider" prompt opens the sign-in terminal, and closing that terminal starts a new pi.
  - Project trust: the prompt is on the same card, with focus on "Don't trust".
  - First launch: "Welcome to Tondo" leads to Add project… and says which pi it found.
- **Settings page.** It replaces the main area and opens with ⌘, (Ctrl+, on Linux), the palette, `/settings`, or the gear in the sidebar. Escape or Back returns. It has four sections:
  - Appearance: the theme.
  - pi: version, source and path, with Choose pi…, Use pi from PATH and Check again, plus pi's global and project settings files with Show in Finder.
  - Threads: how many pi processes run at once (1 to 12, default 4) and the idle minutes before a hidden thread's pi stops (1 to 240, default 10). Changes apply live.
  - Shortcuts: the seven app commands can be rebound. Settings refuses conflicts, and each command has Turn off and Reset. The composer and dialog keys are listed as fixed.
- **Saved settings.** They live in `<userData>/settings.json`. The host checks and saves every change and keeps keys it doesn't know. Pool limits apply in order: defaults, then settings, then `TONDO_POOL` in unpackaged runs. The protocol is version 10.
- **Keyboard and screen readers.**
  - The sidebar list is one Tab stop: arrows, Home and End move, Enter or Space opens, and Shift+F10 opens a row's menu. Removing a project asks in an alert dialog.
  - The Git toolbar is one Tab stop that the arrows, Home and End move through.
  - The transcript is a focusable region with a "Jump to latest" button.
  - Escape closes the diff panel and focus goes back to Changes. Closing the terminal by any route returns focus to its opener, or to the composer.
  - The palette opens and closes the terminal.
  - Icon buttons have tooltips, which show the button's key when it has one. The accessibility audit below finds no control without a name.
- **Status.** The sidebar's error status is a CircleAlert glyph. A red dot was too close in hue to the terracotta "working" dot. Reconnecting… is a warning badge.

#### Keyboard-only walkthrough

`e2e/keyboard.e2e.ts` walks one thread with the keyboard alone. It starts with real pi offline and a generated Git project. After every move it asserts where focus is, and that the focused element matches `:focus-visible` and draws an outline, a ring or a menu highlight. The composer shows focus as a card border in the ring color, and the terminal as xterm's focused cursor. The screenshots are in `.dev/stage12/keyboard/`. Keys are macOS's. On Linux, Ctrl takes ⌘'s place.

| Step | Keys | Focus lands on | Screenshot |
|---|---|---|---|
| 1 | ⌘K, type "Add project" | The palette's Search box, with Add project selected | `01-palette-add-project.png` |
| 2 | Enter, Shift+Tab until the composer, type a prompt | The composer of the new thread (main answers the folder dialog) | `02-composer.png` |
| 3 | Enter, then Shift+Tab once the reply has landed | The Transcript region | `03-transcript.png` |
| 4 | PageUp, then Tab | Jump to latest, which appears once the view leaves the end | `04-jump-to-latest.png` |
| 5 | Enter, PageUp, End | Back on the transcript, at the end, with Jump to latest hidden | none |
| 6 | Shift+Tab until Changes, Enter | Changes, pressed, with the Turn changes panel open | `05-changes-open.png` |
| 7 | Tab until Close changes | The panel's Close changes button | `06-diff-panel.png` |
| 8 | Escape | Changes again, with the panel gone | none |
| 9 | Tab until the Git toolbar | The Git branch picker | `07-git-toolbar.png` |
| 10 | →, →, ←, End | New branch, New worktree, New branch, then Refresh Git | `08-git-toolbar-end.png` |
| 11 | Home, then Tab | The branch picker, then out of the toolbar in one press | none |
| 12 | Shift+Tab until the thread list | The thread row | `09-sidebar-row.png` |
| 13 | ↑, ↓, Home, End | The project header, the row, the header, the row | none |
| 14 | Home, Tab until Project actions, Enter | The first item of the Project actions menu | `10-project-actions.png` |
| 15 | Escape, Shift+Tab, Shift+F10, Escape | Project actions, the project header, the first item of the header's menu, the header | none |
| 16 | ↓, Enter, Shift+F10 | The open thread's row, then the first item of Thread actions | `11-thread-actions.png` |
| 17 | Escape, then ⌘, | The row, then the Settings page's heading | `12-settings.png` |
| 18 | Tab until the theme, → until Dark, Enter | Dark, pressed, with the app in dark mode | `13-settings-dark.png` |
| 19 | Escape | The thread row, with Settings closed | none |
| 20 | ⌘K, type "Terminal" | The palette's Search box, with Open terminal selected | `14-palette-terminal.png` |
| 21 | Enter, type `echo kb`, Enter | The terminal, which prints `kb` | `15-terminal.png` |
| 22 | Shift+Tab until Close terminal | Close terminal | `16-close-terminal.png` |
| 23 | Shift+Tab | The Resize terminal separator, with its grip shown | `17-resize-separator.png` |
| 24 | Tab, Enter | Close terminal, which closes the drawer | none |

The same file's audit reads Chromium's accessibility tree in 14 states and finds no control without a name. The states are first launch, a thread with an open tool card, the palette, both sidebar menus, each Settings section, the diff panel, the terminal, Create branch, and both Git alert dialogs.

#### Proofs

macOS logs are `.dev/stage12/logs/final-*.log`. The Linux run is `.dev/stage12/logs/linux-final.log`, with each step's log in `logs/linux-final/`, from `.dev/linux/run-tree.sh` in the local Ubuntu container. That's arm64, with Node 24.15.0, pnpm 12.6.0 and Electron 44.4.5, cloned at HEAD 146e880 plus 113 changed paths. Both ran on the final tree, with the memory fix, the narrow-column fix and the parse cache.

| Check | macOS | Linux |
|---|---|---|
| `pnpm install` | not rerun | exit 0 |
| `pnpm typecheck` | no errors, 7 projects | not run by run-tree |
| `pnpm lint` | no errors, warnings forbidden | not run by run-tree |
| `pnpm format:check` | "All matched files use the correct format." 251 files | not run by run-tree |
| `pnpm test` | 51 files, 555 tests passed | exit 0, 51 files: 552 passed, and 3 macOS-only tests skipped |
| `pnpm build` | passed inside smoke | exit 0 |
| `pnpm smoke` | "Smoke test passed. The renderer was ready 255 ms after launch." | exit 0, ready 472 ms after launch |
| `pnpm e2e` | 80 passed (3.8m) | 80 passed (3.6m) |
| `keyboard.e2e.ts --repeat-each 3` | 6 passed (38.5s) | 6 passed (36.6s) |

Run 2 had 66 e2e tests. Run 3 added settings (5), onboarding (5) and keyboard checks, and the terminal focus fix added one more. `e2e/window.e2e.ts` passes in both runs, and `src/main/securityPolicy.ts` is unchanged.

Planted restyle. With `src/renderer/zz-restyle-probe.tsx` rendering `<Button className="bg-red-500"/>`, `pnpm lint` failed (`final-lint-probe.log`):

```
src/renderer/zz-restyle-probe.tsx:1:80: error tondo(no-restyle): "bg-red-500" is not allowed on <Button>: ui components own their look. Pick a variant or size, or put the class on a parent element.
[ELIFECYCLE] Command failed with exit code 1.
```

With the probe deleted, the same command passed (`final-lint-clean.log`). Run 4 got the same pair (`run4-lint-probe-fail.log`, `run4-lint-probe-pass.log`).

The React Compiler compiled 168 functions, and the build reported none unoptimized (`final-smoke.log`: "React Compiler compiled 168 functions.").

Other proofs, from the stage's runs:

- **Settings** (`e2e/settings.e2e.ts`, 5 tests):
  - Light and Dark follow `matchMedia` and land in settings.json, Dark survives a relaunch, and System saves as `"system"`.
  - A pool of 1 stops the hidden idle thread's pi at once.
  - Settings refuses Mod+B, a key another command already has. After rebinding the palette to Mod+P, Mod+P opens the palette and Mod+K doesn't. Reset brings Mod+K back.
  - Choose pi… saves the path and shows the version.
  - Show in Finder reveals pi's global settings file.
- **Onboarding** (`e2e/onboarding.e2e.ts`, 5 tests):
  - A pi path of `/nonexistent` shows "pi isn't installed", and Choose pi… then starts pi.
  - A fake pi 0.80.0 shows "Tondo needs a newer pi" with 0.80.0 and 0.87.1.
  - Without the faux provider, Open sign-in terminal opens the "Provider sign-in" terminal, and closing it starts a new pi.
  - Trust, and the welcome's pi line and its Choose pi….
- **Terminal focus** (`e2e/terminal.e2e.ts:200`). Before the fix it failed at line 219 on both systems, with focus on the page (`linux-term-prefix.log` on Linux). After the fix it passed 18 of 18 on macOS with `--repeat-each 3`, and on Linux (`linux-term-3.log`).
- **Linux composer race.** In the container, `composer.e2e.ts --repeat-each 10` failed `:198` in 5 of 10 runs on this tree and 4 of 10 on HEAD before Stage 12 (`linux-composer-1.log`, `linux-composer-2-head.log`). After the fix it passed 70 of 70 (`linux-composer-4-fixed.log`). On macOS, composer and images with `--repeat-each 3` passed 36 of 36.
- **The window outside the page**, from scratch specs in `.dev/stage12/qa/` run on the final build, with screenshots in `qa/shots/`:
  - Main's `nativeTheme` and the window's background color follow Light and Dark, and a relaunch opens in the saved theme.
  - A relaunch with Light saved, while macOS is Dark, applied the theme at 92 to 107 ms and showed its first frame at 164 to 184 ms, in 5 launches. So the first frame is never in the wrong theme.
  - `settings.json` held all four settings set in the page: the chosen pi path, `"theme": "dark"`, `"pool": {"maxLive": 3}` and `"shortcuts": {"palette": "mod+p"}`. Mod+P opened the palette at once.
  - At the 840 px minimum width, the thread view doesn't scroll sideways in light or dark, with or without Changes open.

#### Screenshots

`.dev/design/stage12.design.ts` shot every screen in light and dark at 2x on the built-in display. The before set came from the unchanged build, and the after set from the final tree with the same scenarios. Only selectors changed.

- `.dev/design/stage12/before/`: 102 PNGs, 51 states.
- `.dev/design/stage12/after/`: 118 PNGs, 59 states. The new screens are S18f (the branch list open), S24a-e (Settings), S25a-b (the welcome) and S26 (the remove-project dialog).
- `.dev/design/stage12/compare/`: 102 side-by-sides, before on the left. S13b-vs-S24b pairs the old settings sheet with the Settings page.

Each folder has an INDEX.md. The orchestrator opened all 51 compare pairs in both themes. `.dev/stage12/c5-verdicts.md` gives a verdict for each.

The fix round then changed 83 of the 118 after shots. All 83 were re-inspected on 181 hotspot crops, on 8 contact sheets in `.dev/stage12/c5-final/`. The 9 screens with no before shot were viewed as light and dark pairs.

A last recapture on the final tree, `.dev/design/stage12/after-final/` (118 PNGs), was diffed against `after/`. 75 shots are pixel-identical, and 2 differ by less than 24 levels anywhere. The other 41 were opened as side-by-side crops of their changed regions. What changed is content that varies from run to run, plus a few states caught mid-change, and none of it is design:

- Content: temp-folder names, session and worktree IDs, terminal timestamps, and how far the reply had streamed.
- Rendering: anti-aliasing in the welcome's text, now that the welcome sits on one layer.
- Mid-change: an overlay scrollbar fading (S03a), a sidebar title not yet updated (S05a light), and pi still starting (S16b).

So `after/` stays the set for your approval.

All 17 keyboard shots from the final e2e run (`.dev/stage12/keyboard/`) were opened. Each shows its focus ring on the expected control. `13-settings-dark.png` now shows Dark settled, since `shot()` disables animations. The acceptance perf run's `mid-stream-1.png` and `mid-stream-2.png` were opened too. Their tables, lists and code blocks render correctly through the parse cache.

#### Perf vs budgets

The final column is the acceptance run on the final tree, `.dev/perf/2026-10-10T16-07-39/`. All 18 checks passed, in 12.9 minutes. It ran in a visible window on the built-in 2x/120 Hz display, in Playwright's default light scheme, as Stage 11's did. The HID idle time read 206 s at its start and 983 s at its end, so no keyboard or mouse input touched it. The first run, `.dev/perf/2026-10-10T11-37-30/`, came before the memory fix and the parse cache: 17 checks passed and 1 failed. Stage 11's values are its final run, `.dev/perf/stage11-ci-terminal-2026-10-03T08-17-19-796Z/`. Values are medians of three runs.

| Metric | Budget | Stage 11 final | Stage 12, first run | Stage 12, final | Result |
|---|---|---|---|---|---|
| Frame p95 / p99, 1,000 tok/s | 16.7 / 33 ms | 10.1 / 10.3 ms | 10.2 / 10.4 ms | 9.5 / 10.3 ms | Pass |
| Frame p95 / p99, 200 tok/s | 16.7 / 33 ms | 10.0 / 10.3 ms | 10.0 / 10.3 ms | 10.0 / 10.3 ms | Pass |
| Frame p95 / p99, 10 threads streaming | 16.7 / 33 ms | 10.0 / 10.3 ms | 10.0 / 10.2 ms | 10.0 / 10.3 ms | Pass |
| Input to paint p95, the three cases | 32 ms | 32 ms | 32 ms | 24 / 32 / 32 ms | Pass, at the limit in two |
| Long tasks at normal speed | None of 100 ms or more | None | None in streaming, diffs or terminal output | None in streaming, diffs or terminal output | Pass |
| Longest time behind the end, three cases | 100 ms | | 17.8 / 16.0 / 16.1 ms | 21 / 20 / 13.7 ms | Pass |
| Switch to a running thread | 100 ms | 90.3 ms | 89.7 ms | 55 ms | Pass |
| Cold start | 1 s | 241.1 ms | 261.2 ms | 240 ms | Pass |
| Total before streaming, 1,000 / 200 tok/s | 279.4 MiB | 270.881 / 272.256 MiB | **281.647 / 281.615 MiB**, a fail | 272.318 / 272.787 MiB | Pass |
| Total after 1,000 tok/s | 510.4 MiB | 461.178 MiB | 423.256 MiB | 418.678 MiB | Pass |
| Total after 200 tok/s | 522.5 MiB | 439.475 MiB | 398.694 MiB | 391.959 MiB | Pass |
| Terminal, 50 MiB | No task of 100 ms or more | 1.892 s, none | 1.891 s, none | 1.885 s, none | Pass |
| Terminal, 50 MiB, light theme | No task of 100 ms or more | | 1.870 s, none | not rerun | Pass |
| Port round trip p95 | Under 1 ms | 0.10 ms | 0.10 ms | 0.10 ms | Pass |

The switch fell from 89.7 ms in the first run to 55 ms. The parse cache accounts for most of that: on one build, run 5d measured the switch with test flags at 81.9 ms without it and 64.8 ms with it.

The first run missed the before-streaming memory budget. The readings were 287.3, 281.4 and 281.6 MiB at 1,000 tok/s, and 281.6, 278.4 and 287.1 MiB at 200 tok/s. `getAppMetrics` doesn't count pi, so results.json splits the total into the renderer, the host and the rest (main, GPU and utility processes):

- Renderer: 66.5 to 67.2 MiB, up to 69.9 to 71.3 MiB, about +4.4.
- Host: 17.5 MiB, up to 18.0, +0.5.
- The rest: about 186.6 MiB, up to about 192.6, +6. Two runs read about 198.

The unminified renderer bundle grew from 3,282 kB in Run 2, before any screen imported a ui component, to 4,061 kB. lucide is imported by name (56 icons), and 19 Base UI subpaths are imported. The budget is fixed, and a miss stops the stage, so a fix followed.

Run 5c attributed the miss against a Stage 11 build, 12 alternating runs each, by process and footprint category. The details and every sample are in [stack.md](stack.md#before-streaming-memory-fix).

- **GPU process, +10.7 MiB.**
  - The welcome screen, shown before the first thread opens, promoted two large layers where Stage 11 promoted two small ones. The GPU process still held their Metal allocations when the reading was taken.
  - The welcome is now one promoted layer, and its look is unchanged.
  - The ui Button's 150 ms `transition-colors` re-rasterized the hovered sidebar button's layer on every frame. It's gone, so hover colors change at once, as Stage 11's buttons did.
- **Renderer, +4.3 MiB.** The bundle grew, and the page keeps its script source at two bytes a character. The renderer bundle is now minified, decision D8 below: 4.06 MB became 1.83 MB.
- **Main process:** unchanged.
- **The two renderer changes, over 24 alternating runs:** the median went from 282.29 to 278.81 MiB.

The acceptance run on the final tree, with plain minification and the parse cache, put both before-streaming medians under the limit. They were 272.318 MiB (277.006, 270.725, 272.318) at 1,000 tok/s and 272.787 MiB (277.397, 271.521, 272.787) at 200 tok/s, against 279.4 MiB. Its terminal sent 50 MiB in 1,885, 1,888 and 1,883 ms, so the slowdown keepNames caused is gone.

After-stream memory fell from Stage 11's 461.178 and 439.475 MiB to 418.678 and 391.959 MiB in the final run. No A/B attributes that drop, so it isn't claimed as a saving.

The terminal ran in both themes on scratch specs in `.dev/stage12/perf-light/`, because the main suite runs in light only. Light took 1,866, 1,883 and 1,870 ms, and dark 1,870, 1,882 and 1,866 ms, with no task of 100 ms or more. At 4x they took 8,122 and 8,131 ms. Each spec checked that the drawer's background pixel matched `--card` in its theme. The light contrast floor costs nothing measurable.

Diffs: the colored 5,000-line diff showed rows in 339 ms and colors in 2,715 ms, with a longest task of 56 ms. The uncolored 10,000-line diff showed rows in 337 ms. At informational 4x slowdown, frame p95 was 26.2 and 23.1 ms at 1,000 and 200 tok/s, and input p95 40 ms at both. The switch took 380 ms, and the colored diff had one 217 ms task.

##### Real setup and the pool

Run 5b ran the built app on a sanitized copy of your `~/.pi/agent` on 2026-10-10, with your 10 packages, skills and context files loaded and your seven Tondo sessions copied to a temporary folder. Streaming used the faux provider, so no prompt reached a model. Medians of 3 runs; [stack.md](stack.md#real-setup) has every sample and everything the copy left out.

| | Budget | Your setup | Result |
|---|---|---|---|
| Cold start | 1 s | 257 ms | Pass |
| Switch to a running thread | 100 ms | 104 ms, and 104 ms on a repeat. After the fix below, 80.6 ms, and 80.0 ms on a repeat. | Pass after the fix |
| Frame p95 / p99 at 1,000 tok/s | 16.7 / 33 ms | 10.1 / 10.3 ms | Pass |
| Long tasks of 100 ms or more | none | none | Pass |
| Input to paint p95 | 32 ms | 32 ms | Pass |

- **The switch miss, found and fixed (run 5d).** It reproduced at 105.5 ms, against 81.9 ms with test flags.
  - Tondo wasn't waiting on pi, and extension UI wasn't the cost. In traces, the host's snapshot reached the page about 1 ms after the click in both setups, with no extra host message during the switch.
  - The snapshot's render grew by about 11 ms, nearly all of it Markdown parsing. With your extensions the new thread's pi starts about a second later, so the first thread's reply had streamed further by the switch: about 25,000 characters against 21,200.
  - Underneath was a flaw in Tondo: every switch parsed the whole reply again, including what it had already parsed while that thread was on screen.
  - The fix, `src/renderer/timeline/reuseParses.ts`, caches each Markdown block's parse tree by its text inside Streamdown's processor. `MessageView` passes it alongside Streamdown's own default plugins. Each reuse gets its own copy of the tree, and everything after parsing, sanitizing included, runs as before.
  - After the fix, the switch on your setup took 80.6 ms (73.4, 80.6, 80.7), and 80.0 ms on a repeat (72.9, 88.8, 80.0). With test flags it dropped from 81.9 to 64.8 ms. No keyboard or mouse input happened during those runs.
  - Its unit tests fail against each of five deliberately broken caches.
  - Run 5d ran every process with `HOME`, `PI_CODING_AGENT_DIR`, `CONTEXT_MODE_DATA_DIR` and Tondo's profile inside the copy, and never started pi itself. `lsof` showed each pi with its files in the copy and none under `~/.pi`, and nothing under `~/.pi` is newer than its start marker.

- **pi starts faster and lighter than in Stage 3:** 0.95 s to its first answer instead of 1.42 s, and about 136 MiB idle instead of 210. After a turn it holds about 192 MiB. Tondo's own processes held 144 MiB idle, 274 MiB with the transcript open and 417 MiB after the reply.
- **The pool keeps its defaults: 4 live pis and a 10-minute idle timeout.**
  - Four off-screen pis hold 0.53 to 0.77 GiB, inside the 850 MiB the default was sized on. Six would hold 0.80 to 1.15 GiB once each has done a turn.
  - Two would make moving between three threads wait about 1 s a switch: opening a thread whose pi was stopped took 998 ms.
  - A 5-minute timeout would make returns within 5 to 10 minutes wait that second, and a 20-minute one would hold up to 0.6 GiB more to save it.
- **One check broke the copy-only rule.** Before measuring, the lane ran the repo's pi with `--help` to check a flag, without pointing it at the copy. So pi loaded your real extensions for about a second, at 10:54 EDT.
  - In `~/.pi/agent` only the folder's own timestamp changed. Its 39 entries kept their sizes and timestamps, and `auth.json` and your sessions are untouched.
  - Your context-mode extension created an empty `~/.pi/context-mode/sessions/b1ef6c5bddf70d47.db`, outside `~/.pi/agent`. You chose to leave it.
  - Nobody captured network traffic, so a request by an extension in that second isn't ruled out.
  - Every later run pointed `PI_CODING_AGENT_DIR` and `CONTEXT_MODE_DATA_DIR` into the copy, and the after-listing shows nothing under `~/.pi` newer than that second.

#### Changes to the plan

The decisions I made under your delegation (`.dev/stage12/plan.md`, D1-D6):

- **D1, a Settings page instead of a dialog.** It replaces the main area, as T3's settings route does. Escape or Back returns to the thread.
- **D2, rebindable app shortcuts.** That covers the palette, a new thread, adding a project, the sidebar, the previous and next thread, and Settings. Overrides go in settings.json. The composer and dialog keys stay fixed, because they mirror pi's terminal UI.
- **D3, lucide icons.** lucide is the default for shadcn and T3, and each icon is imported on its own.
- **D4, onboarding in place.** Problems show where they happen, as listed under Shipped, rather than in a first-run wizard.
- **D5, `pnpm perf` without asking.** You were asleep, so the window on top couldn't disturb you or the input timing. Stage 5 set the precedent. When you came back, you OK'd the remaining runs: "Go ahead, I'll stay off."
- **D6, the real-setup pass on copies.** The copy of `~/.pi/agent` leaves out credentials and sessions. Streaming uses the faux provider, so no prompt reaches a model. Listings of `~/.pi` before and after each pass check that the real folder is unchanged. Run 5b's caught one slip, described under Real setup and the pool.

Other calls:

- **D7, a deeper light primary.** I moved the light `--primary` from `oklch(62% 0.15 42)` to `oklch(57% 0.15 42)`, so white button text reaches WCAG AA: 3.76:1 before, 4.62:1 now. The default hover mixes in the foreground, at 5.23:1 in light and 7.09:1 in dark. The focus ring reaches 4.54:1 against the page. The Warm hue and chroma are unchanged. This needs your OK.
- **D8, a minified renderer bundle.** electron-vite left the renderer unminified. Minifying it with esbuild, Vite's default for production builds, keeps memory before streaming inside its fixed budget: the bundle went from 4.06 to 1.83 MB.
  - esbuild's keepNames would keep function names in stack traces, but it was measured and dropped. Wrapping every named closure made 50 MiB of terminal output take 2.9 s instead of 1.9 s.
  - So production stack traces from the renderer show minified names. Development builds are unaffected.
  - This needs your OK.
- **The settings sheet is gone.** `/settings` used to open a sheet that said Tondo had no settings screen yet. Now it opens the Settings page's pi section. The protocol's settings-files message and the sheet kind are removed.
- **Alert dialogs.** Switch branch, Remove worktree and Remove project use the `alertdialog` role, which fits a confirmation. git.e2e accepts either role.
- **Native selects became Base UI Select.** That covers the model and thinking pickers, the Git branch and the checkpoint turn. Their names stay, and e2e picks options by label through `e2e/ui.ts`. Unlike the native select, the open list can now be tested on macOS.
- **The Linux composer race was older than Stage 12.** `composer.e2e.ts:198` failed in the container at the same rate on HEAD before Stage 12. The cause was in the test. Playwright's `fill("")` on a contenteditable selects through the DOM and then presses Delete, and Chromium can deliver that keydown before ProseMirror sees the `selectionchange`. The test now presses ControlOrMeta+A, then Delete, then waits for an empty draft. There are no sleeps, and the app is unchanged (`.dev/stage12/linux-composer.md`).
- **A Linux keyboard failure was an app bug.** The faux reply landed in one frame, with its second row 6,984 px tall. Legend List 3.4.0 follows a growing row only within one screen of the end, so the view stayed at the top while Tondo's follow state stayed on. Now, when a row grows while the view follows and the gap is more than a screen, `Timeline.tsx` scrolls to the end. It's one comparison per row resize, so streaming gains no work. The walk also waits for PageUp's `scrollend`, because Chromium on Linux animates it.
- **Terminal focus.** Closing the drawer other than by its own Close button dropped focus to the page: the palette's Close terminal, or ⌘1-9 to a thread without one. The drawer's cleanup now returns focus to its opener, or to the composer.
- **Narrow columns.** At the 840 px minimum width with Changes open, the composer's pickers lost their labels and the send button stuck out of its card. The Git toolbar spilled over the panel.
  - Stage 12 caused it, by grouping the toolbar and moving the pickers onto Base UI.
  - Now the toolbar groups and the composer footer wrap when their column is too narrow. Wider windows are unchanged.
  - Evidence: `.dev/stage12/qa/shots/min-width-changes-light.png` and `-fixed.png`.
- **Smaller calls:**
  - The Git toolbar keeps one row when there's no upstream, and Refresh is an icon. Remove worktree is a ghost button with a trash icon, and its dialog carries the red.
  - Dark destructive buttons use dark text: Stop goes from 3.30:1 to 5.36:1.
  - Checkboxes and switches got a control-border token: their edges went from 1.44-1.56:1 against the page to 3.49-3.92:1.
  - A pressed toggle is a solid chip, and header buttons are muted again.
  - The pierre-dark code background stays near-black, because it's the syntax theme's own.
- **The lint rule is Tondo's own.** @shadcn/lint 0.2.0 works under oxlint 1.85, but it finds ui components by import alias and misses Tondo's relative imports. So `scripts/lint/no-restyle.mjs` follows its `no-restyle` rule and resolves each import.
- **Parts of shadcn left out:**
  - shadcn's `tailwind.css` variants are inlined, so shadcn isn't a runtime dependency.
  - No tw-animate-css, no backdrop blur and no TooltipProvider.
  - The palette uses Base UI's combobox instead of `command`, because `command` needs cmdk, which needs Radix.
  - No sonner, because it needs next-themes.
- **Dependencies.** The five new ones are exact devDependencies (see [stack.md](stack.md#libraries)). Each was published well over a day before install. But `pnpm config get minimumReleaseAge` prints `undefined`, and the repo sets no release-age gate, although AGENTS.md says pnpm installs only versions at least a day old. Stage 0 relied on pnpm's default, and no one checked that the default applies.
- The before shots showed the remove-project confirmation inside the menu. An alert dialog replaces it.

#### Not verified

- **Your approval of the before and after screenshots**, which the stage's "Done when" asks for.
- **The visual review was mine alone.** The orchestrator worked through the visual-qa skill's checklist, without the skill's two independent reviewers.
- **Contrast calls left for you:** warning text is 4.23:1 against the page, and white on solid warning is 4.31:1. D7 itself awaits your OK.
- **Screen readers.** The audit reads Chromium's accessibility tree. No one has tried VoiceOver or Orca.
- **CI.** The Linux results come from the local arm64 container, not GitHub's x64 runner. CI runs on the pull request.
- **Not captured:** the before shots couldn't show the native select's open list (S18), and no capture shows the timed dialog's countdown.
- **Not unit-tested:** live pool limits and restarting pi after Check again. The e2e tests cover the pool limit and rediscovery through Choose pi….
- **Unseen:** Check again may flash the thread view before the setup card returns.
- **Follow-ups:**
  - There's no macOS app menu with "Settings…", only Electron's default menu (J1).
  - The composer, the palette's search and the diff filter show only a placeholder, as chat and search fields usually do. Each has an accessible name (C7).
  - While a Git action runs, every toolbar control is disabled, so a keyboard user who pressed Refresh can lose focus to the page until it ends.
  - A new thread doesn't focus the composer. The walk reaches it with Shift+Tab.
  - After a host kill, the sidebar title can lag behind the header. The before shots show it too.
  - On Linux, no app shortcut works while the terminal has focus. Ctrl+K, Ctrl+N, Ctrl+1-9 and the rest go to the shell.
  - The minified renderer ships no sourcemaps, so its stack traces show minified names. Hidden sourcemaps belong with Stage 13's packaging.
  - The comment atop `src/host/pool.ts` still sizes the pool on Stage 3's 212 MiB per pi. Stage 12 measured about 136 MiB idle and 192 MiB after a turn, which keeps the default inside its envelope.

#### Proposed commits

1. `build(deps): add base ui, lucide and class utilities`
2. `feat(ui): add shadcn components on base ui with design tokens`
3. `build(lint): forbid restyling ui components`
4. `feat(settings): store theme, pool, shortcuts and pi path in the host`
5. `feat(settings): add the settings page`
6. `feat(onboarding): guide pi setup, provider sign-in and trust`
7. `feat(ui): move every screen onto the component layer`. Each screen's keyboard paths and names come with it, because the screen lanes built them together.
8. `feat(palette): open and close the terminal from the palette`
9. `fix(timeline): follow a row that grows past a screen`
10. `fix(terminal): return focus when the drawer closes`
11. `test(composer): clear the draft through the editor`
12. `test(e2e): walk the app by keyboard and audit control names`
13. `perf(renderer): keep the welcome on one layer and drop button hover fades`
14. `perf(timeline): reuse Markdown parses when a message remounts`
15. `build(renderer): minify the renderer bundle`
16. `docs: record stage 12 results`

#### Next

After you approve this report and the screenshots, and Stage 12 lands, Stage 13 starts by reading T3's `scripts/build-desktop-artifact.ts` at the pinned commit. Signing and notarization still need your Apple Developer ID.

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

### Stage 13 report (2026-10-10)

You started the stage with "mass ulw start phase 13" and answered my four questions:
- There's no Apple Developer ID yet.
- Skip the self-signed macOS update test.
- Prove Linux in the local container now, and on GitHub's Ubuntu runner with the pull request.
- Draw a provisional icon.

I took the other calls myself. Each is under Changes to the plan, with its reason. Nothing is committed.

#### Shipped

- **Packaging.** `pnpm package` builds the app and runs `scripts/package.mts`, which drives electron-builder 26.15.3 through its JavaScript API.
  - On a Mac it builds dmg and zip for arm64 and x64 in one run. One `latest-mac.yml` lists both architectures.
  - On Linux it builds a deb and an AppImage.
  - Flags pick the platform, architectures, targets, the `release` or `e2e` variant, the version, a test update feed, and the output folder. Output goes to `dist/`, and the e2e variant to `dist/e2e/`.
  - The app id is `io.github.akshay-patel7.tondo`.
- **What ships.** `app.asar` holds `out/` without sourcemaps, `package.json`, and the production `node_modules`: node-pty, electron-updater and their dependencies. That's 615 entries on a Mac. Nothing comes from `src/`, `e2e/`, `docs/`, `scripts/` or `fixtures/`.
  - node-pty is unpacked, and only its runtime files ship. On a Mac that's five `lib/` files, `LICENSE`, `package.json`, and that architecture's own `pty.node` and `spawn-helper`. On Linux it's the same files with `build/Release/pty.node`.
  - node-pty publishes the x64 `spawn-helper` without its execute bit, so the script sets it after packing.
- **Fuses**, read back from every packed app after each build. Packaging fails on any mismatch.

  | Fuse | Release | e2e variant |
  |---|---|---|
  | RunAsNode | off | off |
  | EnableCookieEncryption | on | on |
  | EnableNodeOptionsEnvironmentVariable | off | off |
  | EnableNodeCliInspectArguments | off | on |
  | EnableEmbeddedAsarIntegrityValidation | on | on |
  | OnlyLoadAppFromAsar | on | on |
  | LoadBrowserProcessSpecificV8Snapshot | off | off |
  | GrantFileProtocolExtraPrivileges | off | off |
  | WasmTrapHandlers | Electron's default (on) | Electron's default (on) |

- **macOS signing.**
  - The hardened runtime is on, and the entitlements are `allow-jit` and `disable-library-validation` (`build/entitlements.mac.plist`).
  - With `CSC_LINK`, `CSC_NAME` or a "Developer ID Application" identity in the keychain, electron-builder signs normally. It also notarizes when an App Store Connect API key, an Apple ID app password or a keychain profile is in the environment.
  - Otherwise the build is ad-hoc signed, so Apple silicon runs it.
- **Linux packages.**
  - The deb installs to `/opt/Tondo`, with `tondo` on the PATH. On a system with AppArmor its postinst installs a profile, so the Chromium sandbox works under Ubuntu 24.04's user-namespace restriction. It makes `chrome-sandbox` setuid only when user namespaces don't work.
  - The AppImage uses electron-builder's static runtime (toolset 1.0.3).
  - Both name the app `tondo`, which matches the window's WM class.
- **Icon.** A provisional icon, a terracotta disc with one lighter ring on a warm off-white tile, is in `build/icon.png`. It's drawn on the macOS icon grid and needs your OK. Its source and previews are in `.dev/stage13/icon/`.
- **Updates.** `src/main/updater.ts` uses electron-updater 6.8.9 against GitHub Releases.
  - A packaged app with an update feed checks at launch and every 6 hours. It downloads in the background and installs when you quit. A notification, "Tondo <version> is ready", restarts into the update when clicked.
  - `TONDO_DISABLE_UPDATES=1` turns checking off.
  - electron-updater loads only once updates are on, so unpackaged runs, `pnpm perf` included, never load it.
  - Main now logs "Tondo <version> is running" at startup.
- **Packaged smoke.** `node scripts/smoke.mts --app <path>` smokes a packaged executable, `.app` or AppImage.
  - A packaged Tondo ignores `TONDO_PI_ARGS` and would run your real pi, so the script always launches it with a scratch HOME, pi agent folder, context-mode folder and profile. It also uses a pi path that doesn't exist, a minimal PATH, `TONDO_DISABLE_UPDATES=1`, and `--use-mock-keychain` on macOS.
  - It fails unless the renderer is sandboxed. On macOS that means the renderer carries `--seatbelt-client`. On Linux, every renderer must show `Seccomp: 2`. In both cases no process may run with `--no-sandbox`.
  - Packaged runs get 90 s to be ready, because x64 under Rosetta takes about 21 s on its first launch.
- **Packaged e2e.** With `TONDO_E2E_EXECUTABLE=<executable>`, the e2e suite launches a packaged e2e-variant app in the same scratch environment. `e2e/pi.ts` then gives it a pi wrapper with the faux model's arguments built in.
- **Release workflow.** `.github/workflows/release.yml` runs on a `v*.*.*` tag. A manual run with a version builds and smokes but never publishes.
  - It builds macOS arm64 and x64 on `macos-26`, and Linux x64 and arm64 on `ubuntu-24.04` and `ubuntu-24.04-arm`.
  - It smokes the dmg, the zip, and the x64 zip under Rosetta. It installs the deb and smokes it with Ubuntu's AppArmor restriction on, then relaxes the restriction and smokes the AppImage.
  - It uploads everything to a draft GitHub Release for you to publish: installers, `latest*.yml`, blockmaps, and a zip of the renderer's sourcemaps.
  - Signing and notarization use the secrets `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (the `.p8` contents), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. Without them the macOS build is ad-hoc signed, and the job warns.
- **CI.** A new `package` job packages and smokes on `macos-26` and `ubuntu-24.04`, with the same AppArmor order.
- **Hidden sourcemaps.** The renderer writes `.map` files next to its minified bundles but references none, so the page never loads them. They stay out of the package, and the release attaches them as a zip.
- **Dependencies.** electron-updater 6.8.9 is a runtime dependency, and electron-builder 26.15.3 and @electron/fuses 2.1.3 are dev dependencies. pnpm doesn't run electron-winstaller's build script, which only serves Windows installers.

#### Proofs

The final runs used the finished tree. The macOS logs are in `.dev/stage13/final/mac/`. The Linux logs are in `.dev/stage13/final/linux/`, from a fresh snapshot in the local Ubuntu 24.04 arm64 container (Node 24.15.0, pnpm 12.6.0, Electron 44.4.5), run as a non-root user under xvfb.

| Check | macOS | Linux arm64 container |
|---|---|---|
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | exit 0 | not run there |
| `pnpm test` | 52 files, 566 tests passed (Node 24.15.0) | not run there |
| `pnpm build` | "React Compiler compiled 168 functions." | built by `pnpm package` |
| `pnpm smoke` | passed, ready in 482 ms | not run there |
| `pnpm e2e` | 80 passed, none failed, flaky or skipped (3.8 min) | not run there |
| `pnpm package` | arm64 and x64 dmg and zip, one `latest-mac.yml`, every fuse ok, 615 asar entries, no `.map` | deb and AppImage, every fuse matches, 614 asar entries, no prebuilds |
| Packaged smoke | dmg arm64 1631 ms, zip arm64 1567 ms, zip x64 under Rosetta 20894 ms, each with the renderer's `--seatbelt-client` | deb from `apt-get install` 727 ms, AppImage 177 ms, each with renderer `Seccomp: 2` |
| Packaged e2e: `window.e2e.ts`, plus a real shell in `terminal.e2e.ts` | 7 passed | 7 passed |
| `spctl -a -vv` | "rejected" (exit 3): there's no Developer ID | not applicable |

Two notes on the final macOS run:
- Its shell found Homebrew's Node 26.7.0 before the pinned 24.15.0, so Playwright's runner ran on 26.7.0. The app under test runs Electron's own Node.
- Under Node 26.7.0, `src/host/piRpc.test.ts` fails "matches responses to commands by id, in whatever order they come". It passes under 24.15.0, and Stage 13 doesn't touch `src/host`. See Not verified.

Earlier runs on this tree, with evidence under `.dev/stage13/`:

| Check | Result | Evidence |
|---|---|---|
| Sandbox control: the arm64 app with `--no-sandbox` | the smoke fails, as it must | `mac/smoke-control-no-sandbox.log` |
| Fuses of the e2e variant | differ from release only in the inspect fuse | `mac/fuses-diff-release-vs-e2e.txt` |
| `ELECTRON_RUN_AS_NODE=1 Tondo -e ...` | starts as Tondo, and the script never runs | `fuses/probe-results.md` |
| `--inspect`, `--inspect-brk`, SIGUSR1 | nothing listens; the e2e variant does, as the control | `fuses/probe-results.md` |
| `NODE_OPTIONS=--require hook.cjs` | "NODE_OPTIONS ignored due to disabled nodeOptions fuse"; the hook never runs | `fuses/probe-results.md` |
| One byte changed in `index.html` inside `app.asar` | dies by SIGTRAP after 1.5 s: "Failed to validate block while ending ASAR file stream" | `fuses/probe-results.md`, Correction |
| One byte changed in the asar header | dies by SIGTRAP after 1.3 s, before main runs: "Integrity check failed for asar archive entry '<header>'" | `fuses/probe-results.md`, Correction |
| Entitlements, each removed in turn | without `allow-jit`, V8 aborts (CodeRange); without `disable-library-validation`, dyld refuses Electron Framework ("different Team IDs"); without `allow-unsigned-executable-memory`, it runs | `mac/entitlements-trimming.txt` |
| AppImage update from 0.0.1 to 0.0.2 against a local server | downloaded 8 changed blocks (162 KB of 117 MB), installed on quit, sha256 matches 0.0.2, the relaunch reports up to date, and the smoke passes | `updates/` |
| deb update from 0.0.1 to 0.0.2 | installed through `sudo dpkg -i`, since the container has no pkexec; dpkg reports 0.0.2; relaunch and smoke pass | `updates/deb/` |
| actionlint 1.7.12 on both workflows | no findings | `release/actionlint-after-review.txt` |
| No trace of the runs | `find ~/.pi -newer <marker>` prints nothing, `~/Library/Application Support/Tondo` doesn't exist, and no "Tondo Safe Storage" keychain item appears, after every batch of launches | each log above, `teardown-receipt.txt` |

The first update run caught a bug in my lazy updater import. `const { autoUpdater } = await import("electron-updater")` gave undefined in the packaged app, because Node's `import()` finds a CommonJS module's named exports by reading its source, and it can't see electron-updater's getter. `updater.ts` now reads it from the module's default export. The packaged smoke and e2e never saw the bug, because they turn updates off. The run that passed is the second one. The first one's logs are in `updates/attempt1/`.

#### Screenshots

Each one opened and checked:
- `.dev/stage13/icon/previews/contact-sheet.png`: the icon from 1024 down to 16 px, on light and dark.
- `.dev/stage13/final/mac/icon.png`: the icon rendered back from the final app's `.icns`. It's byte-identical to the one I reviewed after the polish build.
- `.dev/stage13/e2e/packaged-screenshots/terminal.png`: the packaged app with the faux model and a working terminal.

#### Perf vs budgets

I didn't run `pnpm perf` again. Nothing it measures can have moved:
- With and without the hidden sourcemaps, all 323 shipped renderer, main and preload files are byte-identical (`.dev/stage13/polish/sourcemap-identity.txt`).
- The only other change to an unpackaged run is that main logs its version and calls `startUpdater`, which returns at once because the app isn't packaged. electron-updater never loads; `src/main/updater.test.ts` checks that, and a mutation showed the test can fail.

Stage 12's results stand. If you want the numbers anyway, `pnpm perf` takes about 12 minutes and keeps the window on top.

#### Changes to the plan

- **Two more fuses.**
  - OnlyLoadAppFromAsar is on, because asar integrity covers only `app.asar`. Without this fuse, an `app` folder next to it would load unchecked.
  - GrantFileProtocolExtraPrivileges is off, because Tondo serves its pages from `tondo://`.
- **Entitlements trimmed to two.** `allow-unsigned-executable-memory` is gone. `disable-library-validation` stays, because ad-hoc builds need it. A Developer ID build might drop it, since one Team ID would sign everything. That's unproven.
- **The AppImage uses toolset 1.0.3.** The default runtime needs `libz.so`, which stock Ubuntu 24.04 lacks, and writes `--no-sandbox` into the AppImage's desktop entry for every launch. The plan's gotcha is right that AppRun drops to `--no-sandbox` when user namespaces are blocked.
- **One packaging run for both macOS architectures.** T3 builds each architecture in its own job and merges the update manifests afterwards. Here, per-architecture file patterns make that unnecessary.
- **A script instead of a config file.** It handles the variants and a test feed, and checks the fuses afterwards.
- **electron-updater loads lazily.** The before-streaming memory limit had almost no headroom in Stage 12, and the unpackaged app now never loads electron-updater.
- **Releases are drafts.** You publish each one.
- **Not in the plan:** the provisional icon, and the hidden sourcemaps (a Stage 12 follow-up).

#### Not verified

- **Signing, notarization, `spctl` and macOS auto-update.** There's no Developer ID, and `spctl -a -vv` rejects the ad-hoc app. Squirrel.Mac installs only updates signed the same way as the running app, so macOS updates wait for the Developer ID.
- **Ubuntu 24.04 with AppArmor on.** OrbStack's kernel has no AppArmor. So the deb's profile, and the x64 static AppImage runtime, are proven only once CI runs on the pull request.
- **Linux x64.** Every local Linux build was arm64.
- **A FUSE-mounted AppImage.** The container has no `/dev/fuse`, so the AppImage ran in extract-and-run mode.
- **The deb's pkexec prompt on a desktop.** The container used `sudo`.
- **Keychain prompts.** Tests run with `--use-mock-keychain`. How an unsigned build's cookie key behaves after an update is untested.
- **The icon in the macOS 26 Dock and Finder.**
- **Follow-ups:**
  - `src/host/piRpc.test.ts` fails under Node 26.7.0 but passes under the pinned 24.15.0. To reproduce: `/opt/homebrew/Cellar/node/26.7.0/bin/node node_modules/vitest/vitest.mjs run src/host/piRpc.test.ts`.
  - The deb pulls in 55 packages on a minimal Ubuntu, most of them through `xdg-utils`.
  - Quitting a few hundred milliseconds into launch logs "Tondo couldn't load tondo://app/", because the page load is cancelled. That's handled and harmless.

#### Proposed commits

1. `build(deps): add electron-builder, electron-updater and fuses`
2. `build(package): package macOS and Linux builds with fuses and hardened runtime`
3. `build(package): add a provisional app icon`
4. `build(renderer): emit hidden sourcemaps`
5. `feat(updates): update from GitHub Releases`
6. `test(smoke): smoke packaged builds and check the sandbox`
7. `test(e2e): drive packaged builds`
8. `ci: package and smoke on both systems`
9. `ci: publish draft releases from tags`
10. `docs: record stage 13 results`

#### Next

After you approve this report and the icon, the pull request's CI proves the deb's AppArmor profile and the x64 builds. Once you have a Developer ID, add the five signing secrets. Then tag the first release and check `spctl` and a macOS update from version N to N+1.

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

At the Stage 4 design checkpoint on 2026-09-27 you picked the Warm direction over Neutral (T3 Code's values) and Terminal (monospace, sharp corners). Its tokens are in `src/renderer/index.css`: warm off-white and charcoal neutrals, a terracotta primary (`oklch(57% 0.15 42)` light, `oklch(70% 0.14 45)` dark), 12 px corners on controls and 20 px on panels, and the system sans font. Stage 12 builds its shadcn components on them. It also deepened the light primary from `oklch(62% 0.15 42)` so white button text reaches WCAG AA (4.62:1, was 3.76:1), keeping the hue and chroma (D7 in the [Stage 12 report](#stage-12-report-2026-10-10), which awaits your OK).

For Stage 5 you let me take my recommended option on each open question (2026-09-28). These are the ones you'll notice:

- The pool keeps at most 4 pi processes running, and a hidden thread's pi stops after 10 idle minutes. Since Stage 12 both can be changed in Settings. Stage 3 measured an idle pi on your setup at about 210 MiB, so 4 come to about 840 MiB. The thread on screen and busy threads are never stopped, so 10 threads streaming at once run 10 pi processes.
- Projects are folders you add, as in T3. Each lists the pi sessions started in its folder, including ones from pi's terminal UI. Tondo doesn't add a project for every folder pi has sessions for.
- Projects stay in the order you added them. T3 sorts them by latest activity, which moves them while you work.
- Archiving a thread doesn't ask. The command palette lists archived threads, and choosing one brings it back. Removing a project asks first, and it never deletes pi's session files.
- A new thread you leave before sending a message or typing a draft disappears, as T3's draft threads do, so Cmd+N doesn't leave empty rows behind.
- The shortcuts take T3's defaults for the palette, the sidebar, a new thread and moving between threads, and add Cmd+O to add a project. Since Stage 12 they can be changed in Settings, and Cmd+, opens Settings.
- Rename appears once a thread has a reply. pi saves a session only after the first reply, so a name set before then would be lost if pi stopped.

For Stage 6 you took my recommended option on each question (2026-09-28):

- A write card shows the file pi wrote, highlighted, since pi's write reports no diff.
- While a shell command runs, its card shows the last 5 lines of output under the header. When the command ends, the card shrinks to one line.
- `pnpm perf` fails unless Tondo's window is on a 2x display refreshing at 120 Hz. There's no switch to pick a display, so with an external monitor as the main display, make the built-in one main before a run.
- The CSP allows inline styles, as T3 Code's does, because @pierre/diffs colors code with them. Scripts stay blocked, and images, fonts and connections stay limited to the app.
- Diffs get syntax colors up to 2,500 lines a side, and bigger ones show uncolored at once.

For Stage 7 you took my recommended option on each question (2026-09-29):

- An extension's dialog takes the composer's place until you answer it, as in pi's terminal UI. The transcript stays readable, Escape cancels, and your draft comes back.
- A dialog raises an OS notification when its thread isn't on screen or Tondo's window isn't focused. Clicking the notification opens the thread.
- The slash menu lists the built-ins Tondo can't run yet after everything else, dimmed, with the reason.
- The files /settings and /export name get a Show in Finder button. The host shows only files it offered.

For Stage 12 you said "Go with your recommendation" before going to bed (2026-10-10), so I took the recommended option on each open question. The [Stage 12 report](#stage-12-report-2026-10-10) gives the reasons:

- Settings is a full page that replaces the main area, not a dialog.
- Tondo's app shortcuts can be rebound. The composer and dialog keys stay fixed.
- Icons come from lucide.
- Onboarding shows each problem where it happens. There's no first-run wizard.
- `pnpm perf` and the real-setup pass run without asking first. The real-setup pass runs on copies that leave out credentials and sessions.

For Stage 13 you answered four questions on 2026-10-10:

- Apple Developer ID: "Not yet". Signing, notarization, `spctl` and macOS auto-update stay unverified.
- A self-signed macOS update test: "Skip it".
- Proof of the deb's AppArmor profile: "Container + PR CI".
- App icon: "Draft one". You approved the provisional icon with the report.

I took these on your behalf:

- The fuses also turn OnlyLoadAppFromAsar on, because asar integrity covers only app.asar, and GrantFileProtocolExtraPrivileges off, because pages come from `tondo://`.
- Packaging is `scripts/package.mts` on electron-builder's JS API, run by `pnpm package`, with `release` and `e2e` variants, `--version` and `--feed-url`. Output goes to the gitignored `dist/`.
- `npmRebuild` is off. node-pty uses Node-API, and its prebuilds and Linux build load in Electron 44 as they are.
- electron-updater is a runtime dependency, packed in the asar next to node-pty.
- Only a packaged app with `resources/app-update.yml` checks for updates, at launch and every 6 hours. It downloads by itself, installs on quit, and raises a notification that restarts into the update. `TONDO_DISABLE_UPDATES=1` turns it off. The page gets no update UI yet.
- Without a Developer ID, macOS builds are ad-hoc signed with the hardened runtime. Developer ID signing and notarization switch on when their secrets are set.
- One macOS run builds arm64 and x64, so one `latest-mac.yml` lists both.
- The release workflow publishes a draft GitHub release, and you publish it.
- Hidden renderer sourcemaps stay out of the package and go on the release as a zip.
- The entitlements are trimmed to `allow-jit` and `disable-library-validation`. Removing either one crashed the ad-hoc build.
- The AppImage uses electron-builder's 1.0.3 toolset, whose static runtime starts on stock Ubuntu 24.04.
- Main imports electron-updater only once updates are on, so unpackaged runs never load it.

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
