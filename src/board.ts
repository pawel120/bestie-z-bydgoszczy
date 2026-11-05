// Whiteboard brain: turns the running meeting transcript into mockups / flows / idea notes via Groq.

import { inlineTailwind } from "./tailwind";

export interface BoardItem {
  id: string;
  kind: "mockup" | "flow" | "idea";
  title: string;
  summary: string;
  html: string;
}

export interface BoardUpdate {
  upserts: BoardItem[];
  removals: string[];
}

export const GROQ_MODEL = "openai/gpt-oss-120b";
/** Model that draws the cards; e.g. BESTIE_DESIGNER_MODEL=qwen/qwen3.8-27b to compare. */
const DESIGNER_MODEL = process.env.BESTIE_DESIGNER_MODEL || GROQ_MODEL;

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

const DESIGNER_PROMPT = `You are a world-class product designer (Linear / Vercel / Stripe level) drawing one card of a
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

type PlannedItem = Omit<BoardItem, "html"> & { brief: string };

/** Keeps the prompt bounded on long meetings: the newest part of the transcript matters most. */
const MAX_TRANSCRIPT_CHARS = 24_000;

async function chat(apiKey: string, body: object, model = GROQ_MODEL): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, ...(model.startsWith("openai/") ? { reasoning_effort: "low" } : {}), ...body }),
  });
  if (!res.ok) throw new Error(`Groq: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0].message.content;
}

async function design(apiKey: string, item: PlannedItem, transcript: string): Promise<string> {
  const html = await chat(apiKey, {
    max_completion_tokens: 12_000,
    messages: [
      { role: "system", content: DESIGNER_PROMPT },
      {
        role: "user",
        content: `Kind: ${item.kind}\nTitle: ${item.title}\nBrief: ${item.brief}\n\nRecent conversation for context:\n${transcript.slice(-4_000)}`,
      },
    ],
  }, DESIGNER_MODEL);
  return inlineTailwind(html.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim());
}

/** Planner decides what changes; designers draw the changed cards in parallel. */
export async function updateBoard(apiKey: string, transcript: string, board: BoardItem[]): Promise<BoardUpdate> {
  const recent =
    transcript.length > MAX_TRANSCRIPT_CHARS ? "…\n" + transcript.slice(-MAX_TRANSCRIPT_CHARS) : transcript;
  const boardSummary = board.map(({ id, kind, title, summary }) => ({ id, kind, title, summary }));

  const plan = JSON.parse(
    await chat(apiKey, {
      max_completion_tokens: 6_000,
      messages: [
        { role: "system", content: PLANNER_PROMPT },
        { role: "user", content: `Current board:\n${JSON.stringify(boardSummary, null, 2)}\n\nTranscript:\n${recent}` },
      ],
      response_format: { type: "json_schema", json_schema: { name: "board_plan", strict: true, schema: PLAN_SCHEMA } },
    }),
  ) as { upserts: PlannedItem[]; removals: string[] };

  const upserts = await Promise.all(
    plan.upserts.map(async ({ brief, ...item }) => ({ ...item, html: await design(apiKey, { ...item, brief }, recent) })),
  );
  return { upserts, removals: plan.removals };
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
