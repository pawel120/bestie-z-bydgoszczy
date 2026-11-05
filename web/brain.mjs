// The board's brain, running on the server so everyone shares it. Same steps as the desktop app
// (gate → plan → draw, from src/board.ts), plus a hard spending limit. Every paid call is counted.

import { createRequire, registerHooks } from "node:module";
import { createExplorers } from "./explorers.mjs";

// src/ is written for the Electron build: let Node run those TypeScript files directly.
registerHooks({
  resolve: (spec, context, next) => next(/^\.\/(tailwind|product)$/.test(spec) ? `${spec}.ts` : spec, context),
});
globalThis.require ??= createRequire(import.meta.url);

process.env.BESTIE_CLAUDE_MODEL ||= "claude-sonnet-5-5";
process.env.BESTIE_PLAN_MODEL ||= "claude-haiku-5-5";

const { planBoard, designCard, reportUsage } = await import("../src/board.ts");
const { createAgents } = await import("./agents.mjs");

const DEBOUNCE_MS = 1_200;
const MAX_WAIT_MS = 4_000;
const MAX_CARDS = 40;
const STT_PER_HOUR = 0.39;

/** USD per million tokens. An unknown model is billed at the most expensive rate, so the limit errs on the safe side. */
const PRICES = {
  "claude-sonnet-5-5": { input: 2, output: 10, write: 2.5, read: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, write: 0.125, read: 0.01 },
  "claude-opus-5-5": { input: 8, output: 40, write: 10, read: 0.4 },
};

/** Plans become plain text on the board, so a title has to read as the idea itself. */
const TEXT_ONLY = " The title is shown alone on a whiteboard: write the idea itself in at most 8 plain words, as the group would say it. Never name a screen.";
const CLICKABLE =
  "Make this a CLICKABLE mockup: 2 to 4 linked screens in one file, working without JavaScript. Put hidden radio " +
  "inputs at the start of <body>, use <label for> as the buttons and links, and show the checked radio's screen with " +
  "a small <style> block. Every primary action must lead somewhere.";

export function createBrain({ lines, cards, saveCard, agent, showVideo, onStatus, limitUsd }) {
  const keys = { anthropic: process.env.ANTHROPIC_API_KEY ?? "", groq: process.env.GROQ_API_KEY ?? "" };
  const sources = new Map(); // card id -> editable HTML
  const spend = { models: 0, speech: 0 };
  let plannedLines = 0;
  let checkedLines = 0;
  let busy = false;
  let debounce = null;
  let maxWait = null;
  let lastError = "";

  const spent = () => spend.models + spend.speech;
  const exhausted = () => spent() >= limitUsd;
  const publish = (activity) =>
    onStatus({ activity, spent: Math.round(spent() * 10000) / 10000, limit: limitUsd, stopped: exhausted(), error: lastError });

  function charge(model, usage) {
    const p = PRICES[model] ?? PRICES["claude-opus-5-5"];
    const cost =
      ((usage.input_tokens ?? 0) * p.input +
        (usage.output_tokens ?? 0) * p.output +
        (usage.cache_creation_input_tokens ?? 0) * p.write +
        (usage.cache_read_input_tokens ?? 0) * p.read) / 1_000_000;
    spend.models += cost;
    console.log(`[koszt] ${model}: ${usage.input_tokens}+${usage.output_tokens} tok, $${cost.toFixed(4)}, razem $${spent().toFixed(4)}`);
    publish(activityNow);
  }
  reportUsage(charge);
  let activityNow = "";

  const addCost = (model, usage, flat = 0) => {
    if (flat) spend.models += flat;
    if (usage) charge(model, usage);
  };
  const agents = createAgents({
    saveCard,
    addCost,
    exhausted,
    onError: (message) => {
      lastError = message;
      publish("");
    },
  });
  let researching = false;
  let nextResearch = null; // asked for while one runs: only the latest still matters

  const explorers =
    process.env.EXPLORERS !== "on"
      ? null
      : createExplorers({
          design: (op, base, transcript, partial) => designCard(keys, op, base, transcript, partial, new AbortController().signal),
          cards,
          sources,
          saveCard,
          agent,
          canSpend: () => !exhausted(),
          maxCards: MAX_CARDS,
        });

  const text = (line) => `[${line.at}] ${line.speaker}: ${line.text}`;
  const metas = () => [...cards.values()].map(({ html, src, ...meta }) => meta);

  function clearTimers() {
    clearTimeout(debounce);
    clearTimeout(maxWait);
    debounce = maxWait = null;
  }

  function changed() {
    if (exhausted()) return publish("Limit budżetu wyczerpany");
    clearTimeout(debounce);
    debounce = setTimeout(step, DEBOUNCE_MS);
    maxWait ??= setTimeout(step, MAX_WAIT_MS);
  }

  /** The card the group is on now: the newest one that isn't a research or photo result or an explorer's card. */
  const currentCard = () =>
    [...cards.values()].filter((c) => !/^(research|photos)-|~/.test(c.id)).at(-1) ?? [...cards.values()].at(-1);

  async function runResearch(request) {
    if (researching) {
      nextResearch = request;
      return;
    }
    researching = true;
    const anchor = currentCard();
    agent.show("research", "Researcher", anchor?.id ?? null, "szuka w sieci…");
    try {
      await agents.research({ request, context: lines.slice(-12).map(text).join("\n"), anchor });
    } finally {
      agent.hide("research");
      researching = false;
      publish("");
      if (nextResearch && !exhausted()) {
        const queued = nextResearch;
        nextResearch = null;
        runResearch(queued).catch(console.error);
      }
    }
  }

  /** Real photos next to the current text, and onto the current mockup when there is one. */
  async function runPhotos(request) {
    const anchor = currentCard();
    const found = await agents.photos({ request, anchor, count: 4 });
    if (!found.length || !anchor || anchor.kind !== "mockup" || !sources.has(anchor.id) || exhausted()) return;
    const urls = found.slice(0, 2).map((p) => p.link ?? p.url).join("\n");
    await draw(
      { ...anchor, op: "edit", brief: `${request}\nAdd these real photos to the screen with <img src> and object-cover. This replaces the rule against external images, for exactly these URLs:\n${urls}` },
      lines.map(text).join("\n"),
      false,
    );
  }

  async function draw(op, transcript, wantsMockup) {
    const existing = cards.get(op.id);
    if (!existing && cards.size >= MAX_CARDS) return;
    const from = cards.get(op.from);
    const base = op.op === "create" ? "" : sources.get(op.op === "edit" ? op.id : op.from) ?? sources.get(op.id) ?? "";
    const brief = wantsMockup ? `${op.brief}\n${CLICKABLE}` : op.brief;
    if (wantsMockup) op.kind = "mockup";
    const meta = { id: op.id, thread: op.thread, threadTitle: op.threadTitle, kind: op.kind, title: op.title, summary: op.summary, quote: op.quote, at: op.at, from: from?.id ?? "" };
    saveCard({ ...meta, status: "Rysuję…" });
    agent.show(op.id, "Designer", op.id, base ? "edytuje kartę…" : "rysuje…");
    let lastSent = 0;
    const partial = (html) => {
      if (Date.now() - lastSent < 1000) return;
      lastSent = Date.now();
      saveCard({ ...meta, status: "Rysuję…", html });
    };
    try {
      const drawn = await designCard(keys, { ...op, brief }, base, transcript, partial, new AbortController().signal);
      sources.set(op.id, drawn.source);
      saveCard({ ...meta, status: "", html: drawn.html });
      explorers?.explore(op, transcript); // not awaited: the conversation shouldn't wait for them
    } catch (err) {
      console.error(err);
      lastError = "Nie udało się narysować karty.";
      saveCard({ ...meta, status: "Rysowanie nie powiodło się" });
    } finally {
      agent.hide(op.id);
    }
  }

  /** The default for anything said: the idea as text, then a picture if one fits it. */
  function writeIdea(op) {
    if (!cards.has(op.id) && cards.size >= MAX_CARDS) return;
    const from = cards.get(op.from);
    saveCard({ id: op.id, thread: op.thread, threadTitle: op.threadTitle, kind: "idea", title: op.title, summary: op.summary, quote: op.quote, at: op.at, from: from?.id ?? "", status: "" });
    if (op.op === "create" && !exhausted()) agents.photos({ request: op.title, anchor: cards.get(op.id), count: 2 }).catch(console.error);
  }

  function applyOp(op, transcript, wantsMockup) {
    if (op.op === "edit" && sources.has(op.id)) return draw(op, transcript, false);
    if (!wantsMockup) return writeIdea(op);
    // A mockup grows out of the text it visualises; the text stays on the board.
    if (cards.has(op.id) && !sources.has(op.id)) return draw({ ...op, op: "evolve", from: op.id, id: `${op.id}-makieta` }, transcript, true);
    return draw(op, transcript, true);
  }

  async function step() {
    clearTimers();
    if (busy || exhausted() || lines.length === checkedLines) return;
    busy = true;
    const seen = lines.length;
    lastError = "";
    try {
      publish("Słucham");
      const earlier = lines.slice(Math.max(0, checkedLines - 6), checkedLines).map(text).join("\n");
      const { action, topic } = await agents.route(earlier, lines.slice(checkedLines, seen).map(text).join("\n"));
      console.log(`[polecenie] ${action}: ${topic}`);
      if (exhausted() || action === "none") {
        checkedLines = seen;
        return;
      }
      if (action === "stop_video") {
        checkedLines = plannedLines = seen;
        showVideo(null);
        return;
      }
      if (action === "video") {
        checkedLines = plannedLines = seen;
        agents
          .video(topic)
          .then((video) => (video ? showVideo(video) : Promise.reject(new Error(`Nie ma filmu: ${topic}`))))
          .catch((err) => {
            console.error(err);
            lastError = "Nie udało się włączyć filmu.";
            publish("");
          });
        return;
      }
      if (action === "research" || action === "photos") {
        checkedLines = plannedLines = seen;
        (action === "research" ? runResearch : runPhotos)(topic).catch(console.error);
        return;
      }
      publish("Planuję");
      agent.show("planner", "Planer", null, "czyta rozmowę…");
      const transcript = lines.map(text).join("\n");
      const ops = await planBoard(keys, transcript, metas(), action + TEXT_ONLY);
      checkedLines = plannedLines = seen;
      agent.hide("planner");
      const wantsMockup = action === "mockup";
      if (ops.length && wantsMockup) publish("Rysuję");
      await Promise.all(ops.slice(0, 2).map((op) => applyOp(op, transcript, wantsMockup)));
    } catch (err) {
      console.error(err);
      checkedLines = seen; // don't pay for the same failing step again; the next line tries anew
      lastError = "Tablica chwilowo nie odpowiada.";
    } finally {
      agent.hide("planner");
      busy = false;
      publish(exhausted() ? "Limit budżetu wyczerpany" : researching ? "Research w toku" : "");
      if (lines.length !== checkedLines && !exhausted()) changed();
    }
  }

  return {
    changed,
    exhausted,
    publish,
    addSpeech(seconds) {
      spend.speech += (Math.min(Math.max(seconds, 0), 15) / 3600) * STT_PER_HOUR;
      publish("");
    },
    reset() {
      sources.clear();
      explorers?.reset();
    },
  };
}
