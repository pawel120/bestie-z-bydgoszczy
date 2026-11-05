// Compiles the Tailwind classes a generated card uses into an inline <style>, so cards stay script-free.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { compile } from "tailwindcss";

const tailwindDir = path.dirname(require.resolve("tailwindcss/package.json"));

let compiler: ReturnType<typeof compile> | null = null;

function getCompiler() {
  compiler ??= compile(`@import "tailwindcss";`, {
    base: tailwindDir,
    loadStylesheet: async (id, base) => {
      const file = id === "tailwindcss" ? "index.css" : id.replace(/^tailwindcss\//, "").replace(/^\.\//, "");
      const full = path.resolve(id.startsWith(".") ? base : tailwindDir, file.endsWith(".css") ? file : `${file}.css`);
      return { path: full, base: path.dirname(full), content: await readFile(full, "utf8") };
    },
  });
  return compiler;
}

function candidates(html: string) {
  const found = new Set<string>();
  for (const match of html.matchAll(/class(?:Name)?\s*=\s*"([^"]*)"|class(?:Name)?\s*=\s*'([^']*)'/g)) {
    for (const token of (match[1] ?? match[2]).split(/\s+/)) if (token) found.add(token);
  }
  return [...found];
}

/** Returns the card HTML with the compiled Tailwind CSS injected into <head>. */
export async function inlineTailwind(html: string): Promise<string> {
  const css = (await getCompiler()).build(candidates(html));
  const style = `<style>${css}</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${style}</head><body>${html}</body></html>`;
}
