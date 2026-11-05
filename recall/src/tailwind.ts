// Compiles the Tailwind classes a generated card uses into an inline <style>, so cards stay script-free.
// Browser version: Tailwind's stylesheet is bundled as a string instead of read from node_modules.

import { compile } from "tailwindcss";
import indexCss from "tailwindcss/index.css?raw";

let compiler: ReturnType<typeof compile> | null = null;

function getCompiler() {
  compiler ??= compile(`@import "tailwindcss";`, {
    base: "/",
    loadStylesheet: async () => ({ path: "tailwindcss/index.css", base: "/", content: indexCss }),
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
  // Cards are offline and script-free: drop CDN links/scripts the model sometimes adds anyway.
  html = html
    .replace(/<script\b[\s\S]*?(<\/script>|$)/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/@import[^;]*;/g, "");
  const css = (await getCompiler()).build(candidates(html));
  const style = `<style>${css}</style>`;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${style}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${style}</head><body>${html}</body></html>`;
}
