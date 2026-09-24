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
| Code highlighting | Shiki | 4.4.3 |
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
- Streaming changes one message at a time. With deltas committed once per animation frame, markdown parsing should take most of each frame, and that costs the same in any framework. This is an expectation, not a measurement (see [Open questions](#open-questions)).
- The framework's memory difference is a few MB. One pi process is 80 MB or more.
- T3 Code, the performance bar for Tondo, runs React 19.2 with React Compiler 1.0 (from `apps/web/package.json` at commit e67abcf7).

The libraries favor React, and they cover the hardest parts of the app. streamdown (4.4 million downloads a week), Legend List, Base UI and shadcn are React-only, and TipTap ships React and Vue bindings. Solid's closest markdown options are solid-markdown (14.7k downloads a week) and solid-streamdown (87 a week). Its main component library, Kobalte, is at 0.13, and Solid itself is partway to 2.0 (2.0.0-rc.9 is out). OpenCode's UI is Solid, which shows Solid works for an agent app, but more of it would have to be built by hand.

Solid is the fallback if React can't keep streaming smooth. It would cut framework time by about 30% and framework memory in half. The price is a hand-built markdown renderer and components.

The others:

- **Svelte 5** is close to Solid on speed, but TipTap has no Svelte binding, and Svelte projects can't use TypeScript 7 yet ([TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)).
- **Vue**'s fast Vapor mode is still a release candidate (3.6.0-rc.9) and has the same TypeScript 7 limit.
- **Preact** scores the same as React here and risks breaking React-only libraries.

## Libraries

- **@legendapp/list 3.4** for the transcript. T3 Code uses it, and it has props for chat (`maintainScrollAtEnd`, `maintainVisibleContentPosition`, `alignItemsAtEnd`, `onStartReached`; see the [chat example](https://legendapp.com/open-source/list/v3/react/examples/chat/)). Web support arrived in 3.0 (the changelog says "Feat: Web support", entry point `@legendapp/list/react`), but its README still describes it as React Native only. That mismatch is why @tanstack/react-virtual stays as the fallback. It has a [chat guide](https://tanstack.com/virtual/latest/docs/chat) that covers keeping the view anchored to the end.
- **streamdown 2.6** for markdown. It replaces react-markdown, which T3 Code uses, and is built for streaming. It splits text into blocks and [memoizes](https://streamdown.ai/docs/memoization) each one, so only the growing block re-renders. It also completes unterminated syntax while text is still arriving. Code highlighting comes from the separate @streamdown/code package.
- **Shiki 4.4** for code. @pierre/diffs is built on it, so code blocks and diffs highlight the same way. It ships a JavaScript regex engine as well as the default Oniguruma WebAssembly engine.
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

**Utility process layout.** See [Where pi runs](#where-pi-runs).

## Open questions

- **Can React keep streaming markdown smooth?** The benchmarks above favor Solid, but nothing has measured the case that matters here: a long reply streaming through streamdown inside Electron. A one-day test would settle it. Stream a 20,000-token reply through a React version and a Solid version and record frame times.
- **How much memory do real pi setups use?** All the pi numbers here have extensions, skills and context files turned off. The answer decides how many idle pi processes Tondo keeps alive.
- **How do real screens compare?** The empty-window numbers come from a trivial hidden page, not a real app.
