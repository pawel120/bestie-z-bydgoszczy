// The desktop app (../src/renderer/app.mts) running in a browser. Electron's preload API (`window.bestie`) is
// implemented here on top of the same board engine (../src/board.ts), called straight from the page.
//
// In the Recall bot (#c=… with bot: true): getUserMedia() is the meeting audio, so it is fed in as the desktop app's
// "system audio" ("Rozmówcy"), the bot's own "microphone" is silence, and recording starts on its own.

import "../../src/renderer/styles.css";
import { designCard, gateBoard, planBoard, replicateProduct, resetCosts, watchCosts, type BoardItem, type PlanOp } from "../../src/board";
import type { BestieApi } from "../../src/preload";
import { readConfig } from "./config";

type KeyName = "elevenlabs" | "groq" | "anthropic" | "openrouter";

const config = readConfig();
const stored: Partial<Record<KeyName | "language", string>> = JSON.parse(localStorage.getItem("bestie") ?? "{}");
const key = (name: KeyName) => config[name] || stored[name] || "";
const save = () => localStorage.setItem("bestie", JSON.stringify(stored));

// MARK: - Recall bot: meeting audio in, no user gestures

if (config.bot) {
  const devices = navigator.mediaDevices;
  const meetingAudio = devices.getUserMedia.bind(devices);
  // Desktop: getDisplayMedia = system audio (the other people). In the bot that is the meeting itself.
  devices.getDisplayMedia = () => meetingAudio({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  // Desktop: getUserMedia = your microphone ("Ja"). The bot doesn't speak: give it silence.
  devices.getUserMedia = async () => new AudioContext().createMediaStreamDestination().stream;
  // Nobody clicks in the bot's browser, so audio contexts must not wait for a gesture.
  const Original = window.AudioContext;
  window.AudioContext = class extends Original {
    constructor(options?: AudioContextOptions) {
      super(options);
      void this.resume();
    }
  };
}

// MARK: - window.bestie

const transcript: string[] = [];
let board: BoardItem[] = [];
const partialListeners: ((id: string, html: string) => void)[] = [];
const productListeners: ((html: string) => void)[] = [];
const drawing = new Map<string, AbortController>();
const keys = () => ({ groq: key("groq"), anthropic: key("anthropic") });

function download(name: string, text: string, type = "text/markdown") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
}

const api: BestieApi = {
  platform: "web" as NodeJS.Platform,
  getSettings: async () => ({
    hasElevenLabsKey: !!key("elevenlabs"),
    hasGroqKey: !!key("groq"),
    hasAnthropicKey: !!key("anthropic"),
    hasOpenRouterKey: !!key("openrouter"),
    language: config.lang ?? stored.language ?? "auto",
  }),
  setApiKey: async (name, value) => {
    stored[name] = value;
    save();
  },
  setLanguage: async (language) => {
    stored.language = language;
    save();
  },
  scribeToken: async () => {
    const apiKey = key("elevenlabs");
    if (!apiKey) throw new Error("Brak klucza API ElevenLabs.");
    const res = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", { method: "POST", headers: { "xi-api-key": apiKey } });
    if (!res.ok) throw new Error(`ElevenLabs token: HTTP ${res.status} ${await res.text()}`);
    return ((await res.json()) as { token: string }).token;
  },
  startSession: async () => {
    transcript.length = 0;
    board = [];
    return "przeglądarka";
  },
  appendTranscript: async (line) => void transcript.push(line),
  appendAudio: async () => {}, // the recording stays at Recall
  finishSession: async () => null,
  // The folder button downloads the transcript and the board instead of opening a folder.
  revealRecordings: async () => {
    download("transkrypcja.md", `# Spotkanie\n\n${transcript.join("")}`);
    if (board.length) download("tablica.json", JSON.stringify(board, null, 2), "application/json");
  },
  gateBoard: async (recent, cards) => (key("openrouter") ? gateBoard(key("openrouter"), recent, cards) : null),
  planBoard: async (text, cards, hint) => {
    if (!key("groq") && !key("anthropic")) throw new Error("Brak klucza Claude ani Groq — tablica wyłączona.");
    return planBoard(keys(), text, cards, hint);
  },
  // One in-flight drawing per card; a newer version of the same card cancels the old one.
  designCard: async (op: PlanOp, base, text) => {
    drawing.get(op.id)?.abort();
    const controller = new AbortController();
    drawing.set(op.id, controller);
    try {
      return await designCard(
        keys(),
        op,
        base,
        text,
        (html) => {
          if (!controller.signal.aborted) for (const listener of partialListeners) listener(op.id, html);
        },
        controller.signal,
      );
    } catch (err) {
      if (controller.signal.aborted) return null; // superseded
      throw err;
    } finally {
      if (drawing.get(op.id) === controller) drawing.delete(op.id);
    }
  },
  onBoardPartial: (listener) => void partialListeners.push(listener),
  // The base product needs a screenshot of another site, which a web page can't take.
  loadProduct: async () => {
    throw new Error("produkt bazowy działa tylko w aplikacji desktop (potrzebny zrzut strony)");
  },
  clearProduct: async () => {},
  replicateProduct: async () =>
    key("anthropic")
      ? replicateProduct(key("anthropic"), (html) => productListeners.forEach((l) => l(html)), new AbortController().signal)
      : null,
  onProductPartial: (listener) => void productListeners.push(listener),
  onCosts: (listener) => watchCosts(listener),
  resetCosts: async () => resetCosts(),
  saveBoard: async (items) => void (board = items),
};

// MARK: - Live view (/#view): the bot pushes snapshots of its screen, viewers replay them

const VIEW_W = 1280;
const VIEW_H = 720;
const liveUrl = (role: string) =>
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live?role=${role}${config.live ? `&token=${config.live}` : ""}`;

/**
 * The body plus every shadow root (the cards) separately: hosts get a data-sr index, the viewer re-attaches them.
 * Plain innerHTML, so it works in older Chromium builds (the bot's browser) that lack getHTML().
 */
function snapshot() {
  const hosts = [...document.querySelectorAll("*")].filter((el) => el.shadowRoot);
  hosts.forEach((el, i) => el.setAttribute("data-sr", String(i)));
  const body = document.body.innerHTML;
  hosts.forEach((el) => el.removeAttribute("data-sr"));
  const shadows = hosts.map((el) => el.shadowRoot!.innerHTML);
  const styles = [...document.head.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  // The theme follows the bot's (light) system setting: send the resolved colours so viewers look the same.
  const computed = getComputedStyle(document.documentElement);
  const theme = Object.fromEntries([...computed].filter((name) => name.startsWith("--")).map((name) => [name, computed.getPropertyValue(name)]));
  return JSON.stringify({ body, shadows, bodyClass: document.body.className, styles, theme, dark: matchMedia("(prefers-color-scheme: dark)").matches });
}

function pushLive() {
  let ws: WebSocket | null = null;
  let last = "";
  const log = (text: string) => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ log: text }));
  // The bot's console is invisible otherwise: forward errors and the status line to serve.mjs.
  addEventListener("error", (e) => log(`error: ${e.message}`));
  addEventListener("unhandledrejection", (e) => log(`rejection: ${e.reason}`));
  const connect = () => {
    ws = new WebSocket(liveUrl("bot"));
    ws.onopen = () => log(`połączono · ${navigator.userAgent}`);
    ws.onclose = () => window.setTimeout(connect, 2000);
  };
  connect();
  let status = "";
  window.setInterval(() => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    try {
      const next = snapshot();
      if (next !== last) ws.send((last = next));
      const now = document.getElementById("status")?.textContent ?? "";
      if (now && now !== status) log(`status: ${(status = now)}`);
    } catch (err) {
      log(`snapshot: ${err}`);
    }
  }, 1000);
}

function viewLive() {
  document.title = "Bestie · na żywo";
  const extra = document.createElement("style");
  document.head.append(extra);
  const fit = document.createElement("style");
  document.head.append(fit);
  const resize = () => {
    const k = Math.min(innerWidth / VIEW_W, innerHeight / VIEW_H);
    fit.textContent = `html { background: #000; overflow: hidden; }
      body { width: ${VIEW_W}px !important; height: ${VIEW_H}px !important; transform-origin: 0 0; pointer-events: none;
        transform: translate(${(innerWidth - VIEW_W * k) / 2}px, ${(innerHeight - VIEW_H * k) / 2}px) scale(${k}); }`;
  };
  addEventListener("resize", resize);
  resize();
  document.body.innerHTML = '<p style="color:#888;font:16px system-ui;text-align:center;margin-top:30vh">Czekam na obraz z bota…</p>';
  const connect = () => {
    const ws = new WebSocket(liveUrl("view"));
    ws.onmessage = (e) => {
      const { body, shadows, bodyClass, styles, theme, dark } = JSON.parse(String(e.data));
      for (const [name, value] of Object.entries(theme ?? {})) document.documentElement.style.setProperty(name, String(value));
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
      extra.textContent = styles;
      document.body.className = bodyClass;
      document.body.innerHTML = body;
      for (const host of document.querySelectorAll<HTMLElement>("[data-sr]")) {
        (host.shadowRoot ?? host.attachShadow({ mode: "open" })).innerHTML = shadows[Number(host.dataset.sr)] ?? "";
      }
    };
    ws.onclose = () => window.setTimeout(connect, 2000);
  };
  connect();
}

const viewing = location.hash === "#view";
if (viewing) viewLive();

window.bestie = api;

// In the Recall version the board gets the whole screen: no transcript panel (it is still recorded and downloadable).
document.head.append(Object.assign(document.createElement("style"), { textContent: ".transcript-panel { display: none !important; }" }));
if (viewing) throw new Error("live view"); // stop here: the viewer only replays the bot's screen
await import("../../src/renderer/app.mts");
if (config.bot && config.live) pushLive();

// The bot starts listening as soon as the page is up.
if (config.bot) {
  const record = document.getElementById("record") as HTMLButtonElement;
  const settings = await api.getSettings();
  if (settings.hasElevenLabsKey && !record.disabled) record.click();
}
