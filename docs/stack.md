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
| Diffs | @pierre/diffs with its worker pool | 1.4.3 |
| Composer | A textarea first, then TipTap once the composer needs @file and /command chips | @tiptap/react 3.31.3 |
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
- **streamdown 2.6** for markdown. It replaces react-markdown, which T3 Code uses, and is built for streaming. It splits text into blocks and [memoizes](https://streamdown.ai/docs/memoization) each one, so only the growing block re-renders. It also completes unterminated syntax while text is still arriving. Code highlighting comes from the separate @streamdown/code package. Model output is untrusted, and streamdown 2.6.0 sanitizes it with rehype-sanitize and GitHub's schema. That drops `script`, `style` and `iframe` elements, `on*` attributes, and `javascript:` and `data:` URLs. Links open only after a confirmation dialog, which is on by default. Tondo's CSP (`img-src 'self'`) blocks remote images.
- **Shiki 3.23** for code, because @streamdown/code 1.1.1 depends on `shiki ^3.19.0`. Shiki 4.4.3 is the latest. @pierre/diffs is built on Shiki too and accepts 3 or 4 (`^3.0.0 || ^4.0.0` in 1.4.3 and 1.5.1), so code blocks and diffs can share one copy and highlight the same way. Shiki ships a JavaScript regex engine as well as the default Oniguruma WebAssembly engine. @streamdown/code uses the JavaScript one, so Tondo's CSP needs no `'wasm-unsafe-eval'`. In the built app, code highlighted with no WebAssembly requests and no CSP errors (checked 2026-09-25).
- **@pierre/diffs 1.4** for diffs. T3 Code uses it. Its worker pool (`@pierre/diffs/worker`) runs syntax highlighting for diffs and files in web workers, off the UI thread.
- **TipTap 3** for the composer, once it needs @file and /command chips. T3 Code uses it. A textarea is enough before then.
- **Base UI 1.8, shadcn 4.21 and Tailwind CSS 4.3** for components and styling. T3 Code uses Base UI and Tailwind, and shadcn can generate its components on Base UI. Install `@base-ui/react`. `@base-ui-components/react` is the deprecated old name.
- **zustand 5** for state. T3 Code uses it. Its stores also work outside React, so the MessagePort handler can write to them directly. Streamed text should be buffered and committed once per animation frame.
- **@xterm/xterm 6 and node-pty 1.1** for a terminal, later. T3 Code's server uses node-pty. node-pty is built on Node-API, so the same binary works in Node and in Electron. Its prebuilt macOS binary ran `/bin/echo` from Electron 44.4.5's main process and from a utility process with no rebuild. There are no prebuilt Linux binaries, so it compiles with node-gyp there. The 1.1.0 package ships its macOS `spawn-helper` without the execute bit, so every spawn fails with `posix_spawnp failed` until a postinstall step runs `chmod +x` on it ([node-pty#850](https://github.com/microsoft/node-pty/issues/850)). 1.2.0-beta.15 packs it correctly, but `latest` on npm is still 1.1.0.
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

**Utility process layout.** See [Where pi runs](#where-pi-runs).

## Open questions

- **How do real screens compare?** The empty-window numbers come from a trivial hidden page, not a real app.
