// Runs the room on this computer through your own Claude login, so no API credits are used.
// The room keeps talking to "the Claude API", but at a local address, where each request becomes a `claude -p` call.
//
//   node web/local.mjs
//
// Usage counts against your Claude plan's limits. Speech uses the browser's free recognition.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const BRIDGE_PORT = Number(process.env.BRIDGE_PORT || 4310);
const CALL_TIMEOUT = 180_000;
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

function runClaude(body) {
  const dir = mkdtempSync(path.join(tmpdir(), "bestie-"));
  const searches = (body.tools ?? []).some(isSearch) && body.tool_choice?.type !== "none";
  const args = ["-p", "--output-format", "json", "--model", body.model, "--no-session-persistence", "--strict-mcp-config", "--setting-sources", "", "--tools", searches ? "WebSearch,WebFetch" : ""];
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
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer);
      rmSync(dir, { recursive: true, force: true });
      try {
        const result = JSON.parse(out);
        if (result.is_error) return reject(new Error(String(result.result ?? "błąd Claude").slice(0, 300)));
        resolve(result.structured_output ? JSON.stringify(result.structured_output) : String(result.result ?? ""));
      } catch {
        reject(new Error((err || out || "brak odpowiedzi").slice(0, 300)));
      }
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

function asStream(message) {
  const event = (name, data) => `event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`;
  const blocks = message.content.flatMap((block, index) =>
    block.type === "text"
      ? [event("content_block_start", { index, content_block: { type: "text", text: "" } }), event("content_block_delta", { index, delta: { type: "text_delta", text: block.text } }), event("content_block_stop", { index })]
      : [event("content_block_start", { index, content_block: { ...block, input: {} } }), event("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) } }), event("content_block_stop", { index })],
  );
  return [
    event("message_start", { message: { ...message, content: [], stop_reason: null } }),
    ...blocks,
    event("message_delta", { delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: 0 } }),
    event("message_stop", {}),
  ].join("");
}

const bridge = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", async () => {
    const started = Date.now();
    try {
      if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) throw new Error(`nieobsługiwane: ${req.url}`);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const message = asMessage(body, await runClaude(body));
      console.log(`[logowanie] ${body.model} ${((Date.now() - started) / 1000).toFixed(1)} s`);
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(asStream(message));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(message));
      }
    } catch (err) {
      console.error("[logowanie]", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: err.message } }));
    }
  });
});

await new Promise((resolve) => bridge.listen(BRIDGE_PORT, "127.0.0.1", resolve));

// Set before the room loads .env, which never overrides what is already set: the real keys stay unused.
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${BRIDGE_PORT}`;
process.env.ANTHROPIC_API_KEY = "login";
// Opus draws; Sonnet does the tasks around it.
process.env.BESTIE_CLAUDE_MODEL ||= "claude-opus-5-5";
for (const task of ["BESTIE_PLAN_MODEL", "BESTIE_RESEARCH_MODEL", "BESTIE_QUERY_MODEL"]) process.env[task] ||= "claude-sonnet-5-5";
for (const name of ["ELEVENLABS_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"]) process.env[name] = "";

console.log("Claude idzie przez Twoje logowanie. Klucze API są nieużywane.");
await import("./server.mjs");
