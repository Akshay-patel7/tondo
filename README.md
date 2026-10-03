# Tondo

A fast desktop app for the [pi](https://github.com/earendil-works/pi) coding agent.

Tondo is a GUI for pi, built from scratch. It drives the pi you already have installed, so your packages, extensions, skills, prompt templates, settings and model logins work the same way they do in the terminal.

**Status:** early. You add project folders, and the sidebar lists each one's pi sessions, including ones you started in pi's own terminal interface. In any thread you can send prompts, stop, steer, queue follow-ups, and pick the model and thinking level, and a command palette finds threads, projects and actions. Each tool call shows as a card that opens to its output: a shell command's latest lines while it runs, and highlighted diffs for edits. Your extensions' dialogs, notifications, status lines and widgets show in the app, and typing `/` lists pi's commands, prompt templates and skills along with Tondo's versions of pi's built-in commands. The TipTap composer keeps Markdown literal, completes `@` file paths, recalls prompts with Up, and accepts images by paste, drop or the attachment button. Text and image drafts stay with their thread across restarts. The Changes panel shows per-turn Git checkpoints with a file filter and highlighted diffs. Each thread also has a resizable terminal drawer. "Sign in to a provider" opens pi's interactive UI for `/login` and `/logout`, with an explicit model refresh afterward. The Git toolbar lists and switches branches, creates worktree threads, stages and commits changes, pushes branches, and creates or opens pull requests through `gh`. Stage 11 is blocked on its memory budget. Its [report](docs/plan.md#stage-11-report-2026-10-03) records the passing functional checks and the failed final memory measurement. [AGENTS.md](AGENTS.md) lists the commands.

## Goals

- **Performance first.** Long transcripts, many threads and fast token streams should stay smooth. Speed is designed in from the first commit.
- **Your pi setup carries over.** Tondo does not reimplement pi's configuration. pi loads it itself.
- **One window for the work.** Chat, tool output, diffs and session history, with a look inspired by [T3 Code](https://github.com/pingdotgg/t3code).

## How it will work

Each thread runs its own `pi --mode rpc` process in the project folder or its managed worktree. Tondo talks to it through pi's [RPC protocol](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md), which is JSON lines over stdin and stdout.

- pi finds your configuration in `~/.pi/agent` and in project folders the same way it does in the terminal, so there is nothing to import.
- A crash or hang in one thread's extensions stays inside that thread's process.
- Processes start when a thread needs one and stop when it goes idle. For scale: a bare pi 0.87.1 RPC process with no extensions answered its first command in 120 to 180 ms and used 134 to 141 MB of memory on one Mac. Extensions add to both.
- Extension dialogs (select, confirm, input, editor) and the notifications, status lines and widgets that pi forwards over RPC become native UI.

## Performance plan

These rules come from studying how T3 Code stays fast:

- Render only the messages on screen, even in very long transcripts.
- Batch streamed text before it reaches the UI instead of re-rendering on every token.
- Keep heavy work such as diffing off the UI thread.
- Keep pi processes out of the UI process.
- Send the UI only the state of the thread on screen.
- No animations that repaint continuously.

## Git actions

Local threads share the project's checkout. **New worktree** creates a branch and a new thread in `<userData>/worktrees/<thread-id>`. It starts from a committed base, without copying uncommitted files. pi, its terminal, file completion and turn checkpoints all use that checkout. Existing threads do not move between local and worktree modes.

Each write needs an explicit action. **Commit** stages all changed and nonignored untracked files in the checkout, then runs Git with your hooks and signing configuration. **Push** never force-pushes. **Create PR** requires the branch to be pushed first and uses the GitHub host from the remote URL. Missing or logged-out `gh` is reported in the toolbar. PR links open in your browser. Ahead/behind counts use local tracking refs; Tondo does not fetch, pull or merge automatically.

Branch changes are blocked while pi is starting or working in the same checkout, or while one of its Tondo terminals remains open. Git actions run one at a time. Sending during an action restores the prompt to the draft with an error, so you can retry afterward. External terminals and editors are not locked by Tondo.

**Remove worktree** forgets its thread and deletes the checkout, but keeps its branch and external pi session file. Dirty and ignored files require a separate permanent-deletion confirmation. A session stored inside the checkout blocks removal. Startup cleanup checks only Tondo's recorded, ownerless worktrees. It preserves dirty folders, ignored files, changed branches, symlinks and folders still used as projects. Archiving a thread does not remove its worktree.

## Known limits

Some of pi's terminal UI can't cross the RPC boundary (see [RPC extension UI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-extension-ui.md)):

- Extension UI built from terminal components (`ctx.ui.custom()`, custom headers, footers and editors) does not render.
- Custom tool renderers are terminal components, so Tondo draws its own tool cards.
- pi's built-in commands, such as `/model` and `/session`, run only in its terminal UI. Tondo runs its own versions of most of them. `/login` and `/logout` open an interactive pi in the terminal drawer. The rest, such as `/tree` and `/share`, say they aren't in Tondo yet.
- pi doesn't tell a client when an extension withdraws a dialog with an abort signal, so the dialog stays open in Tondo, and answering it does nothing. Dialogs that time out close on time.

Images send only when pi is idle. pi 0.87.1's queue APIs return text without attachments, so Tondo keeps images in the draft while pi works instead of risking their loss on Escape or Alt+Up. Local built-ins and known extension commands leave images in the draft. Attach up to 4 PNG, JPEG, GIF or WebP images, at most 5 MiB and 16 million pixels each, with a 10 MiB total. File completion lists at most 10,000 tracked and nonignored untracked paths in a Git project; it inserts literal paths, never file contents.

pi doesn't lock session files. If the same session is open in terminal pi and in Tondo at once, both append to it and their entries interleave.

A terminal stays alive when you switch threads. Close stops its shell and the jobs still descended from it; quitting the app closes its terminals first. Terminal history stays in memory, not on disk. There is one terminal per thread, so close its shell before opening provider sign-in there. The sign-in terminal uses `--no-session` and the same pi profile as the chat processes. After changing credentials, use Refresh models in that drawer, or `/reload` in each other open thread, while pi is idle. Development runs sign in only to the scratch profile under `.dev/userData/pi-agent`, not your real pi profile.

## Stack

[docs/stack.md](docs/stack.md) picks the stack and shows the evidence. It uses Electron and React with React Compiler, and runs one `pi --mode rpc` process per thread from an Electron utility process. Framework benchmarks favor Solid over React, so before building any other UI, Tondo measured a 20,000-token reply streaming into a 1,000-message transcript. React stayed within every [performance budget](docs/plan.md#performance-budgets). On a real pi setup with 12 packages, each pi answered about 1.4 s after it started and held about 210 MiB once idle. Those numbers decide how many idle pi processes Tondo keeps alive.

## The name

A tondo is a circular painting or relief, a form that became popular in 15th-century Italy. The word comes from the Italian *rotondo*, meaning "round". Tondo is a round frame around pi.

## Credits

Built on [pi](https://github.com/earendil-works/pi) by Earendil Works. Performance ideas borrowed from [T3 Code](https://github.com/pingdotgg/t3code). Tondo is not affiliated with either project.

Some of Tondo's code is adapted from T3 Code, which is MIT licensed, Copyright (c) 2026 T3 Tools Inc. Each adapted file says which T3 file it came from in its header comment. The composer's plain Markdown editor, prompt-history behavior, image thumbnails and enlarged preview follow T3's composer. Hidden-ref checkpoints and sparse-index handling follow T3's GitVcsDriver. Terminal history query filtering and drawer resizing follow T3's terminal manager and drawer. Git status, explicit-host GitHub requests and conservative worktree cleanup follow T3's GitVcsDriverCore, VcsStatusBroadcaster, GitHubPullRequestCli and storageCleanup.

Tondo carries a [patch](patches/@streamdown__code@1.1.1.patch) to [@streamdown/code](https://github.com/vercel/streamdown), which is Apache-2.0 licensed. It shares themed highlighters and bounds the cache of highlighted results.

## License

[MIT](LICENSE)
