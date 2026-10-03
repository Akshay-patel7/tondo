# Stack

The frameworks and libraries Tondo is built on, and the evidence behind each choice. Everything here was checked on 2026-09-24, so versions and download counts are from that day. Measurements come from one Apple M5 Mac with 24 GB of RAM running macOS 26.6.2.

## Summary

| Layer | Choice | Latest on 2026-09-24 |
|---|---|---|
| Desktop shell | Electron | 44.4.5 (Chromium 152, Node 24.21) |
| pi process host | Tondo's own RPC client in an Electron utility process, one `pi --mode rpc` per thread | Tested with pi 0.87.1 |
| UI framework | React with React Compiler | react 19.3.0, babel-plugin-react-compiler 1.0.0 |
| Transcript list | @legendapp/list, with @tanstack/react-virtual as the fallback | 3.4.0, 3.14.13 |
| Markdown | streamdown with @streamdown/code | 2.6.0, 1.1.1 |
| Code highlighting | Shiki 3, through @streamdown/code | 4.4.3 (Tondo runs 3.23.0, see [Libraries](#libraries)) |
| Diffs | @pierre/diffs with its worker pool | 1.4.3 (Tondo runs 1.5.1, see [Libraries](#libraries)) |
| Composer | TipTap 3 with literal Markdown, file completion, history and image attachments | @tiptap/react 3.31.3 (Tondo runs 3.31.4, see [Libraries](#libraries)) |
| Components and styling | Base UI, shadcn and Tailwind CSS | @base-ui/react 1.8.0, shadcn 4.21.0, tailwindcss 4.3.3 |
| State | zustand | 5.0.15 |
| Terminal (later) | @xterm/xterm and node-pty | 6.0.0, 1.1.0 |
| Build | Vite with electron-vite | Vite 7 (see [Tooling](#tooling)), electron-vite 5.0.0 |
| Packaging and updates | electron-builder and electron-updater | 26.15.3, 6.8.9 |
| Language | TypeScript | 7.0.2 |
| Package manager | pnpm | 12.6.0 |
| Tests | Vitest, and Playwright for end-to-end tests | 5.0.1, 1.63.0 |

## Desktop shell: Electron

- **pi is TypeScript, and so is the code at Tondo's core.** Starting pi, reading and writing its JSON lines, answering extension dialogs and restarting crashed threads all run in Electron's Node. That code can import the protocol types pi exports (`RpcCommand`, `RpcResponse`, `RpcExtensionUIRequest` and the rest). With Tauri the same code is either Rust with hand-copied types or a Node process shipped next to the app.
- **OpenCode, a TypeScript coding agent with a desktop app, left Tauri for Electron.** Its [write-up](https://dev.to/brendonovich/moving-opencode-desktop-to-electron-4hip) (April 2026) says: "Tauri uses WebKit on macOS and Linux, which not only has worse performance than Chromium when rendering our app, but also has minor inconsistencies with it, especially around styles." Running the CLI bundled with the app "impacted startup time, and occasionally just failed". Once OpenCode moved from Bun to Node, "simply running our server code within Electron's built-in Node process was quite appealing". On Tauri's speed, the post says: "Getting the best performance out of Tauri requires implementing your app's logic in Rust".
- **WebKit on Linux has its own performance problems.** WebKitGTK has been slow with large pages ([tauri#3988](https://github.com/tauri-apps/tauri/issues/3988)), and FitCoach [moved from Tauri to Electron](https://github.com/liker0704/fit-coach/blob/main/desktop/ELECTRON_MIGRATION.md) over it in November 2025. Tauri's Chromium runtime exists only in the v3 alpha ([tauri-runtime-cef 3.0.0-alpha.2](https://github.com/tauri-apps/tauri/releases/tag/tauri-runtime-cef-v3.0.0-alpha.2), released 2026-09-21).
- **The memory cost is small next to pi's.** An empty Electron window used about 80 MB. An empty WKWebView window used about 62 MB, and WKWebView is the engine Tauri, Wails and Electrobun use on macOS. One bare pi process uses 80 to 86 MB, so the number of pi processes Tondo keeps alive matters far more than the shell. Charts that show Electron using about four times Tauri's memory match what you get by adding up RSS, which counts Electron's shared code once per process (see [Measurements](#measurements)).

What Electron costs:

- **Download size.** OpenCode's Electron binary is 206 MB ([opencode#26143](https://github.com/anomalyco/opencode/issues/26143)). An empty Electron app takes 319 MB on disk in [Elanis' comparison](https://github.com/Elanis/web-to-desktop-framework-comparison), against about 5 MB for Tauri.
- **Resident code.** Electron keeps 65 to 173 MB of its own framework code in memory. The pages are backed by the app's files, so macOS can drop them under memory pressure. WKWebView shares its code with the operating system.
- **Upgrades.** Electron ships a new major version every 8 weeks and supports only the latest three ([timelines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)).

Alternatives:

| Option | Why not |
|---|---|
| Tauri 2 | WebKit on macOS and Linux. The pi host would be Rust or a separate Node process. Chromium only in the v3 alpha. |
| [Electrobun](https://github.com/blackboardsh/electrobun) 2.0 | Small bundles, but it uses the system WebKit by default, with Chromium opt-in. The main process runs on Bun or Electrobun's own JavaScriptCore-based runtime, not Node. The npm package downloads the runtime from GitHub Releases. Linux support is official only on Ubuntu 24.04 and later. |
| Wails | Go. WebKit on macOS and Linux. v3 is still in beta (v3.0.0-beta.25). |
| GPUI (Zed's UI framework) | The fastest option in principle, but it's Rust, the published `gpui` crate is still 0.2.2 from October 2025, and markdown, diffs, virtualized lists and text input would all be built by hand. |

## Where pi runs

```
renderer (React UI)
   ↕  MessagePort, set up once by the main process
utility process (pi host)
   ↕  JSON lines over stdin and stdout
pi --mode rpc, one per thread
```

The main process creates the window and a pair of message ports. It gives one port to the [utility process](https://www.electronjs.org/docs/latest/api/utility-process) and the other to the renderer through the preload script, then stays out of the data path. pi work never blocks the main process or the UI.

Measured with Electron 44.4.5 and pi 0.87.1, 3 runs:

| Check | Result |
|---|---|
| Utility process starts the installed `pi` | Works. First `get_state` reply 124 to 137 ms after the utility process started. |
| Renderer to utility round trip, 200 calls | Under 0.1 ms. Timings came in 0.1 ms steps. |
| Renderer to utility to pi and back, `get_state`, 50 calls | Median 0.1 ms, p95 0.2 ms. One slow call per run, 17 to 65 ms, probably the first call arriving before pi had finished starting (not confirmed). |
| 5,000 small messages from utility to renderer | About 15 ms, roughly 320,000 messages a second. |
| Closing pi's stdin | pi exited with code 0 every run. |

Stage 2 measured the same path in Tondo with `pnpm perf`. Over 1,000 round trips in a row, the page's port to the host and back averaged 0.02 ms, and p95 was 0.1 ms, the page clock's step. The table's 5,000 small messages aren't one snapshot, so Stage 2 timed snapshots too. Asking the host for the whole thread got the 1,000-message transcript, 1.1 MB as JSON, to the page's listener in 1.4 ms. A 5,000-message thread, 5.3 MB, took 6.7 ms, and 2.8 ms of that was the page reading `event.data`, which Blink deserializes on first read. Both are medians of 10 requests, each sent once the page was idle.

Message passing adds nothing measurable. There is no local HTTP server, so there is no port to open and no token to guard. If a browser UI is ever wanted, a WebSocket transport can be added later, as long as the host's messages stay plain JSON.

**Tondo writes its own RPC client.** pi's exported `RpcClient` spawns bare `node` from PATH and waits a fixed 100 ms after starting pi. It stops pi with SIGTERM and then SIGKILL instead of closing stdin, and it never answers `extension_ui_request`. Tondo's client should still import pi's protocol types from `@earendil-works/pi-coding-agent`. It also has to cope with message types it doesn't know, because users run their own pi version. Two more requirements:

- Split pi's output on LF only and strip a trailing CR. pi's [RPC docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md) warn against Node's `readline`, which also splits on U+2028 and U+2029.
- Take PATH from the user's login shell. An app started from Finder gets a minimal PATH and won't find a pi installed through asdf or nvm.

**Tondo stays on RPC instead of embedding pi's SDK.** Embedding would run the pi version bundled with Tondo instead of the user's, and it would run the user's extensions under Electron's Node. It would also lose the crash isolation of one process per thread. Two popular pi GUIs, pi-gui and Percho, run the SDK in Electron's main process, where a busy agent competes with window and IPC work.

## UI framework: React

On raw speed, Solid and Svelte beat React. Results from [js-framework-benchmark](https://krausest.github.io/js-framework-benchmark/2026/chrome152.html) on Chrome 152, keyed implementations:

| | React 19.2 | Solid 1.9 | Svelte 5.42 |
|---|---|---|---|
| Time, weighted geometric mean (1.0 is fastest) | 1.58 | 1.13 | 1.17 |
| Memory, geometric mean | 2.68 | 1.31 | 1.51 |
| Create 10,000 rows | 389 ms | 228 ms | 231 ms |
| Swap 2 rows, 4x CPU slowdown | 89.9 ms | 12.6 ms | 12.6 ms |
| Memory after 1,000 rows | 4.44 MB | 2.68 MB | 2.87 MB |

On the same time scale, Vue Vapor 3.6 beta scored 1.12, Vue 3.5 scored 1.31, Preact 1.59, and React 19.0 with React Compiler 1.64.

React is still the pick, because the gaps that matter most don't show up in Tondo's busiest code:

- A virtualized transcript keeps a few dozen messages mounted, so the 10,000-row and row-swap cases where React loses most never happen.
- Streaming changes one message at a time. With deltas committed once per animation frame, markdown parsing should take most of each frame, and that costs the same in any framework. The Stage 1 spike in docs/plan.md measured the whole case, and React stayed within every budget (see [Measurements](#measurements)).
- The framework's memory difference is a few MB. One pi process is 80 MB or more.
- T3 Code, the performance bar for Tondo, runs React 19.2 with React Compiler 1.0 (from `apps/web/package.json` at commit e67abcf7).

The libraries favor React, and they cover the hardest parts of the app. streamdown (4.4 million downloads a week), Legend List, Base UI and shadcn are React-only, and TipTap ships React and Vue bindings. Solid's closest markdown options are solid-markdown (14.7k downloads a week) and solid-streamdown (87 a week). Its main component library, Kobalte, is at 0.13, and Solid itself is partway to 2.0 (2.0.0-rc.9 is out). OpenCode's UI is Solid, which shows Solid works for an agent app, but more of it would have to be built by hand.

Solid was the fallback if React couldn't keep streaming smooth. It would cut framework time by about 30% and framework memory in half, at the price of a hand-built markdown renderer and components. React met every budget with per-frame batching alone, so React is confirmed and there is no Solid build.

The others:

- **Svelte 5** is close to Solid on speed, but TipTap has no Svelte binding, and Svelte projects can't use TypeScript 7 yet ([TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)).
- **Vue**'s fast Vapor mode is still a release candidate (3.6.0-rc.9) and has the same TypeScript 7 limit.
- **Preact** scores the same as React here and risks breaking React-only libraries.

## Libraries

- **@legendapp/list 3.4** for the transcript. T3 Code uses it, and it has props for chat (`maintainScrollAtEnd`, `maintainVisibleContentPosition`, `alignItemsAtEnd`, `onStartReached`; see the [chat example](https://legendapp.com/open-source/list/v3/react/examples/chat/)). Web support arrived in 3.0 (the changelog says "Feat: Web support", entry point `@legendapp/list/react`), but its README still describes it as React Native only. That mismatch is why @tanstack/react-virtual stays as the fallback. It has a [chat guide](https://tanstack.com/virtual/latest/docs/chat) that covers keeping the view anchored to the end. T3 Code patches three web problems in Legend List 3.3.5 (end spacing when the tail size is unknown, row reordering and scroll-adjust padding). 3.4.0 fixes all three, so Tondo uses it unpatched.
- **streamdown 2.6** for markdown. It replaces react-markdown, which T3 Code uses, and is built for streaming. It splits text into blocks and [memoizes](https://streamdown.ai/docs/memoization) each one, so only the growing block re-renders. It also completes unterminated syntax while text is still arriving. Code highlighting comes from the separate @streamdown/code package. Tondo patches version 1.1.1 to share one highlighter per theme pair and cap its cache at 128 results. Older results are recomputed when needed. The unpatched package keeps intermediate streaming results for the page's lifetime. Model output is untrusted, and streamdown 2.6.0 sanitizes it with rehype-sanitize and GitHub's schema. That drops `script`, `style` and `iframe` elements, `on*` attributes, and `javascript:` and `data:` URLs. Links open only after a confirmation dialog, which is on by default. Tondo's CSP (`img-src 'self' blob:`) blocks remote images; Stage 8 permits blob URLs for local raster previews.
- **Shiki 3.23** for code, because @streamdown/code 1.1.1 depends on `shiki ^3.19.0`. Shiki 4.4.3 is the latest. @pierre/diffs is built on Shiki too and accepts 3 or 4 (`^3.0.0 || ^4.0.0` in 1.4.3 and 1.5.1), so code blocks and diffs can share one copy and highlight the same way. Shiki ships a JavaScript regex engine as well as the default Oniguruma WebAssembly engine. @streamdown/code uses the JavaScript one, so Tondo's CSP needs no `'wasm-unsafe-eval'`. In the built app, code highlighted with no WebAssembly requests and no CSP errors (checked 2026-09-25).
- **@pierre/diffs 1.5** for diffs. T3 Code uses it. Its worker pool (`@pierre/diffs/worker`) runs syntax highlighting for diffs and files in web workers, off the UI thread. Tondo runs 1.5.1, published 2026-09-25, with a pool of 2 workers on Shiki's JavaScript regex engine, the pool's default. The page loads @pierre/diffs and starts the pool only when a tool card first shows a diff or a file, and the pool stops 30 s after the last one closes. 1.5.1 accepts `@shikijs/transformers` 3 or 4, and 4.4.3 brought a second copy of Shiki's core, so an override in `pnpm-workspace.yaml` pins it to 3.23.0. It builds each diff's rows as HTML with style attributes for token colors and puts its theme in a `<style>` element in the diff's shadow root. Tondo's CSP blocked both until Stage 6 allowed inline styles (`style-src 'self' 'unsafe-inline'`), and the workers need `worker-src 'self'`.
- **TipTap 3** for the composer. Stage 8 pins 3.31.4 and follows T3's plain mode: one paragraph per literal newline, with Document, Paragraph, Text and UndoRedo only. File and slash completion insert text rather than hiding it in rich-text chips. Images live outside the editor document, and a separate SQLite table keeps their bytes out of text-draft saves and sidebar reads.
- **Base UI 1.8, shadcn 4.21 and Tailwind CSS 4.3** for components and styling. T3 Code uses Base UI and Tailwind, and shadcn can generate its components on Base UI. Install `@base-ui/react`. `@base-ui-components/react` is the deprecated old name.
- **zustand 5** for state. T3 Code uses it. Its stores also work outside React, so the MessagePort handler can write to them directly. Streamed text should be buffered and committed once per animation frame.
- **@xterm/xterm 6.0.0 and node-pty 1.1.0** for the integrated terminal. Stage 10 uses Fit 0.11.0 and WebGL 0.19.0; both ran under Tondo's unchanged CSP. WebGL falls back to xterm's DOM renderer if it is unavailable or loses its context. The host loads node-pty only when a terminal opens, and the renderer loads xterm only for an open drawer. node-pty uses Node-API. Its macOS prebuild spawned and resized a shell inside Electron 44.4.5's utility process without a rebuild. Linux builds it with node-gyp. The 1.1.0 package ships its macOS `spawn-helper` without the execute bit ([node-pty#850](https://github.com/microsoft/node-pty/issues/850)); Tondo's `scripts/prepare-pty.mjs` fixes it at install time. node-pty is a runtime dependency so electron-vite leaves its native binary external to the host bundle.
- **Avoid @virtuoso.dev/message-list.** Its license is commercial. react-virtuoso itself is MIT.

## Tooling

- **Vite 7 with electron-vite 5.** OpenCode's desktop app uses electron-vite 5 too. electron-vite 5 accepts Vite 5 to 7. Vite 8 is out, but only electron-vite's 6.0 beta (April 2026) accepts it. Start on the stable pair, since the build is the easiest part of the stack to swap later.
- **electron-builder 26 and electron-updater 6** for installers and auto-update. T3 Code and OpenCode both use them.
- **TypeScript 7.0**, the native Go port, which is now `typescript@latest`. It has no compiler API until 7.1, so tools built on that API need TypeScript 6 installed alongside it.
- **React Compiler 1.0** ([announcement](https://react.dev/blog/2025/10/07/react-compiler-1)) is a Babel plugin, so builds run Babel over React files.
- **pnpm** for packages.
- **Vitest 5** for unit tests and **Playwright 1.63** for end-to-end tests. Playwright's Electron support is experimental, and test builds need the `EnableNodeCliInspectArguments` fuse left on.

## What other pi GUIs use

A survey on 2026-09-24 cloned 50 pi-related GitHub repos and sorted them by the dependencies in their package manifests. 41 ship a desktop shell:

- 31 use Electron, 8 Tauri and 2 Electrobun.
- 33 use React (one alongside Solid), 3 use Vue, and Svelte, Solid and Preact have one each.
- None of the React apps lists React Compiler.
- 28 embed pi's SDK and 11 run `pi --mode rpc`.

The ten with the most stars:

| Repo | Stars | Shell | UI | How it runs pi |
|---|---|---|---|---|
| [vastsa/PI-Desktop](https://github.com/vastsa/PI-Desktop) | 5,457 | Electron | React | SDK in a separate Node child process |
| [minghinmatthewlam/pi-gui](https://github.com/minghinmatthewlam/pi-gui) | 973 | Electron | React | SDK in Electron's main process |
| [ayuayue/PiDeck](https://github.com/ayuayue/PiDeck) | 959 | Electron | React | `pi --mode rpc`, spawned by the main process |
| [am-will/gooey-pi](https://github.com/am-will/gooey-pi) | 926 | Electron | React | `pi --mode rpc`, spawned by the main process |
| [rcarmo/piclaw](https://github.com/rcarmo/piclaw) | 862 | Electrobun | Preact | SDK, in a browser-first app with a desktop shell |
| [JetBrains/thinkrail](https://github.com/JetBrains/thinkrail) | 487 | Electrobun | React | SDK in Electrobun's Bun main process |
| [abcwyc/pi-agent-desktop](https://github.com/abcwyc/pi-agent-desktop) | 442 | Tauri | React | SDK in a Node server that Tauri starts |
| [Jaxton07/percho](https://github.com/Jaxton07/percho) | 360 | Electron | React | SDK in Electron's main process |
| [IgorWarzocha/howcode](https://github.com/IgorWarzocha/howcode) | 360 | Electron | React | SDK in a separate Node child process |
| [justhil/pi-app](https://github.com/justhil/pi-app) | 356 | Electron | React | SDK in a pool of Electron utility processes |

Stars are from 2026-09-24. Popularity says nothing about speed, but it shows that Electron and React are a common, proven path for pi GUIs.

## Measurements

All runs were on an Apple M5 with 24 GB of RAM and macOS 26.6.2, 3 runs each.

**Empty window.** Each app opened a hidden 1200×800 window on a trivial `data:` page. Startup is the time from launching the process to the page's load event (`did-finish-load` in Electron, `webView(_:didFinish:)` in WKWebView). Memory was read 3 seconds after load and summed across every process the app uses. That includes WebKit's helper processes, which are children of launchd rather than of the app. Footprint is macOS's physical footprint from the `footprint` tool, the number Activity Monitor shows as Memory. RSS comes from `ps`.

| | Electron 44.4.5 | WKWebView app (Swift, AppKit) |
|---|---|---|
| Startup, first run | 406 ms | 443 ms |
| Startup, later runs | 200 to 211 ms | 179 to 196 ms |
| Processes | 4 | 4 |
| Footprint | About 80 MB: browser 36, GPU 20, network 6.5, renderer 18 | 61 to 64 MB: app 20, GPU 13, networking 4.4, web content 24 |
| RSS, summed | About 354 MB | About 141 MB |

The RSS sum explains the popular charts. [Elanis' comparison](https://github.com/Elanis/web-to-desktop-framework-comparison) reports 369 MB for Electron and 95 MB for Tauri on macOS arm64. The Electron figure matches the RSS sum here, and RSS counts Chromium's shared code once in every process. WebKit's helper processes belong to launchd, so a measurement that follows the app's own process tree leaves them out.

**Bare pi.** Command: `pi --mode rpc --no-extensions --no-skills --no-context-files --no-session --offline` with a fresh `PI_CODING_AGENT_DIR`. The first `get_state` reply came in 120 to 149 ms. Footprint was 80 to 86 MB and RSS 125 to 131 MB.

**A real pi setup.** On 2026-09-27 Stage 3 ran the everyday pi setup on this Mac under Tondo's supervisor. That was pi 0.87.1 from asdf with Node 24.15.0, `~/.pi/agent` with its 12 packages, and this repo as the working folder. A scratch script started pi the way the host does, from a clean environment like the one Finder gives an app, five times in a row. Each time it asked for `get_state`, left pi idle for 10 seconds, then closed pi's stdin. No prompt went out, and sessions went to a temporary folder. For comparison, the same script ran pi with the flags Tondo's tests use: no extensions, skills or context files, and the faux provider.

| | Real setup | Test flags |
|---|---|---|
| Spawn to the first `get_state` reply | 1.30 to 1.78 s, median 1.42 s | 121 to 133 ms |
| Footprint at that reply | 337 to 356 MiB | 85 to 89 MiB |
| Peak footprint | 353 to 368 MiB | 85 to 90 MiB |
| Footprint after 10 s idle | 210 to 213 MiB | 71 to 75 MiB |
| RSS at the reply, then idle | 371 to 390, then 252 to 255 MiB | 130 to 134, then 118 to 122 MiB |

The login shell ran in 41 ms. Counting it, the first start spent 48 ms before pi spawned, and each later start spent 1 ms. Each pi was a single process, because none of the 12 packages started a helper process within the 10 seconds. At startup pi sent four `setStatus` requests and one `setWidget`, which need no answer. Closing stdin stopped pi in 8 to 20 ms with exit code 0. Nothing it started was left, and no file under `~/.pi/agent/sessions` changed.

An earlier run, ten minutes before, recorded RSS only. Its first start took 3.7 s and reached 635 MiB RSS, and only that start sent a `notify`. Its other four starts matched the table, so one of the packages did one-time work on that start. Which one wasn't identified.

So on this setup each idle pi holds about 210 MiB, close to what all of Tondo's own processes hold together (264 MiB with the transcript open). A new pi answers after about 1.4 s, so a thread whose pi was shut down takes that much longer to open. The 100 ms switch budget covers only threads whose pi is running. Stage 5 sets the pool from these numbers.

**Streaming a long reply.** The Stage 1 spike measured this with `pnpm perf` on 2026-09-25. It plays a recorded pi run into the built app. The reply is 20,000 tokens, 80,483 characters of markdown with code blocks, tables and lists, and it streams into a 1,000-message transcript while the harness types into the composer at about 10 keys a second. The window stays visible and in front. The display runs at 120 Hz, so a frame is 8.3 ms. Medians of 3 runs:

| | 1,000 tokens/s | 200 tokens/s | Budget |
|---|---|---|---|
| Frame time, p95 | 10.0 ms | 10.0 ms | 16.7 ms |
| Frame time, p99 | 10.3 ms | 10.3 ms | 33 ms |
| Longest frame | 10.4 ms | 10.7 ms | |
| Tasks over 50 ms | None | None | None of 100 ms or more |
| Input to paint, p95 | 32 ms | 32 ms | 32 ms |

No frame in any run took longer than 10.8 ms, so none missed a refresh. Input to paint landed exactly on the budget. Chromium reports Event Timing durations in 8 ms steps, so the next step up, 40 ms, would fail. An earlier run of the same build measured 24 ms, with frame time p95 of 9.2 ms. A/B runs showed that the harness changes made since then don't move either number, so the difference comes from the machine's state, not from Tondo.

A Reopen button stands in for switching threads until Stage 5. Reopening mid-stream painted the transcript at the bottom in 65 ms (budget 100 ms). Cold start, from launch to an interactive window, took 239 ms (budget 1 s).

At 4x CPU slowdown, which informs but doesn't gate, one run at each rate gave frame time p95 of 27 and 25 ms, p99 of 35 and 33 ms, longest frames of 60 and 52 ms, and input to paint p95 of 48 and 40 ms. No task took 100 ms or more (the longest took 53 ms), and the switch took 312 ms.

A second `pnpm perf` run on the same code also measured how long the view trails the end of the reply. The longest trail in each run had a median of 22 ms at 1,000 tokens/s and 14.6 ms at 200 tokens/s, against a budget of 100 ms. At 4x slowdown it was 84 and 46 ms. Every other budget passed again. One frame at 200 tokens/s took 192 ms, with no script running in it.

Memory sets the baseline for later stages. Before each reading the harness collects garbage in every JavaScript heap: the main process, the page and the player's worker. It's the collection DevTools' "Collect garbage" runs. Summed over Tondo's processes, footprint was 254 MiB with the transcript open. After the reply it was 464 MiB at 1,000 tokens/s and 475 MiB at 200 tokens/s, and the renderer alone grew from about 65 MiB to 143 and 161 MiB. No reading varied by more than 5% across its three runs, half the 10% regression the budget allows. The second run spread wider, and its medians moved with no change to Tondo. After the 200 tokens/s reply the sum was 510 MiB instead of 475, 7% higher, and the renderer was 179 MiB instead of 161, 11% higher. Noise alone can push the renderer past the 10% budget. Without the collection, the renderer's reading at 200 tokens/s varied by 19%. The GPU process gives back about 160 MiB in the 9 seconds after a stream ends, so the after numbers show memory as a stream ends, not at rest.

Stage 2 moved the player out of the renderer's worker into the host, a utility process, and the harness collects the host's garbage too. With the transcript open the sum was 264 MiB, 4% over the baseline, and the host held 15 MiB of it. After the reply the sum was 486 MiB at 1,000 tokens/s and 480 MiB at 200 tokens/s, 5% and 1% over. The renderer read 61 MiB before and 143 and 156 MiB after, no higher than in Stage 1. Reopen now asks the host for the thread, and the switch still took 65 ms.

Stage 4 moved `pnpm perf` onto the live pipeline. The faux provider streams the same reply through a real pi, the host and the page's port, into a 1,000-message transcript that pi forks from a seeded session file. Memory still counts Tondo's processes, not pi's. Medians of 3 runs on 2026-09-27, at 1,000 and 200 tokens/s: frame time p95 was 9.2 and 9.1 ms, p99 9.3 ms at both, no task took over 50 ms, and input to paint p95 was 24 ms at both. The longest time the view spent more than 40 px short of the end was 24 and 15.7 ms. With the transcript open the sum was 262 MiB, 3% over the baseline. After the reply it was 472 MiB at 1,000 tokens/s and 460 MiB at 200 tokens/s, 2% over and 3% under, and the renderer went from about 60 MiB to 148 and 151 MiB. Cold start took 223 ms. Opening the project, which starts pi, took 263 ms from the click to the transcript on screen. The port's round trip p95 was 0.1 ms, as in Stage 2, and snapshots of the 1,000- and 5,000-message threads took 1.5 and 7.0 ms, against Stage 2's 1.4 and 6.7 ms.

The first Stage 4 run missed the switch budget, with a median of 166 ms. Legend List renders its rows transparent until its opening scroll to the end finishes, and that scroll can't finish while the last row grows. A fallback timer ended it 150 to 170 ms after the switch. The harness checked only where the reply sat, so a reading could also count frames whose rows were still transparent. The timeline now ends the opening scroll once the view is within a screen of the end, and the harness also requires the reply to be opaque. The switch then took 53 ms. The 65 ms that Stages 1 and 2 recorded came from the position-only check. Whether those frames were transparent wasn't checked.

At 4x slowdown, one run at each rate gave frame time p95 of 33 and 25 ms, p99 of 42 and 33 ms, input to paint p95 of 48 ms at both, a longest task of 58 ms, a longest trail behind the end of 69 and 64 ms, and a switch of 232 ms. At 1,000 tokens/s that p95 is above Stage 1's 27 ms. The scenario changed with the pipeline: the stream comes from pi instead of a recording, and the composer keeps its text in a store. Which change costs the extra frame time wasn't measured.

Stage 5 added the sidebar, the command palette and the pool, and the harness now switches threads by clicking the sidebar. A third scenario streams the reply into 10 threads at once: the one on screen and 9 hidden ones, each with 3 follow-ups queued so they outlast it. Medians of 3 runs on 2026-09-28, at 1,000 and 200 tokens/s: frame time p95 was 9.8 and 9.5 ms, p99 10.2 ms at both, no task took over 50 ms, and input to paint p95 was 32 ms at both. The longest trail behind the end was 18.0 and 14.2 ms. With 10 threads streaming, frame time p95 was 10.0 ms, p99 10.2 ms, input to paint p95 24 ms and the longest trail 17.4 ms. The sum was 351 MiB with the transcript open and 485 MiB after, and the host held 28 and 30 MiB of it. Switching to a thread whose pi is running took 57 ms, cold start 225 ms, and opening a project 265 ms. Snapshots of the 1,000- and 5,000-message threads took 1.5 and 6.8 ms. A project with 500 pi sessions showed its newest in the sidebar 65 ms after the click on Add project. The session index's benchmark reads 500 session files of 20 messages each, 11 MB, in 14 ms, and lists them again unchanged in 2.2 ms.

Every Stage 5 run happened with the Mac's display off and its screen locked, not in the visible window the budgets call for, though frames still came every 8.3 ms. Stage 4's code, run the same night, measured frame time p95 of 9.9 ms and input to paint p95 of 32 ms at 1,000 tokens/s, against the 9.2 and 24 ms it recorded on 2026-09-27. So those two readings rose with the machine, not with Stage 5. Event Timing rounds durations to 8 ms, and 32 ms stands for anything from 28 to 36 ms.

Memory misses its budget. With the transcript open the sum was 282 MiB at 1,000 tokens/s, with runs of 275, 286 and 282, and 279 MiB at 200 tokens/s. That's 11% and 9.8% over the baseline of 254 MiB, and the limit is 10%. Stage 4's code read 261 and 262 MiB the same night, with its runs within 3 MiB of each other. After the reply the sums were 474 and 470 MiB, 2% over and 1% under. The renderer held 62 MiB with the transcript open, against about 60 in Stage 4, and the host 17 MiB against 16. Most of the rest is GPU memory. The GPU process rasterizes a layer in tiles as wide as the window, 2432 by 416 pixels at 2x, or 3.9 MiB each, and a tile whose area is one solid color costs nothing. The first Stage 5 build painted the sidebar into the page's own layer. The sidebar runs the window's full height, so no tile row beside it stayed one color, and `vmmap` counted 9 of those tiles where Stage 4 had 5. That build read 285 MiB. The sidebar now has a layer of its own, one 512 by 1600 tile of 3.1 MiB, and its menus render into the body, because the transform that gives the sidebar its layer would otherwise confine them to it. Ten seconds after the transcript opens, the GPU process's tiles take 25 to 27 MiB, against Stage 4's 22. The harness reads sooner, while the GPU process still holds about 13 MiB of tiles freed by repaints as the thread opened, two of them the sidebar's, against Stage 4's 2.7 MiB. Those tiles expire within 10 seconds, which would explain why Stage 5's readings spread across 11 to 14 MiB.

At 4x slowdown, one run at each rate gave frame time p95 of 32 and 25 ms, p99 of 40 and 33 ms, input to paint p95 of 48 and 40 ms, a longest task of 52 and 56 ms, a longest trail behind the end of 72 and 45 ms, and a switch of 245 ms.

After Stage 5, the sidebar and the header moved into layers that need fewer tiles, and memory came back under its budget. The sidebar's layer needed its 512 by 1600 tile because text and the right border kept every part of it from being one color. The border is now a layer 1 pixel wide. The controls at the top and the thread list each have a layer the size of their content, and the rest of the sidebar's layer is one color, which needs no tile. The header has a layer of its own too. In the page's layer it kept a 2432 by 416 tile row in use, and on its own it needs one 960 by 128 tile, so the page's layer is one color while a thread is open. When the harness reads, the GPU process's tiles take about 21 MiB instead of 36. Screenshots at 2x differ from Stage 5's only in the antialiasing of text, by 1 or 2 levels out of 255.

Medians of 3 runs on 2026-09-28, at 1,000 and 200 tokens/s: with the transcript open the sum was 272 and 271 MiB, 7% over the baseline at both, and after the reply 478 and 496 MiB, 3% and 4% over. The renderer held 63 MiB before and 161 and 179 MiB after, and the host 17 MiB. Frame time p95 was 9.1 and 9.0 ms, p99 9.3 ms, input to paint p95 24 ms, the longest trail 19 and 15 ms, the switch 64 ms and cold start 338 ms. Twelve runs of each build at 1,000 tokens/s, in alternating blocks of 3, put the saving at 15 MiB. With the transcript open the sum fell from 282.5 to 267.7 MiB. After the reply the sums were 509 and 500 MiB, and the renderer read 168 and 172 MiB, so the renderer's memory didn't move with the change.

These runs happened in a visible window, where Stage 5's happened with the display off. The Mac's main display is now an external 4K monitor at 1x and 240 Hz, and `pnpm perf` opens its window there. At 1x the window has a quarter of the pixels, and Stage 5's code read 251 MiB. For these runs a temporary change, not committed, opened the window on the built-in display, at 2x and 120 Hz like the baseline. The harness doesn't check which display it got. After the reply, readings ran higher in both builds than on the night of Stage 5: 509 MiB for Stage 5's code against the 474 it recorded then, and 168 MiB in its renderer against 146. In `footprint`'s categories, the renderer's extra over a run that read 149 MiB is V8 heap and PartitionAlloc pages. Cold start took about 290 ms in both builds, against Stage 5's 225, so that rise came with the conditions too.

Stage 6 put tool calls in cards. The transcript's 150 bash calls now show as closed cards of one line, and their results show inside them instead of as rows of their own. `pnpm perf` now fails unless the window is at 2x with frames 8.3 ms apart, and every run below was in a visible window on the built-in display. Medians of 3 runs on 2026-09-28, at 1,000 and 200 tokens/s: frame time p95 was 9.2 ms, p99 9.3 ms, no task took over 50 ms, input to paint p95 was 32 and 24 ms, and the longest trail behind the end 24 and 14.9 ms. With 10 threads streaming, p95 was 9.2 ms, p99 9.3 ms, input to paint 24 ms and the trail 28 ms. With the transcript open the sum was 276 and 271 MiB, 8.7% and 6.7% over the baseline, and after the reply 501 and 497 MiB, 8% and 5% over. The runs at 1,000 tokens/s read 276, 279 and 272 MiB with the transcript open, 0.3 to 7 MiB under the 279.4 MiB limit. The renderer held 64 MiB before and 169 and 174 MiB after. Twelve runs of each build at 1,000 tokens/s, Stage 5's and Stage 6's in alternating blocks of 3, read a median of 272.2 MiB (262.7 to 276.9) for Stage 5 and 275.0 MiB (269.4 to 281.1) for Stage 6 with the transcript open, and one of Stage 6's twelve went over the limit. The renderer read 63.6 and 63.8 MiB, so the 2.8 MiB between the medians, if it's real, is outside the renderer. A permutation test puts the chance of a gap that size from noise alone at about 0.19, so the runs don't tell it apart from noise. After the reply the medians were 508.3 and 504.5 MiB. Switching to a running thread took 65 ms, cold start 223 ms and opening a project 256 ms.

A new perf file, `e2e/diffs.perf.ts`, has pi's edit change every line of a file, then opens the edit's card, which loads @pierre/diffs and starts its pool on the way. The Long Tasks API reports only tasks over 50 ms. For a 2,500-line file, a 5,000-line diff with syntax colors, no task took over 50 ms, the rows showed 323 ms after the click, and the colors 2.7 s after it. At 4x slowdown one task took 202 ms. For a 5,000-line file, a 10,000-line diff that shows uncolored, the rows showed at 324 ms and no task took over 50 ms, or over 62 ms at 4x. Before diffs over 2,500 lines a side lost their colors, that diff took one task of 86 to 90 ms, and its colors came after 6.9 s. The task is the pool's message listener reading `event.data`: in a CPU profile, 61 ms of it was spent there, which is where Blink deserializes the colored rows, 11 ms went to garbage collection and 8 ms to rendering rows. In a probe, turning off the pool's word-level diff of each changed line brought the colors from 6.3 s to 1.7 s, and Shiki's WebAssembly engine was no faster than its JavaScript one. The harness now collects garbage in the page's workers too before a memory reading. The renderer read 106 MiB after the colored diff opened, against 43 MiB before, and 68 MiB after the uncolored one. A scratch probe with a 20-line diff, without collecting the workers' garbage, read 76 MiB with the pool running and 69 MiB with a pool of one worker, so each worker holds about 7 MiB.

Stage 7 added extension dialogs, toasts, widgets, a status line and the slash menu, none of which shows in the streaming scenario. Medians of 3 runs on 2026-09-29, at 1,000 and 200 tokens/s: frame time p95 was 9.2 ms, p99 9.3 ms, no task took over 50 ms, input to paint p95 was 24 ms at both, and the longest trail behind the end 23 and 14.5 ms. With 10 threads streaming, p95 was 9.3 ms, p99 10.0 ms, input to paint 32 ms and the trail 20 ms. With the transcript open the sum was 270 MiB at both rates, 6.3% over the baseline, with runs of 268 to 277 MiB. After the reply it was 506 and 496 MiB, 9.1% and 4.4% over. That leaves 4 MiB of headroom at 1,000 tokens/s. Stage 6's code read 501 MiB there in its own run, and a median of 504.5 MiB over twelve runs. The renderer held 64 MiB before and 170 and 175 MiB after. Switching to a running thread took 57 ms, cold start 245 ms and opening a project 256 ms. The diffs and the port measured as in Stage 6.

Stage 8 replaced the textarea with TipTap's plain Markdown editor and added file completion, prompt history and image attachments. The final `pnpm perf` run on 2026-10-02 passed all 17 tests in a visible window on the built-in display at 2x and 120 Hz. The approved, temporary window-placement override was removed afterward. Reports are in `.dev/perf/stage8-final-2026-10-02T16-38-43/`. Medians of three runs:

| Metric | 1,000 tok/s | 200 tok/s | 10 streaming threads |
|---|---|---|---|
| Frame p95 / p99 | 9.1 / 9.3 ms | 9.0 / 9.3 ms | 9.2 / 9.3 ms |
| Input to paint p95 | 32 ms | 32 ms | 24 ms |
| Longest time behind the end | 21 ms | 16.4 ms | 19.6 ms |
| Total footprint before / after | 277.5 / 503.6 MiB | 273.5 / 501.3 MiB | 366 / 506 MiB |
| Renderer footprint before / after | 67 / 176 MiB | 67 / 181 MiB | 89 / 154 MiB |

No streaming task took over 50 ms at normal speed. Switching to a running thread took 90 ms, cold start 306 ms and opening a project 305 ms. The port round trip p95 was 0.10 ms; snapshots of 1,000 and 5,000 messages took 1.5 and 6.5 ms. The 5,000-line colored diff showed rows in 331 ms and colors in 2.9 s; the 10,000-line uncolored diff showed rows in 332 ms. Neither had a task of 100 ms or more at normal speed.

The runner asserts timing budgets but only records memory. Against Stage 1 plus 10%, the single-thread limits are 279.4 MiB before streaming, 510.4 after 1,000 tok/s and 522.5 after 200 tok/s. The final medians pass, with only 1.9 MiB of headroom before the 1,000 tok/s reply. That scenario's individual runs ranged from 275.0 to 280.6 MiB before and 503.4 to 519.7 after; one crossed both limits. The earlier pre-image checkpoint, `.dev/perf/stage8-2026-10-02T15-03-55/`, had a 514 MiB after median and missed the limit. I initially treated its 17 passing tests as an all-budget pass. No A/B established a memory reduction between the checkpoints.

At 4x slowdown, which does not gate, frame p95 was 33 and 24 ms, p99 34 and 33 ms, and input p95 48 and 40 ms. The longest time behind the end was 109 and 43 ms, and the switch took 370 ms. The colored diff had one 219 ms task. These scenarios type text into the new composer but do not measure maximum-size image attachments.

Stage 9 added turn checkpoints and the diff panel. Its controlled run on 2026-10-02 passed all 17 automated tests but failed the manually checked memory budget. The window stayed on the built-in display at 2x and 120 Hz, with no display-placement override. Reports are in `.dev/perf/stage9-controlled-2026-10-02T21-58-26/`. Medians of three runs:

| Metric | 1,000 tok/s | 200 tok/s | 10 streaming threads |
|---|---|---|---|
| Frame p95 / p99 | 9.2 / 9.3 ms | 9.2 / 9.3 ms | 9.2 / 9.3 ms |
| Input to paint p95 | 32 ms | 24 ms | 24 ms |
| Longest time behind the end | 24 ms | 16.6 ms | 27.9 ms |
| Total footprint before / after | 281.77 / 510.44 MiB | 276.68 / 497.98 MiB | 376.52 / 504.02 MiB |
| Renderer footprint before / after | 67.69 / 176.81 MiB | 66.50 / 181.06 MiB | 91.39 / 154.13 MiB |

At 1,000 tok/s, the total before readings were 281.83, 274.30 and 281.77 MiB; after readings were 518.10, 510.44 and 507.19 MiB. The medians exceeded the fixed 279.4 and 510.4 MiB limits and blocked Stage 9. The before median at 200 tok/s passed, although its runs included one 281.38 MiB reading. No controlled memory comparison against main had yet attributed the misses to Stage 9. The follow-up below records the fix.

No normal-speed streaming task took over 50 ms. Switching to a running thread took 90.5 ms, cold start 235 ms and opening a project 256 ms. The port round trip p95 was 0.10 ms; snapshots of 1,000 and 5,000 messages took 1.5 and 6.8 ms. The 5,000-line colored diff showed rows in 332 ms and colors in 2.732 s; the 10,000-line uncolored diff showed rows in 339 ms. Neither had a task of 100 ms or more at normal speed.

At 4x slowdown, which does not gate, frame p95 was 26.0 and 24.8 ms, p99 34.4 and 33.3 ms, and input p95 48 and 40 ms at 1,000 and 200 tok/s. The longest time behind the end was 84.2 and 42.8 ms, and switching took 404.8 ms. The colored diff had one 205 ms task.

The earlier run in `.dev/perf/stage9-2026-10-02T21-16-02/` passed its memory medians but had an 87.5-second follow-scroll outlier. The user confirmed interacting with the app during that run. It is retained, but not used as the controlled acceptance result. Eleven traced comparisons, five on main and six on Stage 9, kept following with maximum lag of 20.5 ms. The controlled full run also kept its lag within budget without a scroll-code change. Interaction is not a proven cause because the original run did not log input events. The temporary diagnostic instrumentation was removed before the controlled full run.

### Stage 9 memory follow-up

On 2026-10-02, an approved three-run comparison of main and PR #14 found before-stream medians of 279.97 and 282.30 MiB. Main missed the limit too. This did not establish a checkpoint-specific regression.

The fix gives the empty-state prompt/button and composer separate compositor layers. DevTools showed 599×48 and 225×64 layers for the empty-state elements, and a 1652×392 layer around the composer rather than the wider footer. These are physical pixels at 2x. `vmmap` showed three 2432×416 raster tiles in the original empty window and none in the fixed window. Those tiles were still present immediately after opening the transcript in the original build. No waits were added to the performance harness.

The installed `@streamdown/code` 1.1.1 also retained every intermediate highlighted result. A diagnostic reply left 452 results with 40,522 tokens in its cache; clearing that cache released about 4.8 MiB of renderer footprint. The pnpm patch caps results at 128 and shares one highlighter per theme pair. Recomputed blocks keep their source and theme; no language support was removed.

A/B results compare the unchanged PR head, `096502e`, with the combined fix. Each build ran twelve times, in alternating blocks of three with the order reversed every other round. Both used the same category-capture instrumentation, visible windows on the built-in 2x/120 Hz display and no placement override. Values below are MiB, with ranges in parentheses:

| Reading | Original PR | Fix |
|---|---|---|
| Total before | 276.44 (272.97 to 282.12) | 266.92 (265.54 to 270.87) |
| Total after | 506.92 (497.26 to 513.55) | 504.57 (495.26 to 509.26) |
| Renderer after | 176.45 (174.56 to 180.27) | 172.89 (168.94 to 177.70) |

Before streaming, GPU footprint fell by 8.96 MiB, including a 5.39 MiB fall in IOSurface allocations. After streaming, renderer V8 pages fell by 3.13 MiB while GPU footprint was essentially unchanged. Exact two-sided permutation tests on the median differences, over all 2,704,156 partitions, gave p=0.00019 for total before and p=0.0061 for renderer after. The total-after difference gave p=0.083, so it is not a confident whole-app reduction. All twelve fixed-build memory readings passed both limits. No normal-speed task exceeded 50 ms; input p95 never exceeded 32 ms.

Per-run total footprint, in chronological order within each build:

| Run | Original before | Fix before | Original after | Fix after |
|---|---|---|---|---|
| 1 | 277.99 | 267.15 | 509.12 | 505.55 |
| 2 | 278.94 | 265.65 | 497.26 | 499.10 |
| 3 | 274.57 | 266.01 | 506.24 | 507.16 |
| 4 | 273.43 | 269.87 | 503.62 | 495.26 |
| 5 | 281.13 | 265.54 | 507.79 | 504.54 |
| 6 | 272.97 | 267.12 | 507.60 | 504.94 |
| 7 | 281.15 | 266.47 | 506.22 | 505.26 |
| 8 | 282.12 | 266.26 | 513.55 | 502.29 |
| 9 | 274.68 | 266.72 | 511.16 | 504.60 |
| 10 | 274.49 | 269.04 | 504.66 | 509.26 |
| 11 | 276.15 | 269.58 | 499.24 | 503.68 |
| 12 | 276.72 | 270.87 | 507.60 | 497.23 |

Artifacts are in `.dev/stage9-memory/attribute/`, `ab/` and `layers/`. The full acceptance run followed removal of the diagnostic instrumentation and passed 17 tests in 12.5 minutes. Reports are in `.dev/perf/stage9-memory-2026-10-02T23-37-51-876Z/`. Medians of three runs:

| Metric | 1,000 tok/s | 200 tok/s | 10 streaming threads |
|---|---|---|---|
| Frame p95 / p99 | 10.1 / 10.3 ms | 10.0 / 10.3 ms | 10.0 / 10.2 ms |
| Input to paint p95 | 32 ms | 32 ms | 32 ms |
| Longest time behind the end | 19.5 ms | 16.2 ms | 19.4 ms |
| Total footprint before / after | 266.24 / 505.63 MiB | 266.65 / 485.65 MiB | 350.57 / 505.48 MiB |
| Renderer footprint before / after | 66.75 / 173.86 MiB | 67.16 / 164.94 MiB | 89.89 / 151.81 MiB |

The unrounded single-thread medians pass the unchanged limits. At 1,000 tok/s the before samples were 266.24, 266.07 and 268.44 MiB; after samples were 496.37, 505.63 and 507.21 MiB. At 200 tok/s they were 266.65, 266.33 and 268.47 before, and 484.12, 485.65 and 492.58 after. Every individual reading passed too. The after-1,000-tok/s median leaves 4.77 MiB of headroom; input latency remains at its limit.

No normal-speed streaming or diff task exceeded 50 ms. Switching took 89.6 ms, cold start 241 ms and project open 264 ms. Port round-trip p95 was 0.10 ms; the 1,000-/5,000-message snapshots took 1.6/6.6 ms. The colored 5,000-line diff showed rows in 340 ms and colors in 2.715 s. The uncolored 10,000-line diff showed rows in 338 ms.

At informational 4x slowdown, frame p95 was 31.7/24.7 ms and p99 39.8/32.2 ms at 1,000/200 tok/s. Input p95 was 48/40 ms and lag 51.0/48.4 ms. Switching took 427.1 ms; the colored diff had one 203 ms task.

**Utility process layout.** See [Where pi runs](#where-pi-runs).

### Stage 10 terminal measurements

The full run in `.dev/perf/2026-10-03T01-56-03/` passed all 18 checks in 13.0 minutes, with no budget change. Streaming frame p95 stayed at 10.0–10.1 ms and p99 at 10.3 ms. Single-thread total footprint before/after was 267/507 MiB at 1,000 tok/s and 270/490 MiB at 200 tok/s. Both memory medians pass; the faster stream still has little headroom. Input p95 remains at its 32 ms limit. Cold start was 240 ms, switching 91 ms and port round-trip p95 0.10 ms.

After fixing terminal padding that clipped the final row, the repeated terminal gate in `.dev/perf/2026-10-03T02-16-20/` sent 50 MiB in 1.910, 1.886 and 1.893 seconds. None of the three native runs produced a long task, nor did the informational 4× run, which took 8.141 seconds. The PTY pauses against a 64 KiB acknowledgement window, and xterm parses 4,096-character chunks without routing output through React.

The native-process and provider-auth probes, the Linux build requirements, and verification limits are in the [Stage 10 report](plan.md#stage-10-report-2026-10-03).

### Stage 11 Git actions measurements

The final run in `.dev/perf/stage11-final-2026-10-03T04-16-58/` passed 18 automated checks in 13.0 minutes, but the manual memory gate failed. Those tests record memory without asserting its limit. The fixed after-1,000-tok/s limit is 510.4 MiB. The three readings were 521.584, 510.803 and 511.506 MiB; the median is 1.106 MiB over budget. Stage 11 is blocked, with no threshold change or retry to replace the failed run.

| Metric | 1,000 tok/s | 200 tok/s | 10 streaming threads |
|---|---|---|---|
| Frame p95 / p99 | 10.1 / 10.3 ms | 10.0 / 10.3 ms | 10.0 / 10.3 ms |
| Input-to-paint p95 | 32 ms | 32 ms | 32 ms |
| Total footprint before / after | 269.912 / 511.506 MiB | 273.037 / 497.600 MiB | 354.756 / 510.913 MiB |
| Renderer footprint before / after | 66.408 / 177.095 MiB | 66.501 / 176.173 MiB | 91.470 / 153.611 MiB |

The other single-thread memory medians pass their limits. Switching took 89.4 ms and cold start 250.6 ms. Port round-trip p95 was 0.10 ms; 1,000-/5,000-message snapshots took 1.6/6.6 ms. Terminal output sent 50 MiB in a median 1.893 seconds without a long task. No normal-speed streaming or diff task reached 100 ms. Input latency remains at its limit. At informational 4x slowdown, the colored diff had one 231 ms task.

The earlier run in `.dev/perf/stage11-2026-10-03T03-45-37/` passed memory with 272.459 MiB before and 508.038 MiB after at 1,000 tok/s. That build preceded the final missing-worktree cleanup and pooled-terminal guard fixes. It is not the final acceptance result. No controlled A/B against main has established whether the final excess comes from Stage 11 or measurement variation.

No dependencies were added. Git/`gh` run in the host. The renderer receives deduplicated status every two seconds for the visible checkout; GitHub PR status is cached for 30 seconds with a bounded cache. The ownership ledger and per-thread checkout routing are described in the [Stage 11 report](plan.md#stage-11-report-2026-10-03).

## Open questions

- **How do real screens compare?** The empty-window numbers come from a trivial hidden page, not a real app.
