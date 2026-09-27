import path from "node:path";
import { defineConfig } from "@playwright/test";

// `pnpm perf`: the perf scenarios in e2e/*.perf.ts. They take about ten
// minutes and keep Tondo's window on top while they run.

// Every perf file writes its results to this run's folder. The runner names
// it, and the worker processes it starts inherit the variable.
process.env.TONDO_PERF_DIR ??= path.join(
  __dirname,
  ".dev",
  "perf",
  new Date().toISOString().replaceAll(":", "-").replace(/\..*/, ""),
);

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.perf.ts",
  workers: 1,
  timeout: 5 * 60_000,
  reporter: "list",
  outputDir: "test-results/perf",
});
