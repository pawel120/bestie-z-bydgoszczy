// Explorer agents: after a new card is drawn, each tries one planner-chosen direction as a card of its
// own, and a new idea gets paired once with the latest idea from another thread. Both are edits of
// finished cards and run under the room's budget like everything else. The point is exploring the
// idea, so nothing here ranks the variants against each other.

const MAX_DIRECTIONS = 2;
const SPARE_CARDS = 6; // kept free so the conversation's own cards always fit

const variantBrief = (direction) =>
  `Explore a VARIANT of this card in the direction "${direction}". Keep the product and its visual language, ` +
  "but rethink the content and structure to follow this direction boldly. Make only the edits this needs.";

const pairBrief = (other) =>
  `Pair this card with another idea from the same conversation: "${other.title}" (${other.summary}). ` +
  "Show what one product doing both would look like, not two ideas side by side.";

export function createExplorers({ design, cards, sources, saveCard, agent, canSpend, maxCards }) {
  const pairedThreads = new Set();
  const hasRoom = () => canSpend() && cards.size < maxCards - SPARE_CARDS;

  async function run(name, note, parent, meta, op, transcript) {
    const agentId = `${meta.id}:${name}`;
    saveCard({ ...meta, status: "Rysuję…", html: parent.html });
    agent.show(agentId, name, meta.id, note);
    let lastSent = 0;
    const partial = (html) => {
      if (Date.now() - lastSent < 1000) return;
      lastSent = Date.now();
      saveCard({ ...meta, status: "Rysuję…", html });
    };
    try {
      const drawn = await design({ ...op, ...meta, op: "evolve", explore: [] }, sources.get(parent.id), transcript, partial);
      sources.set(meta.id, drawn.source);
      saveCard({ ...meta, status: "", html: drawn.html });
    } catch (err) {
      console.error(err);
      saveCard({ ...meta, status: "Rysowanie nie powiodło się" });
    } finally {
      agent.hide(agentId);
    }
  }

  function variants(op, parent, transcript) {
    const directions = (op.explore ?? []).filter(Boolean).slice(0, MAX_DIRECTIONS);
    return directions.map((direction, i) => {
      if (!hasRoom()) return null;
      const name = `Agent ${i + 1}`;
      const meta = {
        id: `${op.id}~v${i + 1}`,
        thread: op.thread,
        threadTitle: `${op.threadTitle} · ${name}`,
        kind: op.kind,
        title: direction,
        summary: `Wariant: ${direction}`,
        quote: op.quote,
        at: op.at,
        from: parent.id,
      };
      return run(name, direction, parent, meta, { ...op, brief: variantBrief(direction) }, transcript);
    });
  }

  function pair(op, parent, transcript) {
    const other = [...cards.values()].reverse().find((c) => c.thread !== op.thread && sources.has(c.id) && !c.id.includes("~"));
    const key = other && [op.thread, other.thread].sort().join("|");
    if (!other || pairedThreads.has(key) || !hasRoom()) return null;
    pairedThreads.add(key);
    const meta = {
      id: `${op.id}~x`,
      thread: op.thread,
      threadTitle: `${op.threadTitle} + ${other.threadTitle}`.slice(0, 120),
      kind: op.kind,
      title: `${parent.title} + ${other.title}`.slice(0, 160),
      summary: `Połączenie pomysłów: ${parent.title} i ${other.title}`,
      quote: op.quote,
      at: op.at,
      from: parent.id,
      with: other.id,
    };
    return run("Agent 3", "łączy pomysły", parent, meta, { ...op, brief: pairBrief(other) }, transcript);
  }

  return {
    /** Call once a card is finished. Edits are not new directions, so they don't start explorers. */
    async explore(op, transcript) {
      const parent = cards.get(op.id);
      if (!parent || op.op === "edit" || !sources.has(op.id)) return;
      await Promise.all([...variants(op, parent, transcript), op.op === "create" ? pair(op, parent, transcript) : null]);
    },
    reset() {
      pairedThreads.clear();
    },
  };
}
