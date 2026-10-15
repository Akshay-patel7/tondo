# Tondo

A fast desktop app for the [pi](https://github.com/earendil-works/pi) coding agent.

Tondo is a GUI for pi, built from scratch. It drives the pi you already have installed, so your packages, extensions, skills, prompt templates, settings and model logins work the same way they do in the terminal.

**Status:** early. You add project folders, and the sidebar lists each one's pi sessions, including ones you started in pi's own terminal interface. In any thread you can send prompts, stop, steer, queue follow-ups, and pick the model and thinking level, and a command palette finds threads, projects and actions. Each tool call shows as a card that opens to its output: a shell command's latest lines while it runs, and highlighted diffs for edits. Your extensions' dialogs, notifications, status lines and widgets show in the app, and typing `/` lists pi's commands, prompt templates and skills along with Tondo's versions of pi's built-in commands. The TipTap composer keeps Markdown literal, completes `@` file paths, recalls prompts with Up, and accepts images by paste, drop or the shared attachment picker. Text and image drafts stay with their thread across restarts. The Changes panel shows per-turn Git checkpoints with a file filter and highlighted diffs. Each thread also has a resizable terminal drawer. "Sign in to a provider" opens pi's interactive UI for `/login` and `/logout`, with an explicit model refresh afterward. The header's Git menu lists and switches branches, creates worktree threads, stages and commits changes, pushes branches, pulls them by fast-forward, and creates or opens pull requests through `gh`. Light and dark themes follow your system or your choice in Settings, which also picks which pi runs, how many pi processes stay running, and the app's shortcuts. When pi is missing, too old or not signed in to a provider, the window shows how to fix it. Tondo installs from a macOS dmg or zip (arm64 and x64) or a Linux deb or AppImage, and updates itself from GitHub Releases. The macOS builds aren't signed or notarized yet. The [Stage 12 report](docs/plan.md#stage-12-report-2026-10-10) records the redesign and its checks. [AGENTS.md](AGENTS.md) lists the commands.

## Install

Builds come from the project's GitHub Releases.

**macOS.** Until Tondo has a Developer ID, its builds are ad-hoc signed, so Gatekeeper blocks a downloaded copy. After you move Tondo to Applications, this command removes the quarantine flag macOS put on the download, which lets it open:

```sh
xattr -dr com.apple.quarantine /Applications/Tondo.app
```

**Linux, deb.** It installs to `/opt/Tondo`. On Ubuntu 24.04 and later it's designed to add an AppArmor profile that keeps Chromium's sandbox on. That part hasn't been tried on a real Ubuntu host yet.

**Linux, AppImage.** Ubuntu 24.04 and later block unprivileged user namespaces through AppArmor. The AppImage's launcher checks for them and, when they're blocked, starts Tondo with `--no-sandbox`. Use the deb if you want the sandbox.

### Updates

Tondo checks GitHub Releases at launch and every 6 hours, downloads an update in the background, and installs it when you quit. A notification offers to restart into it sooner. The check sends no usage data. Set `TONDO_DISABLE_UPDATES=1` to turn checks off.

- **AppImage:** tested from 0.0.1 to 0.0.2 against a local server. It downloaded only the changed blocks (162 KB of 117 MB), replaced the file when the app quit, and the next launch reported it was up to date.
- **deb:** tested the same way. On quit it runs `dpkg -i` through pkexec, or a similar tool, so a desktop asks for your admin password. The test ran in a container with passwordless `sudo`; the pkexec prompt is not yet verified.
- **macOS:** auto-update needs signed builds, so it doesn't work yet.

## Goals

- **Performance first.** Long transcripts, many threads and fast token streams should stay smooth. Speed is designed in from the first commit.
- **Your pi setup carries over.** Tondo does not reimplement pi's configuration. pi loads it itself.
- **One window for the work.** Chat, tool output, diffs and session history, with a look inspired by [T3 Code](https://github.com/pingdotgg/t3code).

## How it will work

Each thread runs its own `pi --mode rpc` process in the project folder or its managed worktree. Tondo talks to it through pi's [RPC protocol](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md), which is JSON lines over stdin and stdout.

- pi finds your configuration in `~/.pi/agent` and in project folders the same way it does in the terminal, so there is nothing to import.
- A crash or hang in one thread's extensions stays inside that thread's process.
- Processes start when a thread needs one and stop when it goes idle. For scale: a bare pi 0.87.1 RPC process with no extensions answered its first command in 120 to 149 ms on one Mac, with a footprint of 80 to 86 MB and an RSS of 125 to 131 MB ([measurements](docs/stack.md#measurements)). Extensions add to both.
- Extension dialogs (select, confirm, input, editor) and the notifications, status lines and widgets that pi forwards over RPC become native UI.

## Performance plan

These rules come from studying how T3 Code stays fast:

- Render only the messages on screen, even in very long transcripts.
- Batch streamed text before it reaches the UI instead of re-rendering on every token.
- Keep heavy work such as diffing off the UI thread.
- Keep pi processes out of the UI process.
- Send the UI only the state of the thread on screen.
- No animations that repaint continuously.

## Setup and settings

Tondo shows a problem with pi where it happens. If it can't find pi, or finds one older than 0.87.1, the thread shows how to install or update pi, with Choose pi… and Check again. If pi has no provider credentials, the thread offers a sign-in terminal, and closing that terminal restarts the thread's pi so the new models show up. A project whose `.pi` settings need trust asks before pi starts, and Tondo remembers the answer.

A new thread opens its composer immediately but stays out of the sidebar until you type a message or attach an image. Unsent drafts stay with their threads across navigation and restart.

Settings opens with ⌘, (Ctrl+, on Linux), from the command palette, with `/settings`, or with the gear in the sidebar. Escape goes back. It has five sections:

- **Appearance:** System, Light or Dark, with Default, Slate, Ocean or Rose colors. Each palette has light and dark versions. Expand thinking sections opens every section by default, including past replies. It starts off, and individual sections can still be toggled.
- **pi:** the version and path in use. Choose a pi, go back to the one on your PATH, open pi's settings files, or review and apply pi and package updates.
- **Accounts:** the providers pi is signed in to and how each one signs in, read from pi's `auth.json`. Tokens are never shown. When the thread on screen has the usage line that pi-claude-subscription-connector publishes, it shows here too. Sign in with Claude opens the sign-in terminal straight on Anthropic; Sign in to a provider opens pi's general sign-in menu. The header offers sign-in only while no provider is configured.
- **Threads:** how many pi processes may run at once (1 to 12, default 4), and how many idle minutes pass before a hidden thread's pi stops (1 to 240, default 10). Changes apply at once.
- **Shortcuts:** rebind or turn off the app shortcuts, with conflicts refused. The composer and dialog keys are fixed, because they follow pi's terminal UI.

Tondo saves these in `settings.json` in its app data folder.

Pi and package updates are separate from Tondo's own updater. Tondo checks pi and global pi packages at startup unless pi is offline. An available-update button under the composer opens Settings > pi. **Check for updates** also includes the current thread's project packages when the project is trusted. This explicit check contacts package registries and Git remotes even in offline mode. Each update shows the installed and available versions and asks for confirmation. Pinned npm versions and Git refs stay pinned; local packages and separately managed marketplace plugins are not updated.

Updating requires all threads to be idle and all integrated terminals to be closed. Tondo stops idle pi processes, installs the reviewed version or Git commit, and resumes the visible thread on its saved session. Other threads resume when opened. Drafts remain editable, but sending and model changes wait for the update to finish. Package declarations and resource filters stay unchanged. Git packages with local edits or files that pi would clean are refused, except for `node_modules`, whose dependencies pi reinstalls. Third-party package installs can run their install scripts. If pi's own package manager cannot safely target its installation, Tondo shows that it needs a manual update.

Everything works from the keyboard. Tab moves between the sidebar, the transcript, the composer and the panels. In the sidebar and the Git menu, the arrow keys, Home and End move, and Shift+F10 opens a row's menu. Escape closes a panel and puts focus back where it was. Every control has a name for screen readers.

## Git actions

The header's **Commit & push** button commits and then pushes; its chevron opens the menu with every other Git action, and the pill under the composer shows the checkout, its changes and how far it is ahead or behind. If the branch has a PR, the pill ends with a `PR 123` link that opens it in your default browser. Local threads share the project's checkout. **New worktree** creates a branch and a new thread in `<userData>/worktrees/<thread-id>` by default. Settings → Threads → Worktree location lets you choose a different parent folder or restore the default. This applies only to new worktrees; existing worktrees stay in their original folders, including after a restart. It starts from a committed base, without copying uncommitted files. pi, its terminal, file completion and turn checkpoints all use that checkout. Existing threads do not move between local and worktree modes.

Each write needs an explicit action. **Commit** stages all changed and nonignored untracked files in the checkout, then runs Git with your hooks and signing configuration. **Push** never force-pushes. **Pull** fetches the branch's upstream and only fast-forwards. A branch that has diverged stays as it is for you to merge or rebase, and Git refuses to overwrite uncommitted changes. **Create PR** requires the branch to be pushed first and uses the GitHub host from the remote URL. Missing or logged-out `gh` is reported in the Git menu. PR links open in your browser. Ahead/behind counts use local tracking refs, which a pull or push updates; Tondo does not fetch, pull or merge automatically.

The header's Changes button counts text lines added and removed by the latest turn once its checkpoint is ready, without needing to open the panel. Choosing an older turn in the panel does not change those counts. Git supplies the counts even for files too large to preview. Binary files add no text lines. An unfinished or unavailable turn never shows a false zero.

Branch changes are blocked while pi is starting or working in the same checkout, or while one of its Tondo terminals remains open. A pull is blocked while pi is starting or working there too, but open terminals don't block it. Git actions run one at a time. Sending during an action restores the prompt to the draft with an error, so you can retry afterward. External terminals and editors are not locked by Tondo.

**Remove worktree** deletes the checkout but keeps its branch, thread and external pi session file. Dirty and ignored files require a separate permanent-deletion confirmation. A session stored inside the checkout blocks removal. Startup cleanup checks only Tondo's recorded, ownerless worktrees. It preserves dirty folders, ignored files, changed branches, symlinks and folders still used as projects.

**Delete thread** asks for confirmation, then removes the thread, its saved draft and its associated pi session files. The session no longer appears in pi's `/resume` picker. Stop active work before deleting. For a managed worktree, use **Remove worktree** first, then delete the retained thread separately; Delete never removes a checkout or branch.

## Known limits

Some of pi's terminal UI can't cross the RPC boundary (see [RPC extension UI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-extension-ui.md)):

- Extension UI built from terminal components (`ctx.ui.custom()`, custom headers, footers and editors) does not render.
- Custom tool renderers are terminal components, so Tondo draws its own tool cards.
- pi's built-in commands, such as `/model` and `/session`, run only in its terminal UI. Tondo runs its own versions of most of them. `/login` and `/logout` open an interactive pi in the terminal drawer, and `/login <provider>` opens it straight on that provider's menu. The sign-in drawer opens tall enough to show pi's whole `/login` list. The rest, such as `/tree` and `/share`, say they aren't in Tondo yet.
- pi doesn't tell a client when an extension withdraws a dialog with an abort signal, so the dialog stays open in Tondo, and answering it does nothing. Dialogs that time out close on time.

The paperclip's **Attach files** picker accepts images and other files in one selection. PNG, JPEG, GIF and WebP files become image attachments. Every other file becomes an original absolute path in the draft. pi can read those files with its tools, including files outside the project. Tondo does not copy or convert non-image files. Moving or deleting a file breaks its reference, and reading binary formats such as PDFs depends on pi's available tools. Edit or delete a path in the composer to change the references. Non-image files use the picker, not paste or drop.

Images send only when pi is idle. pi 0.87.1's queue APIs return text without attachments, so Tondo keeps images in the draft while pi works instead of risking their loss on Escape or Alt+Up. Local built-ins and known extension commands leave images in the draft. Attach up to 4 PNG, JPEG, GIF or WebP images, at most 5 MiB and 16 million pixels each, with a 10 MiB total. File completion lists at most 10,000 tracked and nonignored untracked paths in a Git project; it inserts literal paths, never file contents.

pi doesn't lock session files. If the same session is open in terminal pi and in Tondo at once, both append to it and their entries interleave.

A terminal stays alive when you switch threads. Close stops its shell and the jobs still descended from it; quitting the app closes its terminals first. Terminal history stays in memory, not on disk. There is one terminal per thread, so close its shell before opening provider sign-in there. The sign-in terminal uses `--no-session` and the same pi profile as the chat processes. After changing credentials, use Refresh models in that drawer, or `/reload` in each other open thread, while pi is idle. Development runs sign in only to the scratch profile under `.dev/userData/pi-agent`, not your real pi profile.

On Linux, no app shortcut works while the terminal has focus: Ctrl+K, Ctrl+N, Ctrl+1 to Ctrl+9 and the rest go to the shell. The macOS app menu has no Settings… item yet. Use ⌘, or the gear. Screen-reader names are checked automatically, but VoiceOver and Orca haven't been tried.

macOS builds aren't signed with a Developer ID or notarized, so Gatekeeper blocks them until you clear the quarantine flag, and they can't update themselves. On Ubuntu 24.04 and later the AppImage runs without Chromium's sandbox. The app icon is provisional.

## Stack

[docs/stack.md](docs/stack.md) picks the stack and shows the evidence. It uses Electron and React with React Compiler, and runs one `pi --mode rpc` process per thread from an Electron utility process. Framework benchmarks favor Solid over React, so before building any other UI, Tondo measured a 20,000-token reply streaming into a 1,000-message transcript. React stayed within every [performance budget](docs/plan.md#performance-budgets). On a real pi setup with 12 packages, each pi answered about 1.4 s after it started and held about 210 MiB once idle. Those numbers decide how many idle pi processes Tondo keeps alive.

## The name

A tondo is a circular painting or relief, a form that became popular in 15th-century Italy. The word comes from the Italian *rotondo*, meaning "round". Tondo is a round frame around pi.

## Credits

Built on [pi](https://github.com/earendil-works/pi) by Earendil Works. Performance ideas borrowed from [T3 Code](https://github.com/pingdotgg/t3code). Tondo is not affiliated with either project.

Some of Tondo's code is adapted from T3 Code, which is MIT licensed, Copyright (c) 2026 T3 Tools Inc. Each adapted file says which T3 file it came from in its header comment. The composer's plain Markdown editor, prompt-history behavior, image thumbnails and enlarged preview follow T3's composer. Hidden-ref checkpoints and sparse-index handling follow T3's GitVcsDriver. Terminal history query filtering and drawer resizing follow T3's terminal manager and drawer. Git status, explicit-host GitHub requests and conservative worktree cleanup follow T3's GitVcsDriverCore, VcsStatusBroadcaster, GitHubPullRequestCli and storageCleanup. The Settings page's number field follows T3's number-field component. Packaging follows T3's build-desktop-artifact script: node-pty's per-architecture file exclusions and electron-builder's pnpm detection. The smoke test, for both the built and the packaged app, follows T3's desktop smoke test.

The components in `src/renderer/ui` are adapted from [shadcn/ui](https://github.com/shadcn-ui/ui)'s Base UI style, which is MIT licensed. They build on [Base UI](https://github.com/mui/base-ui) (MIT), and the icons are [Lucide](https://github.com/lucide-icons/lucide) (ISC). The `tondo/no-restyle` lint rule follows [@shadcn/lint](https://github.com/shadcn-ui/lint)'s `no-restyle` rule.

Tondo carries a [patch](patches/@streamdown__code@1.1.1.patch) to [@streamdown/code](https://github.com/vercel/streamdown), which is Apache-2.0 licensed. It shares themed highlighters and bounds the cache of highlighted results.

## License

[MIT](LICENSE)
