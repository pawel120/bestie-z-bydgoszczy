// Hands-free camera for the Recall bot. In Meet nobody can pan or zoom the board, so a director moves the camera to
// whatever the conversation is about right now:
//   - a new card or a new version → that card, big enough to read on a shared screen;
//   - an edit of an existing card → that card (the desktop app deliberately leaves the camera alone there);
//   - talking about an earlier idea (Jev names the thread, or the words of its title come up) → its latest card;
//   - explorer agents drawing variants → the card together with its variants.
// It wraps the desktop Whiteboard (../src/renderer/board.mts, unchanged) at runtime; app.mts imports this module
// instead of ./board.mjs (see vite.config.ts). Off unless the page runs in the bot (or with handsfree in #c=…).

import { Whiteboard as DesktopWhiteboard } from "../../src/renderer/board.mts";
import { readConfig } from "./config";

/** Camera moves closer together than this are skipped, unless a new card appears. */
const MIN_DWELL_MS = 3_500;

// Loose view of the desktop board's internals the director needs (they are private in TypeScript only).
interface Card {
  item: { id: string; thread: string; threadTitle: string; title: string };
  col: number;
  el: HTMLElement;
  variants: { el: HTMLElement }[];
}
interface Board {
  cards: Map<string, Card>;
  lanes: Map<string, { title: HTMLElement }>;
  follow: boolean;
  cam: { x: number; y: number; z: number };
  viewport: HTMLElement;
  api: { gateBoard: (...args: never[]) => Promise<{ thread: string | null } | null> };
  apply(op: { id: string; op: string }, transcript: string): void;
  focusOn(card: Card): void;
  exploreVariants(card: Card, ...rest: unknown[]): Promise<void>;
  addLine(line: string): void;
  fitRect(x0: number, y0: number, x1: number, y1: number, animate: boolean): void;
}

/** Lowercase, no diacritics, words of 4+ letters cut to 5 (a crude stem: "drzewa" / "drzewo" → "drzew"). */
function stems(text: string) {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ł/g, "l")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4)
      .map((w) => w.slice(0, 5)),
  );
}

function direct(board: Board) {
  let lastMove = 0;
  let current: string | null = null;

  const latestIn = (thread: string) =>
    [...board.cards.values()].filter((c) => c.item.thread === thread).sort((a, b) => b.col - a.col)[0];

  /** World-space bounding box of elements (frames carry their label, quote and caption). */
  function worldRect(els: HTMLElement[]) {
    const vp = board.viewport.getBoundingClientRect();
    const { x, y, z } = board.cam;
    const rects = els.map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0);
    if (!rects.length) return null;
    const toWorld = (sx: number, sy: number) => ({ x: (sx - vp.left - x) / z, y: (sy - vp.top - y) / z });
    const a = toWorld(Math.min(...rects.map((r) => r.left)), Math.min(...rects.map((r) => r.top)));
    const b = toWorld(Math.max(...rects.map((r) => r.right)), Math.max(...rects.map((r) => r.bottom)));
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }

  function show(card: Card | undefined, options: { variants?: boolean; urgent?: boolean } = {}) {
    if (!card || !board.follow) return; // "Śledź" turned off by hand: leave the camera alone
    const now = Date.now();
    if (!options.urgent && now - lastMove < MIN_DWELL_MS && current === card.item.id) return;
    const rect = worldRect([card.el, ...(options.variants ? card.variants.map((v) => v.el) : [])]);
    if (!rect) return;
    lastMove = now;
    current = card.item.id;
    board.fitRect(rect.x0 - 24, rect.y0 - 24, rect.x1 + 24, rect.y1 + 24, true);
  }

  // New cards and versions: the desktop "follow" fits the three newest cards; here the new one fills the screen.
  board.focusOn = (card) => show(card, { urgent: true });

  // Edits happen in place without a camera move on the desktop; in the bot, go to the card being changed.
  const apply = board.apply.bind(board);
  board.apply = (op, transcript) => {
    apply(op, transcript);
    if (op.op === "edit") show(board.cards.get(op.id));
  };

  // Explorer agents: show the card with the variants appearing under it.
  const explore = board.exploreVariants.bind(board);
  board.exploreVariants = (card, ...rest) => {
    const done = explore(card, ...rest);
    requestAnimationFrame(() => show(card, { variants: true, urgent: true }));
    return done;
  };

  // Jev already says which idea the new lines are about.
  const gate = board.api.gateBoard.bind(board.api);
  board.api = {
    ...board.api,
    gateBoard: async (...args: never[]) => {
      const result = await gate(...args);
      if (result?.thread && board.lanes.has(result.thread)) show(latestIn(result.thread));
      return result;
    },
  };

  // Faster than the gate: someone names an earlier idea ("wróćmy do drzewa iglastego").
  const addLine = board.addLine.bind(board);
  board.addLine = (line) => {
    addLine(line);
    const words = stems(line.replace(/^\[[^\]]*\]\s*[^:]{1,40}:\s*/, ""));
    if (!words.size) return;
    let best: { thread: string; score: number } | null = null;
    let tie = false;
    for (const [thread, lane] of board.lanes) {
      const latest = latestIn(thread);
      const title = stems(`${lane.title.textContent ?? ""} ${latest?.item.title ?? ""}`);
      const score = [...title].filter((w) => words.has(w)).length;
      if (!score) continue;
      if (!best || score > best.score) [best, tie] = [{ thread, score }, false];
      else if (score === best.score) tie = true;
    }
    if (best && !tie) show(latestIn(best.thread));
  };
}

const config = readConfig();
const handsFree = !!(config.bot || config.handsfree);

export class Whiteboard extends DesktopWhiteboard {
  constructor(...args: ConstructorParameters<typeof DesktopWhiteboard>) {
    super(...args);
    if (handsFree) direct(this as unknown as Board);
  }
}
