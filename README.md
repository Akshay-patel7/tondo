# Tondo

A fast desktop app for the [pi](https://github.com/earendil-works/pi) coding agent.

Tondo is a GUI for pi, built from scratch. It drives the pi you already have installed, so your packages, extensions, skills, prompt templates, settings and model logins work the same way they do in the terminal.

**Status:** early. The app opens an empty window, and [docs/plan.md](docs/plan.md) lays out the rest of the build. [AGENTS.md](AGENTS.md) lists the commands.

## Goals

- **Performance first.** Long transcripts, many threads and fast token streams should stay smooth. Speed is designed in from the first commit.
- **Your pi setup carries over.** Tondo does not reimplement pi's configuration. pi loads it itself.
- **One window for the work.** Chat, tool output, diffs and session history, with a look inspired by [T3 Code](https://github.com/pingdotgg/t3code).

## How it will work

Each thread runs its own `pi --mode rpc` process in the project folder. Tondo talks to it through pi's [RPC protocol](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md), which is JSON lines over stdin and stdout.

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

## Known limits

Some of pi's terminal UI can't cross the RPC boundary (see [RPC extension UI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-extension-ui.md)):

- Extension UI built from terminal components (`ctx.ui.custom()`, custom headers, footers and editors) does not render.
- Custom tool renderers are terminal components, so Tondo draws its own tool cards.
- Built-in terminal commands such as `/settings` and `/login` do not run over RPC. Tondo needs its own screens for them.

## Open questions

[docs/stack.md](docs/stack.md) picks the stack and shows the evidence. It uses Electron and React with React Compiler, and runs one `pi --mode rpc` process per thread from an Electron utility process. Still open:

- Can React keep streaming markdown smooth? Framework benchmarks favor Solid, but nothing has measured a long reply streaming through the markdown renderer inside Electron. If React falls short, Solid is the fallback.
- How much memory do real pi setups use? The numbers so far are for bare pi with extensions, skills and context files turned off. The answer decides how many idle pi processes Tondo keeps alive.

## The name

A tondo is a circular painting or relief, a form that became popular in 15th-century Italy. The word comes from the Italian *rotondo*, meaning "round". Tondo is a round frame around pi.

## Credits

Built on [pi](https://github.com/earendil-works/pi) by Earendil Works. Performance ideas borrowed from [T3 Code](https://github.com/pingdotgg/t3code). Tondo is not affiliated with either project.

Some of Tondo's code is adapted from T3 Code, which is MIT licensed, Copyright (c) 2026 T3 Tools Inc. Each adapted file says which T3 file it came from in its header comment.

## License

[MIT](LICENSE)
