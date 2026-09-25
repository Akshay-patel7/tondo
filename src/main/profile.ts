import path from "node:path";

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
