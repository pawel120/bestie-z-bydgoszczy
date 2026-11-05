import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { LLM } from './lib/llm.js';
import { makePersonas } from './lib/personas.js';
import { runAgent } from './lib/agent.js';
import { summarize } from './lib/stats.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Prosty loader .env (bez zależności). Klucz NIGDY nie trafia do repo: .env jest w .gitignore.
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const PORT = Number(process.env.PORT || 3333);
const MODELS = (process.env.HORDE_MODELS || 'typesafe/jev-router,x-ai/grok-4-fast,openai/gpt-oss-120b').split(',').map(s => s.trim()).filter(Boolean);
const BUDGET = Number(process.env.HORDE_BUDGET_USD || 0.15);
const CONCURRENCY = Number(process.env.HORDE_CONCURRENCY || 8);

const clients = new Set();
let current = null; // { abort, llm, started }
let lastRun = null;
const emit = (ev) => {
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(data);
};

let browserP = null;
async function getBrowser() {
  if (!browserP) {
    browserP = (async () => {
      const opts = { headless: process.env.HEADFUL ? false : true };
      if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
      try { return await chromium.launch(opts); }
      catch (e) {
        // Na Macu bez `npx playwright install` użyj zainstalowanego Chrome.
        return await chromium.launch({ ...opts, channel: 'chrome' });
      }
    })();
  }
  return browserP;
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function personaRoles(llm, audience, n) {
  if (!audience) return null;
  try {
    const d = await llm.json(
      'Zwracasz tylko JSON: {"roles":["..."]}.',
      `Grupa docelowa produktu: "${audience}". Podaj ${n} RÓŻNYCH, konkretnych person (rola + jedna cecha sytuacji, max 12 słów każda, po polsku). Rozrzuć je szeroko: różny wiek, budżet, doświadczenie, sceptycyzm. Uwzględnij też osoby spoza idealnego klienta, które i tak trafią na stronę.`,
      { maxTokens: 600, temperature: 1 });
    return Array.isArray(d.roles) && d.roles.length ? d.roles.map(String) : null;
  } catch { return null; }
}

async function insight(llm, summary, variantsCfg) {
  const compact = {
    warianty: Object.fromEntries(Object.entries(summary.variants).map(([v, s]) => [v, {
      url: variantsCfg[v], konwersja: `${s.conv}/${s.n}`, powody_odejscia: s.reasons, sr_krokow: +s.avgSteps.toFixed(1),
      cytaty: s.quotes.filter(q => !q.converted).slice(0, 6).map(q => `[${q.lastStep}] ${q.quote}`),
    }])),
    lejek: summary.funnel, test_par: summary.paired,
  };
  try {
    return await llm.json(
      'Jesteś analitykiem CRO. Zwracasz tylko JSON: {"headline":"...","findings":["..."],"fixes":["..."]}. Po polsku, konkretnie, bez lania wody.',
      `Wyniki symulowanego testu użytkowników (persony-agenci, nie prawdziwi ludzie):\n${JSON.stringify(compact)}\n\nheadline: jedno zdanie z najważniejszym wnioskiem (z liczbami). findings: 3 największe problemy (gdzie i dlaczego ludzie odpadają). fixes: 3 konkretne zmiany do przetestowania, od największego wpływu. Jeśli próba jest mała, zaznacz to.`,
      { maxTokens: 500, temperature: 0.3, final: true });
  } catch (e) { return { headline: 'Nie udało się wygenerować podsumowania: ' + e.message, findings: [], fixes: [] }; }
}

async function startRun(cfg) {
  const key = cfg.key || process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('Brak OPENROUTER_API_KEY (ustaw w .env albo wpisz w panelu).');
  const llm = new LLM({ key, models: MODELS, budgetUsd: Math.min(Number(cfg.budget) || BUDGET, 1) });
  const abort = new AbortController();
  current = { abort, llm, started: Date.now() };
  const variants = { A: cfg.urlA };
  if (cfg.urlB) variants.B = cfg.urlB;
  const n = Math.max(1, Math.min(Number(cfg.agents) || 8, 30));
  const goal = { url: cfg.goalUrl || '', text: cfg.goalText || '' };
  const ticker = setInterval(() => emit({ type: 'cost', spent: llm.spent, calls: llm.calls, tokensIn: llm.tokensIn, tokensOut: llm.tokensOut, model: llm.lastModel, elapsed: Date.now() - current.started }), 500);
  try {
    emit({ type: 'phase', text: cfg.audience ? 'Generuję persony z opisu grupy docelowej…' : 'Losuję persony…' });
    const roles = await personaRoles(llm, cfg.audience, n);
    const personas = makePersonas(n, Number(cfg.seed) || Date.now() % 100000, roles);
    emit({ type: 'start', personas, variants, goal, models: MODELS, budget: llm.budgetUsd });
    const browser = await getBrowser();
    const jobs = [];
    // Przeplatamy A i B, żeby oba warianty szły równolegle na podglądzie.
    for (const p of personas) for (const v of Object.keys(variants)) jobs.push({ p, v });
    const results = await pool(jobs, CONCURRENCY, ({ p, v }) =>
      runAgent({ browser, persona: p, variant: v, startUrl: variants[v], goal, llm, emit, signal: abort.signal }));
    const summary = summarize(results, personas);
    emit({ type: 'phase', text: 'Analityk podsumowuje wyniki…' });
    summary.insight = await insight(llm, summary, variants);
    summary.cost = { spent: llm.spent, calls: llm.calls, tokensIn: llm.tokensIn, tokensOut: llm.tokensOut, model: llm.lastModel, servedBy: llm.servedBy, ms: Date.now() - current.started };
    lastRun = { cfg: { ...cfg, key: undefined }, personas, results, summary, at: new Date().toISOString() };
    try {
      fs.mkdirSync(path.join(ROOT, 'runs'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'runs', `run-${Date.now()}.json`), JSON.stringify(lastRun, null, 2));
    } catch {}
    emit({ type: 'done', summary });
  } catch (e) {
    emit({ type: 'error', text: String(e.message || e) });
  } finally {
    clearInterval(ticker);
    emit({ type: 'cost', spent: llm.spent, calls: llm.calls, tokensIn: llm.tokensIn, tokensOut: llm.tokensOut, model: llm.lastModel, elapsed: Date.now() - current.started });
    current = null;
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
function serveStatic(res, base, rel) {
  let f = path.normalize(path.join(base, rel));
  if (!f.startsWith(base)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!fs.existsSync(f)) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'hello', running: !!current, hasKey: !!process.env.OPENROUTER_API_KEY, models: MODELS, lastRun: lastRun ? { summary: lastRun.summary } : null })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (u.pathname === '/api/run' && req.method === 'POST') {
    let body = '';
    for await (const c of req) body += c;
    if (current) { res.writeHead(409).end('Horda już biegnie'); return; }
    let cfg;
    try { cfg = JSON.parse(body || '{}'); } catch { res.writeHead(400).end('zły JSON'); return; }
    if (!cfg.urlA) { res.writeHead(400).end('Podaj URL wariantu A'); return; }
    startRun(cfg);
    res.writeHead(202, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    return;
  }
  if (u.pathname === '/api/stop' && req.method === 'POST') {
    current?.abort.abort();
    res.writeHead(200).end('ok');
    return;
  }
  if (u.pathname === '/api/last') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(lastRun));
    return;
  }
  if (u.pathname.startsWith('/demo/')) return serveStatic(res, path.join(ROOT, 'demo-site'), u.pathname.slice(6));
  return serveStatic(res, path.join(ROOT, 'public'), u.pathname === '/' ? 'index.html' : u.pathname);
});

server.listen(PORT, () => {
  console.log(`\n  🐝 Horda działa: http://localhost:${PORT}`);
  console.log(`  Demo A/B: http://localhost:${PORT}/demo/a/  i  http://localhost:${PORT}/demo/b/`);
  console.log(`  Modele: ${MODELS.join(' → ')}  |  limit: $${BUDGET}/przebieg  |  klucz: ${process.env.OPENROUTER_API_KEY ? 'OK' : 'BRAK (.env)'}\n`);
});
// Playwright przejmuje SIGTERM/SIGINT i bez tego proces potrafi wisieć po pierwszym przebiegu.
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => {
  current?.abort.abort();
  server.close();
  await Promise.race([browserP?.then(b => b.close()).catch(() => {}), new Promise(r => setTimeout(r, 2000))]);
  process.exit(0);
});
