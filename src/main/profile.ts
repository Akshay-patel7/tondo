import path from "node:path";
import type { HostConfig } from "../shared/protocol";

export interface ProfileOptions {
  /** `TONDO_USER_DATA_DIR`, which tests and the smoke run set to a temporary folder. */
  override: string | undefined;
  isPackaged: boolean;
  /** The repo root when unpackaged, because every launch runs `electron .`. */
  appPath: string;
}

/**
 * Where Tondo keeps its app data. Unpackaged runs (`pnpm dev`, smoke, e2e) never
 * touch the installed app's profile. Returns undefined to keep Electron's
 * default, which is what a packaged build uses.
 */
export function resolveUserDataDir({
  override,
  isPackaged,
  appPath,
}: ProfileOptions): string | undefined {
  if (override) return path.resolve(override);
  if (!isPackaged) return path.join(appPath, ".dev", "userData");
  return undefined;
}

export interface PiOptionsInput {
  isPackaged: boolean;
  userData: string;
  /** `TONDO_PI_ARGS`: a JSON array of extra arguments for pi, such as tests' faux provider flags. */
  piArgs: string | undefined;
  /** `TONDO_POOL`: a JSON object that overrides the pool's limits, such as `{"maxLive":1}`, so tests can watch pi stop. */
  pool: string | undefined;
}

/**
 * How the host runs pi in this build. Unpackaged runs keep pi's files in the
 * profile rather than ~/.pi/agent, and take extra arguments for pi and limits
 * for the pool. A packaged app runs pi as you set it up.
 */
export function piOptions({
  isPackaged,
  userData,
  piArgs,
  pool,
}: PiOptionsInput): Pick<HostConfig, "piAgentDir" | "piArgs" | "pool"> {
  if (isPackaged) return { piArgs: [] };
  return {
    piAgentDir: path.join(userData, "pi-agent"),
    piArgs: parsePiArgs(piArgs),
    ...(pool ? { pool: parsePool(pool) } : {}),
  };
}

function parsePiArgs(value: string | undefined): string[] {
  if (!value) return [];
  let args: unknown;
  try {
    args = JSON.parse(value);
  } catch {
    // Reported below with every other value that isn't a list of strings.
  }
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) {
    throw new Error(`TONDO_PI_ARGS must be a JSON array of strings, not ${value}`);
  }
  return args;
}

function parsePool(value: string): NonNullable<HostConfig["pool"]> {
  let pool: unknown;
  try {
    pool = JSON.parse(value);
  } catch {
    // Reported below with every other value that isn't such an object.
  }
  const valid =
    typeof pool === "object" &&
    pool !== null &&
    !Array.isArray(pool) &&
    Object.entries(pool).every(
      ([key, limit]) =>
        (key === "maxLive" || key === "idleMs") && Number.isSafeInteger(limit) && limit >= 0,
    );
  if (!valid) {
    throw new Error(
      `TONDO_POOL must be a JSON object with whole numbers for maxLive and idleMs, not ${value}`,
    );
  }
  return pool as NonNullable<HostConfig["pool"]>;
}
