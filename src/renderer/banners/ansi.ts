// pi writes colored warnings and errors to stderr, and the "pi stopped" banner
// shows that stderr. The host's stripAnsi (src/host/extensionUi.ts) matches the
// same sequences; the page can't import host code.

const ESC = String.fromCharCode(0x1b);
const CSI = String.fromCharCode(0x9b);
const BEL = String.fromCharCode(0x07);

/** OSC strings ending in BEL or ST, CSI sequences, and other two-character escapes. */
const ANSI = new RegExp(
  `${ESC}\\][\\s\\S]*?(?:${BEL}|${ESC}\\\\)|(?:${ESC}\\[|${CSI})[0-?]*[ -/]*[@-~]|${ESC}[@-Z\\\\-_]`,
  "g",
);

/** `text` without terminal escape sequences, which a page can't show. */
export function stripAnsi(text: string): string {
  return text.includes(ESC) || text.includes(CSI) ? text.replace(ANSI, "") : text;
}
