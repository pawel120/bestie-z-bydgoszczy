// Where a new element goes. The board reads as rows: a text, then what grew out of it to its right.
// Nothing already on the board moves: an element takes the next free spot in its row.

const GAP = 56;
const ROW_GAP = 120;

const wrapped = (text, perLine) => Math.max(1, Math.ceil(String(text ?? "").length / perLine));

/** Approximate size on the board; the browser measures the exact one for drawing. */
export function sizeOf(card) {
  if (card.html) return { w: 960, h: 680 };
  if (card.src) return { w: 360, h: 300 };
  const bodyLines = String(card.body ?? "").split("\n").filter(Boolean).reduce((sum, line) => sum + wrapped(line, 52), 0);
  return { w: 640, h: Math.max(card.minH ?? 0, 56 * wrapped(card.title, 26) + 36 * bodyLines + 40) };
}

function isFree(cards, x, y, size) {
  return !cards.some((c) => {
    const other = sizeOf(c);
    return x < c.x + other.w + GAP && c.x < x + size.w + GAP && y < c.y + other.h + GAP && c.y < y + size.h + GAP;
  });
}

/** `parents` holds the elements this one grows from: none for a new idea, two when ideas are paired. */
export function place(cards, parents, size) {
  if (!parents.length) {
    return { x: 0, y: cards.length ? Math.max(...cards.map((c) => c.y + sizeOf(c).h)) + ROW_GAP : 0 };
  }
  const start = Math.max(...parents.map((p) => p.x + sizeOf(p).w)) + GAP;
  const y = parents.reduce((sum, p) => sum + p.y, 0) / parents.length;
  for (let x = start; ; x += size.w + GAP) if (isFree(cards, x, y, size)) return { x, y };
}
