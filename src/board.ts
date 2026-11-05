// Whiteboard brain: turns the running meeting transcript into mockups / flows / idea notes via Groq.

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
- When people refine an idea, update its existing item instead of creating a new one. Keep ids stable; new ids are
  short kebab-case slugs.
- Only return items that are new or materially changed. Return empty arrays if nothing on the board should change.
- LANGUAGE: title, summary and brief in the language people speak in the transcript (a Polish conversation →
  Polish), even though these instructions are in English.
- summary is one sentence on what changed and why.`;

const DESIGNER_PROMPT = `You are a senior product designer drawing one card of a live meeting whiteboard.
Output ONLY a complete HTML document (start with <!doctype html>), nothing else — no markdown fences, no comments
about it.

Hard constraints: self-contained HTML + inline <style>; no <script>; no external images, fonts or URLs (use emoji,
CSS shapes, gradients, system-ui font). Lay it out for exactly 960x600 px (body margin 0, nothing overflowing).

Quality bar:
- mockup: a realistic app screen — real layout (nav/sidebar, header, content, cards, buttons, inputs, states),
  coherent palette, clear typography hierarchy, generous spacing, believable copy and data. Never lorem ipsum,
  never one centred box.
- flow: a clean diagram of boxes, arrows (CSS borders / unicode ➜) and short labels, left-to-right or top-down,
  with numbered steps and a highlighted key step.
- idea: an elegant one-pager card — bold one-line pitch, then value / risks / open questions in columns.
All copy in the language of the brief.`;

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
  return html.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
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
