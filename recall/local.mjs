// Runs the app on this computer through your own Claude login, with no API keys: the page built in dist/ keeps
// talking to "the Claude API", but at this local address, where each request becomes a `claude -p` call.
//
//   npx vite build && node local.mjs
//
// Usage counts against your Claude plan's limits. Speech uses the browser's free recognition.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 4310);
const CALL_TIMEOUT = 180_000;
const SEARCH_TIMEOUT = 25_000;
const SHOT_LIMIT = 2; // each screenshot is a whole Chrome
const SHOT_TIMEOUT = 12_000; // a heavy page must not hold up the ones behind it
const SHOT_CACHE = 30;
const CHROME = process.env.CHROME_BIN || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const DRAWING_MODEL = process.env.BESTIE_DRAW_MODEL || "claude-sonnet-5-5";
const TASK_MODEL = "claude-sonnet-5-5";
const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const PAGE_CONFIG = { login: true, anthropic: "login", elevenlabs: "browser", lang: "pl", handsfree: true };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" };
const ID_SUFFIX = () => Math.random().toString(36).slice(2, 10);

const installed = path.join(process.env.APPDATA ?? "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
const CLAUDE = process.env.CLAUDE_BIN || (existsSync(installed) ? installed : "claude");

/** Every call runs without any API key in its environment, because the CLI would prefer a key over the login. */
const loginEnv = () => {
  const env = { ...process.env };
  for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"]) delete env[name];
  return env;
};

const auth = spawnSync(CLAUDE, ["auth", "status"], { env: loginEnv(), encoding: "utf8" });
if (!/"authMethod":\s*"claude\.ai"/.test(auth.stdout ?? "")) {
  console.error("Claude nie jest zalogowany przez konto. Uruchom `claude auth login`. Niczego nie włączam, żeby nie użyć klucza API.");
  process.exit(1);
}

const asText = (content) =>
  typeof content === "string"
    ? content
    : content
        .map((block) => {
          if (block.type === "text") return block.text;
          if (block.type === "tool_use") return `[called ${block.name} ${JSON.stringify(block.input)}]`;
          if (block.type === "tool_result") return `[result of the call]\n${asText(block.content ?? "")}`;
          return "";
        })
        .join("\n");

const asSystem = (system) => (typeof system === "string" ? system : (system ?? []).map((b) => b.text).join("\n"));

const isSearch = (tool) => /^web_(search|fetch)/.test(tool.type ?? "");

function describeTool(tool) {
  if (/^text_editor/.test(tool.type ?? "")) {
    return `${tool.name}: edits the file. Input: {"command":"str_replace","path":"card.html","old_str":"...","new_str":"..."}. old_str must match exactly once.`;
  }
  return `${tool.name}: ${tool.description} Input schema: ${JSON.stringify(tool.input_schema)}`;
}

function promptFor(body) {
  const talk = body.messages.map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}:\n${asText(m.content)}`).join("\n\n");
  const own = body.tool_choice?.type === "none" ? [] : (body.tools ?? []).filter((t) => !isSearch(t));
  if (!own.length) return talk;
  return `You can use these tools:\n${own.map(describeTool).join("\n")}\n\nTo use them, reply with ONLY this JSON: {"tool_calls":[{"name":"...","input":{}}]}. Your reply then gets their results. When you need no tool, reply normally.\n\n${talk}`;
}

/** Streamed requests without tools are cards being drawn; everything else is a task around them. */
const isDrawing = (body) => body.stream && !body.tools?.length;
const isSearching = (body) => body.stream && (body.tools ?? []).some(isSearch);
const SEARCH_TOOLS = { WebSearch: "web_search", WebFetch: "web_fetch" };

function runClaude(body, onText, onTool) {
  const dir = mkdtempSync(path.join(tmpdir(), "bestie-"));
  const searches = (body.tools ?? []).some(isSearch) && body.tool_choice?.type !== "none";
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--model", isDrawing(body) ? DRAWING_MODEL : TASK_MODEL];
  args.push("--effort", "low", "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "", "--tools", searches ? "WebSearch,WebFetch" : "");
  if (searches) args.push("--allowedTools", "WebSearch,WebFetch");
  const system = asSystem(body.system);
  if (system) {
    const file = path.join(dir, "system.txt");
    writeFileSync(file, searches ? `${system}\nweb_search and web_fetch mean your WebSearch and WebFetch tools.` : system);
    args.push("--system-prompt-file", file);
  }
  const schema = body.output_config?.format?.schema;
  if (schema) args.push("--json-schema", JSON.stringify(schema));

  return new Promise((resolve, reject) => {
    // Run outside the project, so its instructions and tools don't reach the model.
    const child = spawn(CLAUDE, args, { cwd: dir, env: loginEnv(), stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => child.kill(), CALL_TIMEOUT);
    let buffer = "";
    let err = "";
    let final = null;
    const read = (line) => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === "result") final = event;
      const delta = event.type === "stream_event" && event.event?.delta;
      if (delta?.type === "text_delta") onText?.(delta.text);
      if (event.type === "assistant") for (const block of event.message?.content ?? []) if (block.type === "tool_use") onTool?.(block);
    };
    child.stdout.on("data", (d) => {
      buffer += d;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) read(line);
    });
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      if (!final) return reject(new Error((err || "brak odpowiedzi").slice(0, 300)));
      if (final.is_error) return reject(new Error(String(final.result ?? "błąd Claude").slice(0, 300)));
      resolve(final.structured_output ? JSON.stringify(final.structured_output) : String(final.result ?? ""));
    });
    child.stdin.end(promptFor(body));
  });
}

function asMessage(body, text) {
  const calls = text.match(/\{\s*"tool_calls"[\s\S]*\}/)?.[0];
  let content = [{ type: "text", text }];
  let stop = "end_turn";
  if (calls) {
    try {
      content = JSON.parse(calls).tool_calls.map((c) => ({ type: "tool_use", id: `toolu_${ID_SUFFIX()}`, name: c.name, input: c.input }));
      stop = "tool_use";
    } catch {
      // Not a tool call after all: it stays as text.
    }
  }
  return { id: `msg_${ID_SUFFIX()}`, type: "message", role: "assistant", model: body.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } };
}

const sseEvent = (name, data) => `event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`;

function asStream(message) {
  const blocks = message.content.flatMap((block, index) =>
    block.type === "text"
      ? [sseEvent("content_block_start", { index, content_block: { type: "text", text: "" } }), sseEvent("content_block_delta", { index, delta: { type: "text_delta", text: block.text } }), sseEvent("content_block_stop", { index })]
      : [sseEvent("content_block_start", { index, content_block: { ...block, input: {} } }), sseEvent("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }), sseEvent("content_block_stop", { index })],
  );
  return [
    sseEvent("message_start", { message: { ...message, content: [], stop_reason: null } }),
    ...blocks,
    sseEvent("message_delta", { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 0 } }),
    sseEvent("message_stop", {}),
  ].join("");
}

/** Cards and searches show up while they happen, the same way they do with the real API. */
async function streamLive(body, res) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const start = asMessage(body, "");
  res.write(sseEvent("message_start", { message: { ...start, content: [], stop_reason: null } }));
  let index = 0;
  let textOpen = false;
  const closeText = () => {
    if (!textOpen) return;
    res.write(sseEvent("content_block_stop", { index: index++ }));
    textOpen = false;
  };
  const onText = (text) => {
    if (!textOpen) res.write(sseEvent("content_block_start", { index, content_block: { type: "text", text: "" } }));
    textOpen = true;
    res.write(sseEvent("content_block_delta", { index, delta: { type: "text_delta", text } }));
  };
  const seen = new Set();
  const onTool = ({ id, name, input }) => {
    if (!SEARCH_TOOLS[name] || seen.has(id)) return;
    seen.add(id);
    closeText();
    res.write(sseEvent("content_block_start", { index, content_block: { type: "server_tool_use", id, name: SEARCH_TOOLS[name], input: {} } }));
    res.write(sseEvent("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }));
    res.write(sseEvent("content_block_stop", { index: index++ }));
  };
  await runClaude(body, onText, onTool);
  closeText();
  res.write(sseEvent("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } }));
  res.end(sseEvent("message_stop", {}));
}

function servePage(req, res) {
  const file = path.normalize(path.join(PAGE, decodeURIComponent(new URL(req.url, "http://page").pathname.replace(/\/$/, "/index.html"))));
  if (!file.startsWith(PAGE) || !existsSync(file)) {
    res.writeHead(404);
    return res.end("Nie ma strony: zbuduj ją przez npx vite build");
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  if (file.endsWith("index.html")) return res.end(readFileSync(file, "utf8").replace("<head>", `<head><script>window.BESTIE_LOCAL=${JSON.stringify(PAGE_CONFIG)}</script>`));
  res.end(readFileSync(file));
}

/** Pinterest's own search, read the way a browser sees it: it refuses plain requests, and no account is needed. */
function pinterestImages(query) {
  return new Promise((resolve) => {
    const dir = mkdtempSync(path.join(tmpdir(), "bestie-chrome-"));
    const url = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`;
    const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", `--user-data-dir=${dir}`, "--virtual-time-budget=7000", "--window-size=1280,1600", "--dump-dom", url]);
    const timer = setTimeout(() => chrome.kill(), SEARCH_TIMEOUT);
    let html = "";
    chrome.stdout.on("data", (d) => (html += d));
    chrome.on("error", () => resolve([]));
    chrome.on("close", () => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      const found = [...html.matchAll(/https:\/\/i\.pinimg\.com\/(?:236x|474x|564x)(\/[\w/.-]+\.(?:jpg|png|webp))/g)].map((m) => `https://i.pinimg.com/736x${m[1]}`);
      resolve([...new Set(found)]);
    });
  });
}

/** Only public pages: Chrome runs on this computer, so local addresses stay out of reach. */
function isPublicUrl(raw) {
  try {
    const { protocol, hostname } = new URL(raw);
    if (protocol !== "http:" && protocol !== "https:") return false;
    return !/^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/i.test(hostname);
  } catch {
    return false;
  }
}

const shots = new Map(); // url -> PNG
const shooting = new Map(); // url -> screenshot in progress, so the card's refreshes share it
const waitingForShot = [];
let shotsRunning = 0;

function takeShot(url) {
  return new Promise((resolve) => {
    const dir = mkdtempSync(path.join(tmpdir(), "bestie-chrome-"));
    const file = path.join(dir, "shot.png");
    const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run", "--hide-scrollbars", `--user-data-dir=${dir}`, "--virtual-time-budget=3000", "--window-size=1280,800", `--screenshot=${file}`, url], { stdio: "ignore" });
    const timer = setTimeout(() => chrome.kill(), SHOT_TIMEOUT);
    const finish = () => {
      clearTimeout(timer);
      const image = existsSync(file) ? readFileSync(file) : null;
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      resolve(image);
    };
    chrome.on("error", finish);
    chrome.on("close", finish);
  });
}

function shotOf(url) {
  if (shots.has(url)) return shots.get(url);
  if (!shooting.has(url)) shooting.set(url, queueShot(url).finally(() => shooting.delete(url)));
  return shooting.get(url);
}

async function queueShot(url) {
  if (shotsRunning >= SHOT_LIMIT) await new Promise((resolve) => waitingForShot.push(resolve));
  shotsRunning++;
  try {
    const image = await takeShot(url);
    if (image) {
      shots.set(url, image);
      if (shots.size > SHOT_CACHE) shots.delete(shots.keys().next().value);
    }
    return image;
  } finally {
    shotsRunning--;
    waitingForShot.shift()?.();
  }
}

async function serveShot(req, res) {
  const url = new URL(req.url, "http://page").searchParams.get("url") ?? "";
  const image = isPublicUrl(url) ? await shotOf(url) : null;
  if (!image) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=600" });
  res.end(image);
}

async function serveImages(req, res) {
  const query = new URL(req.url, "http://page").searchParams.get("q") ?? "";
  const started = Date.now();
  const urls = query ? await pinterestImages(query.slice(0, 120)) : [];
  console.log(`[pinterest] ${query}: ${urls.length} zdjęć, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(urls));
}

const bridge = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.startsWith("/images?")) return void serveImages(req, res);
  if (req.method === "GET" && req.url.startsWith("/shot?")) return void serveShot(req, res);
  if (req.method === "GET") return servePage(req, res);
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    const started = Date.now();
    try {
      if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) throw new Error(`nieobsługiwane: ${req.url}`);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const label = isDrawing(body) ? DRAWING_MODEL : TASK_MODEL;
      if (isDrawing(body) || isSearching(body)) {
        await streamLive(body, res);
      } else {
        const message = asMessage(body, await runClaude(body));
        res.writeHead(200, { "Content-Type": body.stream ? "text/event-stream" : "application/json" });
        res.end(body.stream ? asStream(message) : JSON.stringify(message));
      }
      console.log(`[logowanie] ${label} ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (err) {
      console.error("[logowanie]", err.message);
      if (res.headersSent) return res.end();
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: err.message } }));
    }
  });
});

await new Promise((resolve) => bridge.listen(BRIDGE_PORT, "127.0.0.1", resolve));

console.log("Claude idzie przez Twoje logowanie. Klucze API są nieużywane.");
console.log(`Otwórz: http://localhost:${BRIDGE_PORT}/`);
