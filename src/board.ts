// Whiteboard brain. Per change in the conversation:
//   1. gate (Jev decisions model, ~0.4 s): is there anything worth drawing — a new idea, a new version, a small edit?
//   2. plan (Groq gpt-oss-120b, ~2 s): which thread / card, what changes, and the quote it came from;
//   3. draw (Claude Opus fast, streaming): new cards from scratch, existing ones by str_replace edits.

import Anthropic from "@anthropic-ai/sdk";
import type { Product } from "./product";
import { inlineTailwind } from "./tailwind";

export type Kind = "mockup" | "flow" | "idea";

/** A card on the timeline. A thread is one idea; each card in it is a version, left to right. */
export interface BoardItem {
  id: string;
  thread: string;
  threadTitle: string;
  kind: Kind;
  title: string;
  summary: string;
  /** Card this one evolved from ("" for the first card of a thread). */
  from: string;
  /** What was said that produced this card, and when. */
  quote: string;
  at: string;
  /** Model-written HTML (what gets edited) and the rendered HTML with Tailwind inlined. */
  source: string;
  html: string;
}

export type CardMeta = Omit<BoardItem, "source" | "html">;

export interface PlanOp extends CardMeta {
  /** create: first card of a new thread · evolve: new version next to `from` · edit: small change in place. */
  op: "create" | "evolve" | "edit";
  brief: string;
}

export type GateAction = "create" | "evolve" | "edit" | "wait";

export interface Gate {
  action: GateAction;
  confidence: number;
  /** Thread the conversation is about, when the board already has threads. */
  thread: string | null;
}

export const GROQ_MODEL = "openai/gpt-oss-120b";
/** Groq model that draws the cards when no Claude key is set; e.g. BESTIE_DESIGNER_MODEL=qwen/qwen3.8-27b. */
const DESIGNER_MODEL = process.env.BESTIE_DESIGNER_MODEL || GROQ_MODEL;
/** With a Claude key, cards are drawn by Opus in fast mode: ~0.7 s to first token, ~390 tok/s, best-looking cards. */
const CLAUDE_DESIGNER_MODEL = "claude-opus-5-5";
const JEV_MODEL = "typesafe/jev-1.14";

/** The existing product the meeting is about (optional): every card is designed as part of it. */
let product: Product | null = null;
export function setProduct(next: Product | null) {
  product = next;
}

const productText = () =>
  product
    ? `BASE PRODUCT — the group is discussing features of this existing product: ${product.title} (${product.url}).\n` +
      `${product.description}\nDesign every card as a screen or part of THIS product, in its visual language ` +
      `(the screenshot shows it):\n${product.designSystem}`
    : "";

/** Product context as cacheable content blocks: identical for every card, so it is billed once per ~5 minutes. */
function productBlocks(): Anthropic.Beta.BetaContentBlockParam[] {
  if (!product) return [];
  return [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: product.reference } },
    { type: "text", text: productText(), cache_control: { type: "ephemeral" } },
  ];
}

const PLANNER_PROMPT = `You are the live whiteboard of a brainstorming meeting. The board is a TIMELINE: every idea is a
thread (a row), and every card in a thread is a version of that idea, left to right in the order the group thought
of it. People should be able to read the board later and see where each idea came from and how it evolved.

You get the board (threads with their cards, oldest first), the transcript (the last line may still be in
progress) and a hint from a fast classifier about what just happened. Return the operations to apply now:
- "create": a genuinely new idea → a new thread with its first card. New ids are short kebab-case slugs.
- "evolve": the group changed an idea substantially (new direction, a variant, a different screen of it) → a NEW
  card in that thread with from = the card it builds on. The old card stays as history.
- "edit": a small refinement of the latest card of a thread (copy, a field, a detail) → same card id, in place.
Prefer edit over evolve and evolve over create; never duplicate a thread that already covers the idea.

Per op: kind ("mockup" = a UI screen, "flow" = a user flow / process, "idea" = a concept that is not visual yet;
when people talk about a product, its main screen as a mockup is what makes the board useful), title, a one-sentence
summary of what changed and why, a precise brief for the designer (what to show or change; the designer sees only
the brief and the card), quote = the few words from the transcript that triggered it (verbatim, max 15 words) and
at = its [mm:ss] timestamp.

Return an empty list when nothing should change. At most 2 ops at a time; the board should grow calmly.
LANGUAGE: titles, summaries and briefs in the language of the transcript (a Polish conversation → Polish).`;

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

const EDITOR_PROMPT = `You maintain one card of a live meeting whiteboard: the file card.html, a 960x600 HTML screen styled
with Tailwind classes. The group just refined the idea; update the card to match the change described in the brief.

- Make minimal, targeted edits with str_replace: keep everything that is still valid, change only what the brief
  asks for. Do all edits in a single turn as parallel tool calls. The file content is given below — do not view it.
- old_str must match the file exactly and be unique; include enough surrounding text.
- Keep the card's design language and the same constraints: Tailwind classes only, no <script>, no external URLs,
  no emoji icons, no image placeholders, copy in the language of the brief.
- If the change is so large that editing makes no sense, use create with the full new file instead.`;

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

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ops"],
  properties: {
    ops: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op", "id", "thread", "threadTitle", "from", "kind", "title", "summary", "brief", "quote", "at"],
        properties: {
          op: { type: "string", enum: ["create", "evolve", "edit"] },
          id: { type: "string" },
          thread: { type: "string" },
          threadTitle: { type: "string" },
          from: { type: "string" },
          kind: { type: "string", enum: ["mockup", "flow", "idea"] },
          title: { type: "string" },
          summary: { type: "string" },
          brief: { type: "string" },
          quote: { type: "string" },
          at: { type: "string" },
        },
      },
    },
  },
};

/** Keeps the prompt bounded on long meetings: the newest part of the transcript matters most. */
const MAX_TRANSCRIPT_CHARS = 24_000;
const recentPart = (transcript: string) =>
  transcript.length > MAX_TRANSCRIPT_CHARS ? "…\n" + transcript.slice(-MAX_TRANSCRIPT_CHARS) : transcript;

function describeBoard(board: CardMeta[]) {
  const threads = new Map<string, CardMeta[]>();
  for (const card of board) threads.set(card.thread, [...(threads.get(card.thread) ?? []), card]);
  return [...threads.values()]
    .map(
      (cards) =>
        `Thread "${cards[0].thread}" — ${cards[0].threadTitle}\n` +
        cards.map((c) => `  card ${c.id} [${c.kind}] ${c.title}: ${c.summary}`).join("\n"),
    )
    .join("\n") || "(empty)";
}

/**
 * Step 1 (~0.4 s, ~$0.00002): Jev decides whether the newest part of the conversation is worth drawing at all.
 * Uses OpenRouter's decisions endpoint, which answers multiple-choice questions with probabilities.
 */
export async function gateBoard(apiKey: string, recent: string, board: CardMeta[]): Promise<Gate> {
  const threads = [...new Map(board.map((c) => [c.thread, c.threadTitle])).entries()];
  const questions: Record<string, unknown> = {
    action: {
      type: "choice",
      instructions:
        "A live whiteboard draws product ideas from a brainstorming meeting. Lines marked >> are new since the last " +
        "update. What should the whiteboard do about the new lines?",
      criteria: {
        create: "They describe a new concrete product idea, feature, screen or flow that is not on the board yet",
        evolve: "They substantially change an idea that is already on the board (new direction, variant, other screen)",
        edit: "They add a small detail or refinement to an idea already on the board",
        wait: "Small talk, logistics, agreement, or an idea that is still too vague to draw",
      },
    },
  };
  if (threads.length) {
    questions.thread = {
      type: "choice",
      instructions: "Which idea on the board are the new lines about?",
      criteria: Object.fromEntries([...threads.map(([id, title]) => [id, title]), ["none", "None of them"]]),
    };
  }
  const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: JEV_MODEL, state: `Board:\n${describeBoard(board)}\n\nConversation:\n${recent}`, questions }),
  });
  if (!res.ok) throw new Error(`Jev: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const { answers } = (await res.json()) as {
    answers: Record<string, { choice: string; confidence: number }>;
  };
  const thread = answers.thread?.choice;
  return {
    action: answers.action.choice as GateAction,
    confidence: answers.action.confidence,
    thread: thread && thread !== "none" ? thread : null,
  };
}

/** Step 2 (~2 s): decide the concrete operations on threads and cards. */
export async function planBoard(apiKey: string, transcript: string, board: CardMeta[], hint: string): Promise<PlanOp[]> {
  const res = await request(
    apiKey,
    {
      max_completion_tokens: 6_000,
      messages: [
        { role: "system", content: PLANNER_PROMPT },
        {
          role: "user",
          content: `${productText() ? productText() + "\n\n" : ""}Board:\n${describeBoard(board)}\n\nClassifier hint: ${hint}\n\nTranscript:\n${recentPart(transcript)}`,
        },
      ],
      response_format: { type: "json_schema", json_schema: { name: "board_plan", strict: true, schema: PLAN_SCHEMA } },
    },
    GROQ_MODEL,
  );
  if (!res.ok) throw await failure(res);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return (JSON.parse(data.choices[0].message.content) as { ops: PlanOp[] }).ops;
}

const stripFences = (html: string) => html.replace(/^\s*```(?:html)?\s*/i, "").replace(/```\s*$/, "");

const FIRST_CARD =
  "This is the FIRST card of a new idea: make it ultra-visual and conceptual — one big visual metaphor or the single " +
  "key screen, minimal text (a headline of at most 6 words plus only essential UI labels), graspable in 2 seconds. " +
  "Details come in later versions.";

const designerInput = (op: PlanOp, transcript: string) =>
  `Kind: ${op.kind}\nTitle: ${op.title}\nBrief: ${op.brief}\n${op.op === "create" ? FIRST_CARD + "\n" : ""}\nRecent conversation for context:\n${transcript.slice(-4_000)}`;

/** Re-renders the partial card a few times per second. */
function throttledPartial(onPartial: (html: string) => void) {
  let lastEmit = 0;
  return async (source: string, force = false) => {
    if (!force && (Date.now() - lastEmit < 250 || source.length < 200)) return;
    lastEmit = Date.now();
    onPartial(await inlineTailwind(stripFences(source)));
  };
}

export interface DesignKeys {
  groq: string;
  anthropic: string;
}

export interface Drawn {
  source: string;
  html: string;
}

/**
 * Step 3: draw one card, streaming partial renders through `onPartial`. With `base` (the card being edited or the
 * version it evolves from) Claude edits that HTML with str_replace instead of rewriting it.
 */
export async function designCard(
  keys: DesignKeys,
  op: PlanOp,
  base: string,
  transcript: string,
  onPartial: (html: string) => void,
  signal: AbortSignal,
): Promise<Drawn> {
  const partial = throttledPartial(onPartial);
  let source: string;
  if (keys.anthropic && base) source = await editWithClaude(keys.anthropic, op, base, transcript, partial, signal);
  else if (keys.anthropic) source = await drawWithClaude(keys.anthropic, op, transcript, partial, signal);
  else source = await designWithGroq(keys.groq, op, base, transcript, partial, signal);
  source = stripFences(source).trim();
  return { source, html: await inlineTailwind(source) };
}

const claudeDefaults = {
  model: CLAUDE_DESIGNER_MODEL,
  speed: "fast" as const,
  betas: ["fast-mode-2026-02-01", "server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
  output_config: { effort: "low" as const },
};

async function drawWithClaude(
  apiKey: string,
  op: PlanOp,
  transcript: string,
  partial: (source: string) => Promise<void>,
  signal: AbortSignal,
) {
  const client = new Anthropic({ apiKey });
  let html = "";
  const stream = client.beta.messages.stream(
    {
      ...claudeDefaults,
      max_tokens: 16_000,
      system: [{ type: "text", text: DESIGNER_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [...productBlocks(), { type: "text", text: designerInput(op, transcript) }] }],
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

type EditorInput = { command: string; old_str?: string; new_str?: string; insert_line?: number; insert_text?: string; file_text?: string };

/** Applies one text-editor command to the in-memory card; returns the new file or an error for the model. */
function applyEdit(file: string, input: EditorInput): { file: string; result: string; ok: boolean } {
  switch (input.command) {
    case "str_replace": {
      const old = input.old_str ?? "";
      const count = old ? file.split(old).length - 1 : 0;
      if (count !== 1) {
        return { file, ok: false, result: count ? `Error: old_str matches ${count} times; make it unique.` : "Error: old_str not found." };
      }
      return { file: file.replace(old, () => input.new_str ?? ""), ok: true, result: "OK" };
    }
    case "insert": {
      const lines = file.split("\n");
      lines.splice(input.insert_line ?? 0, 0, input.insert_text ?? "");
      return { file: lines.join("\n"), ok: true, result: "OK" };
    }
    case "create":
      return { file: input.file_text ?? file, ok: true, result: "OK" };
    case "view":
      return { file, ok: true, result: file };
    default:
      return { file, ok: false, result: `Error: unsupported command ${input.command}` };
  }
}

/** Edits the card like a coding agent edits a file: a few str_replace calls instead of a full rewrite. */
async function editWithClaude(
  apiKey: string,
  op: PlanOp,
  base: string,
  transcript: string,
  partial: (source: string, force?: boolean) => Promise<void>,
  signal: AbortSignal,
) {
  const client = new Anthropic({ apiKey });
  let file = base;
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: [
        ...productBlocks(),
        {
          type: "text",
          text: `<file path="card.html">\n${base}\n</file>\n\nChange (${op.op === "evolve" ? "new version of the idea" : "small refinement"}): ${op.title}\nBrief: ${op.brief}\n\nRecent conversation for context:\n${transcript.slice(-3_000)}`,
        },
      ],
    },
  ];
  // Usually one turn; a second only if an edit failed and the model needs to retry it.
  for (let turn = 0; turn < 3; turn++) {
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    const stream = client.beta.messages.stream(
      {
        ...claudeDefaults,
        max_tokens: 16_000,
        system: [{ type: "text", text: EDITOR_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: [{ type: "text_editor_20250728", name: "str_replace_based_edit_tool" }],
        messages,
      },
      { signal },
    );
    // Apply each edit as soon as its tool call is complete, so the card changes live.
    stream.on("contentBlock", (block) => {
      if (block.type !== "tool_use") return;
      const applied = applyEdit(file, block.input as EditorInput);
      file = applied.file;
      results.push({ type: "tool_result", tool_use_id: block.id, content: applied.result, is_error: !applied.ok });
      void partial(file, true);
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new Error("Claude odmówił edycji tej karty.");
    if (message.stop_reason !== "tool_use" || results.every((r) => !r.is_error)) break;
    messages.push({ role: "assistant", content: message.content }, { role: "user", content: results });
  }
  return file;
}

async function designWithGroq(
  apiKey: string,
  op: PlanOp,
  base: string,
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
        {
          role: "user",
          content:
            (productText() ? productText() + "\n\n" : "") +
            (base
              ? `Current card (rewrite it with this change, keep what still fits):\n${base}\n\n${designerInput(op, transcript)}`
              : designerInput(op, transcript)),
        },
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
