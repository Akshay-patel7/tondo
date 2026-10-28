/** Presets use macOS applications without requiring their optional command-line tools. */
export const IDE_PRESETS = [
  { command: "code", label: "VS Code", macApp: "Visual Studio Code" },
  { command: "cursor", label: "Cursor", macApp: "Cursor" },
  { command: "windsurf", label: "Windsurf", macApp: "Windsurf" },
  { command: "zed", label: "Zed", macApp: "Zed" },
] as const;

export function ideLabel(command: string): string {
  return IDE_PRESETS.find((preset) => preset.command === command)?.label ?? "IDE";
}

/** One executable, never a shell command or a relative path into a project. */
export function isIdeCommand(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    value.trim() === value &&
    !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) &&
    (value.startsWith("/") || /^[a-zA-Z0-9_][a-zA-Z0-9_.+-]*$/.test(value))
  );
}
