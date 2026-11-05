// Bridge to Horda (../horda): a swarm of Jev-driven personas that click through two variants in a real browser.
// Bestie serves the two cards as pages, starts the Horda server if needed, kicks off an A/B run and forwards Horda's
// live events (personas, their screens, thoughts, results), which the board renders natively on the canvas.
// Nothing in horda/ is modified.

import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import path from "node:path";

export const HORDA_PORT = 3333;
const CARD_PORT = 3334;
export const HORDA_URL = `http://127.0.0.1:${HORDA_PORT}`;

/** Clicking a CTA whose label matches this counts as conversion (cards have no real flows behind them). */
export const DEFAULT_GOAL =
  "/go/.*(kontakt|contact|porozm|rozmow|demo|wyprob|start|zarejestr|rejestr|kup|zamow|pobierz|download|zacznij|sign|trial|darmo|umow|get|try|buy)";

const pages = new Map<string, string>();
let cardServer: http.Server | null = null;
let hordaProcess: ChildProcess | null = null;

// Every link / button on a card leads to /go/<label>, so personas can "convert" by clicking the right CTA.
const CLICK_SCRIPT = (id: string) => `<script>
document.addEventListener("click", (e) => {
  const el = e.target.closest("a, button, [role=button], input[type=submit]");
  if (!el) return;
  e.preventDefault();
  const label = (el.innerText || el.value || el.getAttribute("aria-label") || "klik").trim().toLowerCase()
    .normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
  location.href = "/c/${id}/go/" + (label || "klik");
}, true);
</script>`;

const goPage = (label: string) =>
  `<!doctype html><meta charset="utf-8"><title>${label}</title><body style="font:20px system-ui;display:grid;place-items:center;height:100vh;margin:0">` +
  `<div><h1>Dziękujemy!</h1><p>Wybrano: ${label.replace(/[<>&]/g, "")}</p></div></body>`;

function ensureCardServer() {
  if (cardServer) return;
  cardServer = http
    .createServer((req, res) => {
      const m = (req.url ?? "").match(/^\/c\/([^/]+)\/(?:go\/([^/?#]*))?/);
      const html = m && pages.get(decodeURIComponent(m[1]));
      if (!m || !html) return void res.writeHead(404).end("404");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      if (m[2] !== undefined) return void res.end(goPage(decodeURIComponent(m[2]).replace(/-/g, " ")));
      res.end(/<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${CLICK_SCRIPT(m[1])}</body>`) : html + CLICK_SCRIPT(m[1]));
    })
    .listen(CARD_PORT, "127.0.0.1");
}

/** Serves a card's rendered HTML at a local URL Horda's browsers can open. */
export function publishCard(id: string, html: string) {
  ensureCardServer();
  pages.set(id, html);
  return `http://localhost:${CARD_PORT}/c/${encodeURIComponent(id)}/`;
}

async function hordaUp() {
  try {
    const res = await fetch(`${HORDA_URL}/api/last`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Starts horda/server.js (with Bestie's OpenRouter key) unless one is already running. */
export async function ensureHorda(openRouterKey: string) {
  if (await hordaUp()) return;
  if (!hordaProcess || hordaProcess.exitCode !== null) {
    // Electron's own binary runs as plain Node with ELECTRON_RUN_AS_NODE, so this works even when the app was
    // started from Finder / `open` and `node` is not on PATH.
    hordaProcess = spawn(process.env.BESTIE_NODE || process.execPath, ["server.js"], {
      cwd: path.join(__dirname, "..", "horda"),
      env: { ...process.env, OPENROUTER_API_KEY: openRouterKey, PORT: String(HORDA_PORT), ELECTRON_RUN_AS_NODE: "1" },
      stdio: "ignore",
    });
    hordaProcess.on("error", () => (hordaProcess = null));
  }
  for (let i = 0; i < 40; i++) {
    if (await hordaUp()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Horda nie wystartowała (sprawdź `cd horda && npm install`).");
}

export function stopHorda() {
  hordaProcess?.kill();
  hordaProcess = null;
  cardServer?.close();
  cardServer = null;
}

export interface HordaResult {
  conv: { A: string; B: string };
  headline: string;
  pValue: number | null;
  cost: number;
}

/** Runs an A/B test and resolves when Horda is done (its panel shows the run live meanwhile). */
export async function runHorda(
  cfg: { urlA: string; urlB: string; goal: string; audience: string; agents: number },
  onEvent: (ev: { type: string }) => void,
): Promise<HordaResult> {
  // Listen before starting, so the "done" event cannot be missed.
  const events = await fetch(`${HORDA_URL}/api/events`);
  const reader = events.body!.pipeThrough(new TextDecoderStream()).getReader();
  const start = await fetch(`${HORDA_URL}/api/run`, {
    method: "POST",
    body: JSON.stringify({ urlA: cfg.urlA, urlB: cfg.urlB, goalUrl: cfg.goal, audience: cfg.audience, agents: cfg.agents }),
  });
  if (!start.ok) {
    void reader.cancel();
    throw new Error(`Horda: ${await start.text()}`);
  }
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("Horda przerwała połączenie.");
      buffer += value;
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        if (!chunk.startsWith("data: ")) continue;
        const ev = JSON.parse(chunk.slice(6));
        if (ev.type === "error") throw new Error(`Horda: ${ev.text}`);
        if (["start", "agent", "phase", "done"].includes(ev.type)) onEvent(ev);
        if (ev.type !== "done") continue;
        const s = ev.summary;
        const conv = (v: string) => (s.variants?.[v] ? `${s.variants[v].conv}/${s.variants[v].n}` : "–");
        return {
          conv: { A: conv("A"), B: conv("B") },
          headline: s.insight?.headline ?? "",
          pValue: s.paired?.p ?? s.paired?.pValue ?? null,
          cost: s.cost?.spent ?? 0,
        };
      }
    }
  } finally {
    void reader.cancel();
  }
}
