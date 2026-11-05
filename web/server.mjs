// Shared brainstorm room: one transcript and one board for everyone holding the room link.
// No dependencies. The browser tabs send speech as text; a Claude Code session reads the
// transcript over HTTP and draws cards back (see web/README.md). Audio never reaches this server.

import http from "node:http";
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { place, sizeOf } from "./layout.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(path.join(ROOT, "..", ".env"));
} catch {
  console.log("Brak pliku .env: tablica i ElevenLabs są wyłączone.");
}
const BUDGET_USD = Number(process.env.BUDGET_USD || 5);
const PORT = Number(process.env.PORT || 4300);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_BODY = 2 * 1024 * 1024;

const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/scribe.js": ["scribe.js", "text/javascript; charset=utf-8"],
  "/agents.js": ["agents.js", "text/javascript; charset=utf-8"],
  "/agents.css": ["agents.css", "text/css; charset=utf-8"],
  "/pcm-worklet.js": ["pcm-worklet.js", "text/javascript; charset=utf-8"],
};

/** Stable across restarts, so links already sent to the team keep working. */
function loadRoomKey() {
  if (process.env.ROOM) return process.env.ROOM;
  const file = path.join(ROOT, ".room");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const key = randomBytes(9).toString("base64url");
  writeFileSync(file, key);
  return key;
}

const ROOM = loadRoomKey();
const startedAt = Date.now();
const stamp = new Date(startedAt).toISOString().slice(0, 19).replace(/[:T]/g, "-");
const sessionDir = path.join(process.env.SESSIONS_DIR || path.join(ROOT, "sessions"), stamp);
await mkdir(sessionDir, { recursive: true });

const lines = []; // { n, at, speaker, text }
const cards = new Map(); // id -> card
const clients = new Set(); // { res, name }
const waiters = new Set(); // long-polling transcript readers

let budget = { activity: "", spent: 0, limit: BUDGET_USD, stopped: false, error: "" };
let video = null; // { id, title } of what plays beside the board
const hasAi = process.env.BRAIN !== "off" && (process.env.ANTHROPIC_API_KEY || process.env.GROQ_API_KEY);
const brain = hasAi
  ? (await import("./brain.mjs")).createBrain({
      lines,
      cards,
      saveCard: (card) => upsertCard(card),
      agent: {
        show: (id, name, target, note) => broadcast({ type: "agent", id, name, target, note }),
        hide: (id) => broadcast({ type: "agent-done", id }),
      },
      showVideo: (next) => {
        video = /^[\w-]{11}$/.test(next?.id ?? "") ? { id: next.id, title: String(next.title ?? "").slice(0, 120) } : null;
        broadcast({ type: "video", video });
      },
      limitUsd: BUDGET_USD,
      onStatus: (next) => {
        budget = next;
        broadcast({ type: "brain", ...next });
      },
    })
  : null;

const clock = () => {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function broadcast(event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.res.write(frame);
}

const presence = () => [...new Set([...clients].map((c) => c.name).filter(Boolean))];

let saveTimer = null;
function saveBoard() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    writeFile(path.join(sessionDir, "tablica.json"), JSON.stringify([...cards.values()], null, 2)).catch(console.error);
  }, 500);
}

function addLine(speaker, text) {
  const line = { n: lines.length + 1, at: clock(), speaker: String(speaker).slice(0, 60), text: String(text).slice(0, 4000) };
  lines.push(line);
  appendFile(path.join(sessionDir, "transkrypcja.md"), `[${line.at}] ${line.speaker}: ${line.text}\n`).catch(console.error);
  broadcast({ type: "line", line });
  for (const wake of [...waiters]) wake();
  brain?.changed();
  return line;
}

/** Images come from the photo library or from the room's own screenshots, never from a free-form URL. */
const SAFE_IMAGE = /^(https:\/\/(thumb|upload)\.wikimedia\.org\/[^"'<>\s]+|data:image\/jpeg;base64,[A-Za-z0-9+/=]+)$/;

/** A new element grows out of its parents; an existing one keeps the place someone dragged it to. */
function upsertCard(input) {
  const id = String(input.id ?? "").slice(0, 80);
  const thread = String(input.thread ?? "").slice(0, 80);
  if (!id || !thread) return null;
  const existing = cards.get(id);
  const from = String(input.from ?? existing?.from ?? "").slice(0, 80);
  const paired = String(input.with ?? existing?.with ?? "").slice(0, 80);
  const src = SAFE_IMAGE.test(input.src ?? "") ? input.src : existing?.src ?? "";
  const body = String(input.body ?? existing?.body ?? "").slice(0, 1500);
  const html = typeof input.html === "string" ? input.html : existing?.html ?? "";
  const spot = existing ?? place([...cards.values()], [from, paired].map((p) => cards.get(p)).filter(Boolean), sizeOf({ src, html, body, title: input.title, minH: input.minH }));
  const card = {
    id,
    thread,
    threadTitle: String(input.threadTitle ?? existing?.threadTitle ?? thread).slice(0, 120),
    kind: ["mockup", "flow", "idea"].includes(input.kind) ? input.kind : existing?.kind ?? "idea",
    title: String(input.title ?? existing?.title ?? "").slice(0, 160),
    summary: String(input.summary ?? existing?.summary ?? "").slice(0, 600),
    quote: String(input.quote ?? existing?.quote ?? "").slice(0, 300),
    at: String(input.at ?? existing?.at ?? clock()).slice(0, 8),
    from,
    with: paired,
    status: String(input.status ?? "").slice(0, 120),
    body,
    src,
    caption: String(input.caption ?? existing?.caption ?? "").slice(0, 120),
    minH: Number(input.minH ?? existing?.minH) || 0,
    html,
    x: spot.x,
    y: spot.y,
  };
  cards.set(id, card);
  broadcast({ type: "card", card });
  saveBoard();
  return card;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("body too large"), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(Object.assign(new Error("invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function openEvents(req, res, url) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const client = { res, name: (url.searchParams.get("name") || "").slice(0, 60) };
  clients.add(client);
  res.write(`data: ${JSON.stringify({ type: "state", lines, cards: [...cards.values()], people: presence(), budget, video })}\n\n`);
  broadcast({ type: "people", people: presence() });
  const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
  req.on("close", () => {
    clearInterval(ping);
    clients.delete(client);
    broadcast({ type: "people", people: presence() });
  });
}

/** Transcript since line n; waits up to `wait` seconds for something new, so the engine needn't spin. */
function readLines(req, res, url) {
  const since = Number(url.searchParams.get("since") || 0);
  const wait = Math.min(Number(url.searchParams.get("wait") || 0), 55) * 1000;
  const reply = () => json(res, 200, { lines: lines.slice(since), total: lines.length, board: [...cards.values()].map(({ html, src, ...meta }) => meta) });
  if (lines.length > since || !wait) return reply();
  const done = () => {
    waiters.delete(done);
    clearTimeout(timer);
    reply();
  };
  const timer = setTimeout(done, wait);
  waiters.add(done);
  req.on("close", () => {
    waiters.delete(done);
    clearTimeout(timer);
  });
}

async function api(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  if (route === "GET /api/events") return openEvents(req, res, url);
  if (route === "GET /api/lines") return readLines(req, res, url);
  if (route === "POST /api/scribe-token") {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return json(res, 501, { error: "no speech key" });
    if (brain?.exhausted()) return json(res, 402, { error: "Limit budżetu wyczerpany." });
    const upstream = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", { method: "POST", headers: { "xi-api-key": key } });
    if (!upstream.ok) return json(res, 502, { error: `ElevenLabs: HTTP ${upstream.status}` });
    const { token } = await upstream.json();
    return json(res, 200, { token });
  }
  if (route === "POST /api/speech-tick") {
    const { seconds } = await readJson(req);
    brain?.addSpeech(Number(seconds) || 0);
    return json(res, 200, { stopped: brain?.exhausted() ?? false });
  }
  if (route === "POST /api/partial") {
    const { speaker, text } = await readJson(req);
    broadcast({ type: "partial", speaker: String(speaker ?? "").slice(0, 60), text: String(text ?? "").slice(0, 2000) });
    return json(res, 200, { ok: true });
  }
  if (route === "POST /api/line") {
    const { speaker, text } = await readJson(req);
    if (!speaker || !String(text ?? "").trim()) return json(res, 400, { error: "speaker and text required" });
    return json(res, 200, { line: addLine(speaker, String(text).trim()) });
  }
  if (route === "POST /api/card") {
    const card = upsertCard(await readJson(req));
    return card ? json(res, 200, { id: card.id, x: card.x, y: card.y }) : json(res, 400, { error: "id and thread required" });
  }
  if (route === "POST /api/move") {
    const { id, x, y } = await readJson(req);
    const card = cards.get(id);
    if (!card || !Number.isFinite(x) || !Number.isFinite(y)) return json(res, 400, { error: "unknown card or bad position" });
    Object.assign(card, { x, y });
    broadcast({ type: "move", id, x, y });
    saveBoard();
    return json(res, 200, { ok: true });
  }
  if (route === "POST /api/clear") {
    // Clearing archives the board: the session folder keeps every card.
    await writeFile(path.join(sessionDir, `archiwum-${Date.now()}.json`), JSON.stringify([...cards.values()], null, 2));
    cards.clear();
    brain?.reset();
    broadcast({ type: "clear" });
    saveBoard();
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://room");
    if (url.pathname.startsWith("/api/")) {
      if ((req.headers["x-room"] || url.searchParams.get("room")) !== ROOM) return json(res, 403, { error: "wrong room link" });
      return await api(req, res, url);
    }
    const asset = req.method === "GET" && STATIC[url.pathname];
    if (!asset) return json(res, 404, { error: "not found" });
    const body = await readFile(path.join(ROOT, "public", asset[0]));
    res.writeHead(200, { "Content-Type": asset[1], "Cache-Control": "no-cache" });
    res.end(body);
  } catch (err) {
    if (!(err instanceof TypeError && err.code === "ERR_INVALID_URL")) console.error(err);
    if (!res.headersSent) json(res, err.code === "ERR_INVALID_URL" ? 400 : err.status || 500, { error: err.message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Link do pokoju: http://localhost:${PORT}/?room=${ROOM}`);
  console.log(`Sesja zapisuje się w: ${sessionDir}`);
  console.log(brain ? `Tablica AI włączona, limit: $${BUDGET_USD}` : "Tablica AI wyłączona.");
});
