// Serves the renderer on its own so Chrome can load it, with the fixture player
// standing in for the host. `pnpm dev` would start Electron as well.
import { defineConfig } from "vite";
import electronConfig from "./electron.vite.config";

const plugins = electronConfig.renderer?.plugins;
if (!plugins) throw new Error("electron.vite.config.ts has no renderer plugins to serve with");

export default defineConfig({ root: "src/renderer", plugins });
