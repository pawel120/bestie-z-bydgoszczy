#!/usr/bin/env node
// Sends the Recall.ai bot into a Google Meet. The bot opens the Bestie page (the desktop app built for the web from
// this folder, hosted anywhere public) and screen-shares it; the page does all the listening and drawing itself.
//
//   npm run bot -- https://meet.google.com/abc-defg-hij      send the bot (Ctrl+C makes it leave)
//   npm run bot -- --local                                  page URL with keys, for testing in your own browser
//   npm run bot -- --leave <bot id>                         make a bot leave
//
// Env (recall/.env, then ../.env): RECALL_API_KEY, RECALL_REGION (us-west-2), BESTIE_WEB_URL (where the page is
// hosted), BESTIE_LANG (pl), ELEVENLABS_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
for (const file of [path.join(here, ".env"), path.join(here, "..", ".env")]) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const env = process.env;

const STATUS = {
  joining_call: "dołącza do spotkania…",
  in_waiting_room: "czeka w poczekalni — wpuść go w Meet",
  in_call_not_recording: "jest w spotkaniu",
  recording_permission_allowed: "nagrywanie dozwolone",
  recording_permission_denied: "gospodarz nie zezwolił na nagrywanie",
  in_call_recording: "słucha i udostępnia tablicę",
  call_ended: "opuścił spotkanie",
  done: "zakończył",
  fatal: "nie mógł dołączyć",
};
const FINAL = new Set(["call_ended", "done", "fatal"]);

const region = env.RECALL_REGION || "us-west-2";
async function recall(method, apiPath, body) {
  const res = await fetch(`https://${region}.recall.ai/api/v1/${apiPath}`, {
    method,
    headers: { Authorization: `Token ${env.RECALL_API_KEY}`, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Recall ${method} /${apiPath}: HTTP ${res.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function pageUrl(base, bot) {
  const config = {
    elevenlabs: env.ELEVENLABS_API_KEY,
    groq: env.GROQ_API_KEY,
    anthropic: env.ANTHROPIC_API_KEY,
    openrouter: env.OPENROUTER_API_KEY,
    lang: option("--lang") || env.BESTIE_LANG || "pl",
    bot,
    handsfree: true,
  };
  const encoded = Buffer.from(JSON.stringify(config)).toString("base64url");
  return `${base.replace(/\/?$/, "/")}#c=${encoded}`;
}

if (flag("--local")) {
  console.log(pageUrl(option("--url") || "http://localhost:5173", false));
  process.exit(0);
}

if (!env.RECALL_API_KEY) {
  console.error("Brak RECALL_API_KEY (recall/.env albo .env w katalogu wyżej).");
  process.exit(1);
}

if (flag("--leave")) {
  await recall("POST", `bot/${option("--leave")}/leave_call/`);
  console.log("Bot wychodzi.");
  process.exit(0);
}

const meeting = args.find((a) => /meet\.google\.com|zoom\.us|teams\./.test(a));
const base = option("--url") || env.BESTIE_WEB_URL;
if (!meeting || !base) {
  console.error("Użycie: npm run bot -- https://meet.google.com/xxx-xxxx-xxx [--url https://strona-bestie] [--lang pl]");
  if (!base) console.error("Brak adresu strony: --url albo BESTIE_WEB_URL.");
  process.exit(1);
}

const body = {
  meeting_url: meeting.startsWith("http") ? meeting : `https://${meeting}`,
  bot_name: option("--name") || env.BESTIE_BOT_NAME || "Bestie",
  output_media: { screenshare: { kind: "webpage", config: { url: pageUrl(base, true) } } },
  // The page transcribes, plans and renders cards itself: give it the bigger instance.
  variant: { google_meet: "web_4_core", zoom: "web_4_core", microsoft_teams: "web_4_core" },
};

const bot = await recall("POST", "bot/", body);
console.log(`Bot ${bot.id} wysłany do ${body.meeting_url}`);
console.log(`Wyjście: Ctrl+C albo npm run bot -- --leave ${bot.id}`);

let last = "";
let leaving = false;
process.on("SIGINT", async () => {
  if (leaving) process.exit(1);
  leaving = true;
  console.log("\nBot wychodzi…");
  await recall("POST", `bot/${bot.id}/leave_call/`).catch((err) => console.error(String(err)));
  process.exit(0);
});

for (;;) {
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const status = (await recall("GET", `bot/${bot.id}/`)).status_changes?.at(-1);
    if (status && status.code !== last) {
      last = status.code;
      console.log(`[${new Date().toLocaleTimeString("pl")}] Bot ${STATUS[status.code] ?? status.code}${status.sub_code ? ` (${status.sub_code})` : ""}`);
      if (FINAL.has(status.code)) process.exit(0);
    }
  } catch (err) {
    console.error(String(err));
  }
}
