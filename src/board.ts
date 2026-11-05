// Whiteboard brain: turns the running meeting transcript into mockups / flows / idea notes via Groq.

import Anthropic from "@anthropic-ai/sdk";
import { inlineTailwind } from "./tailwind";

export interface BoardItem {
  id: string;
  kind: "mockup" | "flow" | "idea";
  title: string;
  summary: string;
  html: string;
}

export const GROQ_MODEL = "openai/gpt-oss-120b";
/** Groq model that draws the cards when no Claude key is set; e.g. BESTIE_DESIGNER_MODEL=qwen/qwen3.8-27b. */
const DESIGNER_MODEL = process.env.BESTIE_DESIGNER_MODEL || GROQ_MODEL;
/** With a Claude key, cards are drawn by Opus in fast mode: ~0.7 s to first token, ~390 tok/s, best-looking cards. */
const CLAUDE_DESIGNER_MODEL = "claude-opus-5-5";

const PLANNER_PROMPT = `You are the live whiteboard of a brainstorming meeting. People talk; you decide what the board
should show so they can react to it while still talking.

You get the transcript so far (with timestamps and speakers) and the current board.
Return ONLY the changes needed so the board reflects the conversation now:
- "upserts": new items, or existing items (same id) whose content should change because the discussion moved on.
- "removals": ids of items the group explicitly dropped.

Item kinds:
- "mockup": a concrete UI screen of a product idea being discussed.
- "flow": a user flow / architecture / process the group described.
- "idea": a concept that is not visual yet (pitch, value, risks, open questions).

For each upsert write a "brief" for the designer who will draw it: what exactly to show, which screen / steps,
the key content and data, and what the group said about it. Be specific — the designer only sees your brief.

Rules:
- Prefer few strong items over many weak ones; keep the board at most 8 items. Merge variants into one item unless
  the group is explicitly comparing alternatives (then one mockup per variant).
- Never add an item that overlaps an existing one (same product, same flow) — update or remove the old one instead.
- Whenever the conversation is about a product, the board must contain a mockup of its main screen; that is what
  makes the board useful. Ideas and flows support it.
- When people refine an idea, update its existing item instead of creating a new one. Keep ids stable; new ids are
  short kebab-case slugs.
- Only return items that are new or materially changed. Return empty arrays if nothing on the board should change.
- LANGUAGE: title, summary and brief in the language people speak in the transcript (a Polish conversation →
  Polish), even though these instructions are in English.
- summary is one sentence on what changed and why.`;

export const DESIGNER_PROMPT = `You are a world-class product designer (Linear / Vercel / Stripe level) drawing one card of a
live meeting whiteboard. Output ONLY a complete HTML document starting with <!doctype html> — no markdown fences, no
commentary.

STACK
- Style exclusively with Tailwind CSS v4 utility classes in class="…" (they are compiled for you). No <style> blocks
  unless something truly can't be done with utilities. No <script>. No external URLs, images or fonts.
- <body class="m-0 w-[960px] h-[600px] overflow-hidden antialiased font-sans text-zinc-900 bg-white">.
- Icons: inline <svg> in the Lucide style (viewBox="0 0 24 24", fill="none", stroke="currentColor", stroke-width="2",
  stroke-linecap="round", stroke-linejoin="round", size-4 or size-5). NEVER use emoji as icons or decoration.
- Never draw image placeholders (grey boxes, 🖼, "image here"). Use real content instead: avatars as coloured circles
  with initials, charts as SVG paths or div bars, thumbnails as subtle gradients (from-indigo-500 to-violet-500 etc.).

VISUAL LANGUAGE
- The card is viewed SCALED DOWN on a whiteboard (about 60%), so design big and bold: fewer, larger elements,
  base text-base, labels text-sm minimum (never text-xs for content), headings text-3xl font-semibold tracking-tight.
- Neutral zinc palette with ONE accent colour (indigo or violet by default) used sparingly for primary actions,
  selection and key numbers. Plenty of white space; 8 px spacing grid (p-4, p-6, gap-3, gap-6).
- Typography: text-sm text-zinc-500 for meta, font-medium for labels, max two font weights per block.
- Surfaces: rounded-xl, border border-zinc-200, shadow-sm at most; dividers with divide-zinc-100.
- Believable, specific copy and data in the language of the brief (names, numbers, dates, statuses). No lorem ipsum.

BY KIND
- mockup: a real app screen filling the 960x600 frame — typically a left sidebar (w-56, nav items with icons, one
  active) or top bar, a page header with title + primary button, and a content area (lists, cards, tables, inputs,
  states like "live", progress, avatars). Make the core idea of the brief the hero of the screen.
- flow: a clean diagram with AT MOST 5 steps per row (merge minor steps; if there are more, use a second row) laid
  out in a CSS grid with fixed column widths so nothing overlaps or overflows the 960 px width; each step is a card (numbered accent circle, icon, title, one-line description). Put connectors as separate flex items
  BETWEEN cards (a short line + chevron SVG). Highlight the key step with the accent ring. Title + subtitle on top.
- idea: an elegant one-pager — small eyebrow label, bold one-line pitch (text-2xl), a short paragraph, then three
  columns "Wartość / Ryzyka / Otwarte pytania" (translated to the brief's language) with icon headers and 3 bullets.`;

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["upserts", "removals"],
  properties: {
    upserts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kind", "title", "summary", "brief"],
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["mockup", "flow", "idea"] },
          title: { type: "string" },
          summary: { type: "string" },
          brief: { type: "string" },
        },
      },
    },
    removals: { type: "array", items: { type: "string" } },
  },
};

export type PlannedItem = Omit<BoardItem, "html"> & { brief: string };

export interface BoardPlan {
  upserts: PlannedItem[];
  removals: string[];
}

/** Keeps the prompt bounded on long meetings: the newest part of the transcript matters most. */
const MAX_TRANSCRIPT_CHARS = 24_000;
const recentPart = (transcript: string) =>
  transcript.length > MAX_TRANSCRIPT_CHARS ? "…\n" + transcript.slice(-MAX_TRANSCRIPT_CHARS) : transcript;

function request(apiKey: string, body: object, model: string, signal?: AbortSignal) {
  return fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, ...(model.startsWith("openai/") ? { reasoning_effort: "low" } : {}), ...body }),
    signal,
  });
}

async function failure(res: Response) {
  return new Error(`Groq: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}

/** Step 1 (~1 s): decide which cards to add / change / remove. */
export async function planBoard(apiKey: string, transcript: string, board: Omit<BoardItem, "html">[]): Promise<BoardPlan> {
  const boardSummary = board.map(({ id, kind, title, summary }) => ({ id, kind, title, summary }));
  const res = await request(
    apiKey,
    {
      max_completion_tokens: 6_000,
      messages: [
        { role: "system", content: PLANNER_PROMPT },
        {
          role: "user",
          content: `Current board:\n${JSON.stringify(boardSummary, null, 2)}\n\nTranscript (the last line may still be in progress):\n${recentPart(transcript)}`,
        },
      ],
      response_format: { type: "json_schema", json_schema: { name: "board_plan", strict: true, schema: PLAN_SCHEMA } },
    },
    GROQ_MODEL,
  );
  if (!res.ok) throw await failure(res);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return JSON.parse(data.choices[0].message.content) as BoardPlan;
}

const stripFences = (html: string) => html.replace(/^\s*```(?:html)?\s*/i, "").replace(/```\s*$/, "");

const designerInput = (item: PlannedItem, transcript: string) =>
  `Kind: ${item.kind}\nTitle: ${item.title}\nBrief: ${item.brief}\n\nRecent conversation for context:\n${transcript.slice(-4_000)}`;

/** Re-renders the partial card a few times per second; more would just make the iframe flicker. */
function throttledPartial(onPartial: (html: string) => void) {
  let lastEmit = 0;
  return async (html: string) => {
    if (Date.now() - lastEmit < 350 || html.length < 200) return;
    lastEmit = Date.now();
    onPartial(await inlineTailwind(stripFences(html)));
  };
}

export interface DesignKeys {
  groq: string;
  anthropic: string;
}

/**
 * Step 2: draw one card, streaming. `onPartial` gets the HTML so far (Tailwind already inlined) so the card can
 * build up live; resolves with the final HTML.
 */
export async function designCard(
  keys: DesignKeys,
  item: PlannedItem,
  transcript: string,
  onPartial: (html: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const html = keys.anthropic
    ? await designWithClaude(keys.anthropic, item, transcript, throttledPartial(onPartial), signal)
    : await designWithGroq(keys.groq, item, transcript, throttledPartial(onPartial), signal);
  return inlineTailwind(stripFences(html).trim());
}

async function designWithClaude(
  apiKey: string,
  item: PlannedItem,
  transcript: string,
  partial: (html: string) => Promise<void>,
  signal: AbortSignal,
) {
  const client = new Anthropic({ apiKey });
  let html = "";
  const stream = client.beta.messages.stream(
    {
      model: CLAUDE_DESIGNER_MODEL,
      max_tokens: 16_000,
      speed: "fast",
      betas: ["fast-mode-2026-02-01", "server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: DESIGNER_PROMPT,
      messages: [{ role: "user", content: designerInput(item, transcript) }],
    },
    { signal },
  );
  stream.on("text", (text) => {
    html += text;
    void partial(html);
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("Claude odmówił narysowania tej karty.");
  return html;
}

async function designWithGroq(
  apiKey: string,
  item: PlannedItem,
  transcript: string,
  partial: (html: string) => Promise<void>,
  signal: AbortSignal,
) {
  const res = await request(
    apiKey,
    {
      stream: true,
      max_completion_tokens: 12_000,
      messages: [
        { role: "system", content: DESIGNER_PROMPT },
        { role: "user", content: designerInput(item, transcript) },
      ],
    },
    DESIGNER_MODEL,
    signal,
  );
  if (!res.ok || !res.body) throw await failure(res);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let html = "";
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta?.content;
      if (delta) html += delta;
    }
    await partial(html);
  }
  return html;
}

/** Standalone gallery of the board, saved next to the recording. */
export function boardToHtml(title: string, board: BoardItem[]) {
  const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const cards = board
    .map(
      (item) => `<article><h2>${escape(item.title)} <small>${item.kind}</small></h2><p>${escape(item.summary)}</p>
<iframe sandbox srcdoc="${escape(item.html)}"></iframe></article>`,
    )
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title>
<style>body{font:14px system-ui;margin:24px;background:#f5f5f7}article{background:#fff;border-radius:12px;padding:16px;margin:0 0 24px}
iframe{width:100%;height:600px;border:1px solid #ddd;border-radius:8px}small{color:#888;font-weight:400}</style>
<h1>${escape(title)}</h1>${cards}`;
}
