import { gzipSync } from "node:zlib";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
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

/** Compress once at build time, never on the Mac's streaming or network event loop. */
function precompressedBrowserAssets(): Plugin {
  return {
    name: "tondo:precompressed-browser-assets",
    apply: "build",
    async writeBundle(options, bundle) {
      if (!options.dir) return;
      const root = options.dir;
      // Vite rewrites dynamic-import preload tables in generateBundle. Compress
      // the written bytes, not an earlier chunk that still has placeholders.
      await Promise.all(
        Object.values(bundle)
          .filter((file) => /\.(?:js|css|wasm)$/.test(file.fileName))
          .map(async (file) => {
            const target = path.join(root, file.fileName);
            await writeFile(`${target}.gz`, gzipSync(await readFile(target), { level: 9 }));
          }),
      );
    },
  };
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // The host is its own entry so the utility process loads it without main's code.
        input: {
          index: "src/main/index.ts",
          host: "src/host/index.ts",
          remote: "src/host/remoteGateway.ts",
          piUpdateProbe: "src/host/piUpdateProbe.ts",
        },
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
      precompressedBrowserAssets(),
    ],
    // @pierre/diffs's worker loads Shiki's WebAssembly engine with a dynamic
    // import, for pools that ask for it. Only an ES module worker can split
    // that into a chunk of its own.
    worker: { format: "es" },
    // Chromium keeps the page's script source in memory, at two bytes a
    // character here, so a minified bundle keeps the before-streaming footprint
    // inside its budget (docs/stack.md, "Stage 12 measurements"). Not with
    // esbuild's keepNames: wrapping every named closure cost the terminal a
    // third of its throughput.
    // Hidden sourcemaps: the .map files sit next to the bundles, but the shipped JS has no
    // sourceMappingURL comment. The page never loads a map, so its memory doesn't change,
    // and the minified renderer's stack traces can be mapped offline.
    build: {
      minify: "esbuild",
      sourcemap: "hidden",
      rollupOptions: {
        input: { index: "src/renderer/index.html", remote: "src/renderer/remote.html" },
      },
    },
  },
});
