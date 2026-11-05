// Builds the DESKTOP app's renderer (../src/renderer: same HTML, CSS, transcript, whiteboard) and its board engine
// (../src/board.ts) for the browser, so the page the Recall bot opens is the desktop app 1:1. Only Electron is
// swapped out: src/web-main.ts provides `window.bestie`, and a few Node-only imports are redirected below.

import { defineConfig, transformWithEsbuild, type Plugin } from "vite";
import { readFile } from "node:fs/promises";
import path from "node:path";

const desktop = path.resolve(__dirname, "../src");
const here = (file: string) => path.resolve(__dirname, "src", file);

function desktopApp(): Plugin {
  const worklet = async () =>
    (await transformWithEsbuild(await readFile(path.join(desktop, "renderer/pcm-worklet.mts"), "utf8"), "pcm-worklet.ts", { loader: "ts" })).code;
  return {
    name: "bestie-desktop",
    enforce: "pre",
    resolveId(source, importer) {
      // Claude from the browser needs dangerouslyAllowBrowser; the wrapper adds it.
      if (source === "@anthropic-ai/sdk" && importer && !importer.endsWith("anthropic-browser.ts")) return here("anthropic-browser.ts");
      // Tailwind compiled from a bundled stylesheet instead of node_modules on disk.
      if (source === "./tailwind" && importer?.startsWith(desktop)) return here("tailwind.ts");
      // The bot's hands-free camera wraps the desktop whiteboard (see src/handsfree.ts).
      if (source === "./board.mjs" && importer?.endsWith(path.join("renderer", "app.mts"))) return here("handsfree.ts");
      return null;
    },
    transformIndexHtml: {
      order: "pre",
      async handler() {
        const html = await readFile(path.join(desktop, "renderer/index.html"), "utf8");
        return html
          .replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/, "") // the browser talks to the APIs directly
          .replace(/<link rel="stylesheet" href="styles.css">/, "") // imported by web-main.ts
          .replace(/<script type="module" src="app.mjs"><\/script>/, '<script type="module" src="/src/web-main.ts"></script>');
      },
    },
    // The renderer loads its AudioWorklet by URL, next to index.html.
    configureServer(server) {
      server.middlewares.use("/pcm-worklet.mjs", async (_req, res) => {
        res.setHeader("Content-Type", "text/javascript");
        res.end(await worklet());
      });
    },
    async generateBundle() {
      this.emitFile({ type: "asset", fileName: "pcm-worklet.mjs", source: await worklet() });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [desktopApp()],
  define: { "process.env": "{}" },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
  server: { fs: { allow: [".."] } },
  // `preview` accepts any Host header so the build can be served through a tunnel for the bot.
  preview: { host: "127.0.0.1", allowedHosts: true },
});
