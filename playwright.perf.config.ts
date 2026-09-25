import { defineConfig } from "@playwright/test";

// `pnpm perf`: the Stage 1 perf scenarios in e2e/*.perf.ts. They take about
// ten minutes and keep Tondo's window on top while they run.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.perf.ts",
  workers: 1,
  timeout: 5 * 60_000,
  reporter: "list",
  outputDir: "test-results/perf",
});
