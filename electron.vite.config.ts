import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { LoggerEvent, PluginOptions } from "babel-plugin-react-compiler";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";

// The React Compiler leaves a component unoptimized, without a word, when it
// can't compile it. Collect those events and fail the build on any of them.
// A build where it compiled nothing fails too, because then it didn't run.
const compilerProblems: string[] = [];
let compiledFunctions = 0;

const reactCompilerOptions: PluginOptions = {
  panicThreshold: "critical_errors",
  logger: {
    logEvent(filename: string | null, event: LoggerEvent) {
      if (event.kind === "CompileSuccess") {
        compiledFunctions += 1;
      } else if (event.kind === "CompileError") {
        compilerProblems.push(`${where(filename, event)} skipped: ${event.detail.toString()}`);
      } else if (event.kind === "CompileSkip") {
        compilerProblems.push(`${where(filename, event)} skipped: ${event.reason}`);
      } else if (event.kind === "PipelineError") {
        compilerProblems.push(`${where(filename, event)} crashed the compiler: ${event.data}`);
      }
    },
  },
};

function where(filename: string | null, event: { fnLoc: { start: { line: number } } | null }) {
  return `${filename ?? "unknown file"}:${event.fnLoc?.start.line ?? "?"}`;
}

function failOnCompilerProblems(): Plugin {
  return {
    name: "tondo:react-compiler-problems",
    apply: "build",
    buildEnd(error) {
      if (error) return;
      if (compilerProblems.length > 0) {
        this.error(`React Compiler left code unoptimized:\n${compilerProblems.join("\n")}`);
      }
      if (compiledFunctions === 0) {
        this.error(
          "React Compiler compiled nothing. Is it still in @vitejs/plugin-react's babel plugins?",
        );
      }
      const noun = compiledFunctions === 1 ? "function" : "functions";
      this.info(`React Compiler compiled ${compiledFunctions} ${noun}.`);
    },
  };
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // The host is its own entry so the utility process loads it without main's code.
        input: { index: "src/main/index.ts", host: "src/host/index.ts" },
      },
    },
  },
  preload: {
    build: {
      // A sandboxed preload can't require packages, so bundle everything it uses.
      externalizeDeps: false,
    },
  },
  renderer: {
    plugins: [
      react({ babel: { plugins: [["babel-plugin-react-compiler", reactCompilerOptions]] } }),
      tailwindcss(),
      failOnCompilerProblems(),
    ],
  },
});
