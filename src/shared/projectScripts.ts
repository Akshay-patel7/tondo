export interface ProjectScript {
  readonly id: string;
  readonly name: string;
  readonly command: string;
}

/** Scripts belong to the sidebar project's canonical folder, not an individual worktree. */
export type ProjectScripts = Readonly<Record<string, readonly ProjectScript[]>>;
export const MAX_PROJECT_SCRIPTS = 32;
export const MAX_SCRIPT_TERMINALS = 8;

export function isProjectScript(value: unknown): value is ProjectScript {
  if (!record(value) || Object.keys(value).length !== 3) return false;
  return (
    typeof value.id === "string" &&
    /^[a-zA-Z0-9-]{1,64}$/.test(value.id) &&
    typeof value.name === "string" &&
    value.name.trim() === value.name &&
    value.name.length > 0 &&
    value.name.length <= 80 &&
    !hasControl(value.name) &&
    typeof value.command === "string" &&
    value.command.trim().length > 0 &&
    value.command.length <= 8192 &&
    !hasControl(value.command, true)
  );
}

export function isProjectScripts(value: unknown): value is ProjectScripts {
  return (
    record(value) &&
    Object.keys(value).length <= 1000 &&
    Object.entries(value).every(
      ([folder, scripts]) =>
        folder.startsWith("/") &&
        !folder.includes("\0") &&
        folder.length <= 4096 &&
        Array.isArray(scripts) &&
        scripts.length <= MAX_PROJECT_SCRIPTS &&
        scripts.every(isProjectScript) &&
        new Set(scripts.map((script) => script.id)).size === scripts.length,
    )
  );
}

function hasControl(text: string, multiline = false): boolean {
  return Array.from(text).some((char) => {
    const code = char.charCodeAt(0);
    return (code < 32 || code === 127) && !(multiline && (char === "\n" || char === "\t"));
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
