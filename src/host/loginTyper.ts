// Types "/login <provider>" into a fresh sign-in pi so it opens on that
// provider's auth-method menu. pi turns bracketed paste on when its terminal
// UI starts, but its slash commands exist only later: an Enter before then
// puts the text back and shows a startup notice, so the typer presses Enter
// again until pi takes the command. pi repeats an old notice when it clears
// the screen to redraw everything, so a notice in such a redraw doesn't count:
// an extra Enter would pick the first option of the menu pi opened.

/** pi turns bracketed paste on as its terminal UI starts. */
const READY = "\u001b[?2004h";
const NOTICE = "Startup is still in progress";
/** pi's terminal UI starts a full redraw by clearing the screen. */
const SCREEN_CLEAR = "\u001b[2J";
const QUIET_MS = 250;
const SETTLE_MS = 1_500;
const MAX_ENTERS = 40;
const GIVE_UP_MS = 20_000;

/** CSI, OSC, DCS and SS3 sequences: what xterm sends on its own and pi draws with. */
const ESCAPES =
  // oxlint-disable-next-line eslint/no-control-regex -- these are terminal protocol introducers.
  /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\u0007|\u001b\\)|P[\s\S]*?\u001b\\|O[\s\S])/g;

/** Output Tondo keeps after an Enter, enough to find the startup notice. */
const KEPT_CHARS = 64 * 1024;

export function withoutEscapes(data: string): string {
  return data.replace(ESCAPES, "");
}

type Phase =
  /** Watching pi's output for READY. */
  | "waiting"
  /** The command is typed, and Enter comes next. */
  | "typed"
  /** Enter was pressed, and the output since says whether pi took it. */
  | "entered"
  | "done";

export class LoginTyper {
  private readonly provider: string;
  private readonly write: (data: string) => void;
  private phase: Phase = "waiting";
  /** While waiting, the end of the output, in case READY splits across chunks. After an Enter, the output since. */
  private seen = "";
  private enters = 0;
  private quiet: ReturnType<typeof setTimeout> | undefined;
  private settle: ReturnType<typeof setTimeout> | undefined;
  private giveUp: ReturnType<typeof setTimeout> | undefined;

  constructor(provider: string, write: (data: string) => void) {
    this.provider = provider;
    this.write = write;
  }

  output(data: string): void {
    switch (this.phase) {
      case "waiting": {
        const text = this.seen + data;
        if (!text.includes(READY)) {
          this.seen = text.slice(-(READY.length - 1));
          return;
        }
        this.seen = "";
        this.giveUp = setTimeout(() => this.stop(), GIVE_UP_MS);
        this.type(`/login ${this.provider}`, "typed");
        return;
      }
      case "entered":
        this.seen = (this.seen + data).slice(-KEPT_CHARS);
        this.waitForQuiet();
        return;
      case "typed":
        this.waitForQuiet();
        return;
      case "done":
        return;
    }
  }

  /** What the page writes. Anything but escape sequences is you typing, and the typer leaves pi to you. */
  input(data: string): void {
    if (withoutEscapes(data).length > 0) this.stop();
  }

  stop(): void {
    this.phase = "done";
    clearTimeout(this.quiet);
    clearTimeout(this.settle);
    clearTimeout(this.giveUp);
  }

  private type(data: string, phase: Phase): void {
    clearTimeout(this.quiet);
    clearTimeout(this.settle);
    this.phase = phase;
    this.write(data);
    this.quiet = setTimeout(() => this.due(), QUIET_MS);
    this.settle = setTimeout(() => this.due(), SETTLE_MS);
  }

  private waitForQuiet(): void {
    clearTimeout(this.quiet);
    this.quiet = setTimeout(() => this.due(), QUIET_MS);
  }

  /** Output went quiet, or the last write was long enough ago: press Enter, unless pi took the last one. */
  private due(): void {
    const refused =
      this.phase === "typed" ||
      (withoutEscapes(this.seen).includes(NOTICE) && !this.seen.includes(SCREEN_CLEAR));
    if (!refused || this.enters === MAX_ENTERS) {
      this.stop();
      return;
    }
    this.enters++;
    this.seen = "";
    this.type("\r", "entered");
  }
}
