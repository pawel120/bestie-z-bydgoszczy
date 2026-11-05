// Figma-style cursors for the board's agents. The server says which card an agent works on; the
// wandering is local and only there to show someone is at work, so tabs needn't agree on it.

const COLORS = ["#0d99ff", "#f24e1e", "#14ae5c", "#9747ff", "#e5a100"];
const NUDGE_MS = 1200;
const FADE_MS = 900;

const colorOf = (name) => COLORS[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % COLORS.length];

export class AgentCursors {
  constructor(world, rectOf) {
    this.world = world;
    this.rectOf = rectOf; // card id, or null while planning -> { x, y, w, h }
    this.cursors = new Map();
  }

  show({ id, name, target, note }) {
    const cursor = this.cursors.get(id) ?? this.create(id, name);
    cursor.target = target;
    cursor.bubble.textContent = note;
    cursor.el.classList.add("active");
    this.nudge(cursor);
  }

  hide(id) {
    const cursor = this.cursors.get(id);
    if (!cursor) return;
    clearInterval(cursor.timer);
    this.cursors.delete(id);
    cursor.el.classList.remove("active");
    setTimeout(() => cursor.el.remove(), FADE_MS);
  }

  clear() {
    for (const id of [...this.cursors.keys()]) this.hide(id);
  }

  create(id, name) {
    const el = document.createElement("div");
    el.className = "agent-cursor";
    el.style.setProperty("--c", colorOf(name));
    el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 2l7 19 2.6-7.4L20 11z"/></svg><span class="tag"></span><span class="bubble"></span>`;
    el.querySelector(".tag").textContent = name;
    this.world.append(el);
    const cursor = { el, bubble: el.querySelector(".bubble"), target: null };
    cursor.timer = setInterval(() => this.nudge(cursor), NUDGE_MS);
    this.cursors.set(id, cursor);
    return cursor;
  }

  nudge(cursor) {
    // Asked every time, because the card may have been dragged since the last move.
    const rect = this.rectOf(cursor.target);
    if (!rect) return;
    const px = rect.x + rect.w * (0.12 + Math.random() * 0.76);
    const py = rect.y + rect.h * (0.12 + Math.random() * 0.76);
    cursor.el.style.transform = `translate(${px}px, ${py}px) scale(calc(1 / var(--z, 1)))`;
  }
}
