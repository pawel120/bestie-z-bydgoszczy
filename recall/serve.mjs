#!/usr/bin/env node
// Serves the built page (dist/) and relays what the bot shows to viewers:
//   /            the app (the Recall bot opens it with #c=…)
//   /#view       live view of the bot's screen, for anyone with the link (no keys needed)
//   wss /live    the bot pushes snapshots (with the token from .live-token), viewers receive them
// Run behind a public URL, e.g. `cloudflared tunnel --url http://127.0.0.1:4173`.

import http from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "dist");
const tokenFile = path.join(here, ".live-token");
if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(16).toString("hex"), { mode: 0o600 });
const token = readFileSync(tokenFile, "utf8").trim();
const port = Number(process.env.PORT ?? 4173);

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const file = path.normalize(path.join(dist, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname)));
  if (!file.startsWith(dist)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
const viewers = new Set();
let latest = null;

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/live") return socket.destroy();
  const isBot = url.searchParams.get("role") === "bot";
  if (isBot && url.searchParams.get("token") !== token) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    if (isBot) {
      latest = null; // a fresh bot page: drop the previous one's screen
      ws.on("message", (data) => {
        const text = String(data);
        if (text.startsWith('{"log"')) return console.log(`[bot ${new Date().toLocaleTimeString("pl")}] ${JSON.parse(text).log}`);
        latest = text;
        for (const viewer of viewers) if (viewer.readyState === 1) viewer.send(latest);
      });
    } else {
      viewers.add(ws);
      ws.on("close", () => viewers.delete(ws));
      if (latest) ws.send(latest);
    }
  });
});

server.listen(port, "127.0.0.1", () => console.log(`Bestie: http://127.0.0.1:${port}  ·  podgląd: /#view`));
