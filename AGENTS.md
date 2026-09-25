# Tondo

Tondo is a desktop app for the pi coding agent. Electron runs the window, React draws the UI, and a utility process runs pi in RPC mode. [docs/plan.md](docs/plan.md) is the stage-by-stage build plan. [docs/stack.md](docs/stack.md) records the stack and the measurements behind it.

T3 Code is the reference app. docs/plan.md pins the T3 commit its paths refer to. Clone it into a scratch folder outside this repo.

## Commands

pnpm 12.6.0 comes from `packageManager` in package.json, and Node 24.15.0 from `.tool-versions`.

| Command | What it does |
|---|---|
| `pnpm install` | Installs dependencies. Electron downloads its binary the first time it runs, or when you run `pnpm exec install-electron`. |
| `pnpm dev` | Runs the app with hot reload. |
| `pnpm dev:web` | Serves only the renderer with Vite, on port 5173 by default, so you can check it in Chrome. The fixture player stands in for pi. |
| `pnpm build` | Builds main, preload, host and renderer into `out/`. |
| `pnpm typecheck` | Runs tsc on the root config and on each layer's config. |
| `pnpm lint` | Runs oxlint. Warnings fail. |
| `pnpm format` | Formats with oxfmt. `pnpm format:check` only checks. |
| `pnpm test` | Runs the Vitest unit tests, `src/**/*.test.ts`. |
| `pnpm bench` | Runs the Vitest benchmarks, `src/**/*.bench.ts`. |
| `pnpm smoke` | Builds, launches the app, and fails on startup errors in Electron's log. |
| `pnpm e2e` | Builds, then drives the app with Playwright. Screenshots go to `test-results/`. |
| `pnpm perf` | Builds, then measures streaming against the performance budgets in docs/plan.md. It takes about 10 minutes and keeps the window on top, so ask before running it. Results go to `.dev/perf/<time>/`. |
| `pnpm fixtures` | Re-records `fixtures/` by running the pinned pi offline with the faux provider. |

CI runs `typecheck`, `lint`, `format:check`, `test`, `build`, `smoke` and `e2e` on macOS and Ubuntu (.github/workflows/ci.yml). `perf` stays local because its numbers depend on the machine. On Linux, smoke and e2e need a display, so CI wraps them in `xvfb-run`.

## Layers

| Folder | Runs in | May import |
|---|---|---|
| `src/shared` | anywhere | only `src/shared`. No DOM, Node or Electron APIs. |
| `src/main` | Electron's main process | `src/shared` |
| `src/preload` | the sandboxed preload | `src/shared` |
| `src/host` | a utility process | `src/shared` |
| `src/renderer` | the sandboxed renderer | `src/shared`, never `electron` |

- oxlint enforces the import rules (`.oxlintrc.json`).
- Each layer has its own tsconfig with an explicit `types` list. TypeScript 6 and later default `types` to `[]`, so a missing entry makes Node's globals disappear.
- Main stays out of the data path and never loads native modules. pi, git and terminals belong to the host.
- The preload hands the page a MessagePort and nothing else. Sandboxed preloads can't use ESM and get only a few Node modules, so it's CommonJS and fully bundled.
- Every IPC handler checks its sender.
- Main, preload and host build as CommonJS, and the renderer as ESM. Don't add `"type": "module"` to package.json: electron-vite would then emit the preload as `.mjs`, which a sandboxed preload can't load.
- The window stays locked down: context isolation and the sandbox on, Node integration off, pages served from `tondo://` with the CSP in `src/main/securityPolicy.ts`, and navigation, new windows and permission requests denied. `e2e/window.e2e.ts` tests all of it except context isolation and the sandbox, so keep it passing.

## App data and your pi setup

- Unpackaged runs keep app data in `.dev/userData`, with one running instance per profile. `TONDO_USER_DATA_DIR` overrides the folder, and smoke and e2e point it at temporary folders. Never run against `~/Library/Application Support/Tondo`.
- Leave `~/.pi/agent` alone. Dev and test runs of pi use a scratch `PI_CODING_AGENT_DIR`. Runs against the real one happen only at the plan's measurement points, and only after asking.
- Stop only processes you started, by the PID or process group you captured. Never kill by name or pattern. macOS has no `timeout` command, so scripts use Node deadlines.

## Verifying

- Tests wait for events, never for time. T3's AGENTS.md puts it plainly: "A test that needs a timeout to pass is wrong."
- Tests that need pi run the real pi offline with pi-ai's faux provider. docs/plan.md's "Test layers" section has the command.
- UI claims come with screenshots you open and look at.
- The build fails if the React Compiler skips a function or compiles nothing. Fix the code rather than loosening `panicThreshold`.
- The performance budgets in docs/plan.md are fixed. Missing one stops the stage. Don't lower the bar to finish.

## Landing work

- A stage lands after the user OKs its report. Until then its work stays uncommitted.
- After the OK, commit on a branch, push it and open a pull request. The user merges. Nothing else goes to git or GitHub without a go-ahead.
- Commits are signed, one concern each, with a Conventional Commit subject and no body.
- Dependencies use exact versions. pnpm runs a dependency's build script only if `allowBuilds` in `pnpm-workspace.yaml` allows it, and it installs only versions published at least a day ago.
- Code adapted from T3 Code keeps T3's copyright notice in a header comment, and the README's credits mention it.
