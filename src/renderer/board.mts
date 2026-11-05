// Live whiteboard: plans card changes from the running transcript (including what is being said right now),
// shows them at once as skeletons and streams each card's HTML in as the model writes it.

import type { BestieApi } from "../preload.js";

export interface BoardItem {
  id: string;
  kind: "mockup" | "flow" | "idea";
  title: string;
  summary: string;
  html: string;
}

const KIND_LABEL: Record<BoardItem["kind"], string> = { mockup: "Mockup", flow: "Flow", idea: "Pomysł" };
/** Plan this long after the conversation last changed… */
const DEBOUNCE_MS = 1_200;
/** …but at least this often while people keep talking. */
const MAX_WAIT_MS = 4_000;

interface Card {
  item: BoardItem;
  el: HTMLElement;
  frame: HTMLElement;
  title: HTMLElement;
  summary: HTMLElement;
  drawing: boolean;
}

export class Whiteboard {
  private cards = new Map<string, Card>();
  private lines: string[] = [];
  private partials = new Map<string, string>();
  private version = 0; // bumps on every transcript change
  private plannedVersion = 0;
  private planning = false;
  private debounce: number | undefined;
  private deadline: number | undefined;
  enabled = true;

  constructor(
    private api: BestieApi,
    private grid: HTMLElement,
    private statusEl: HTMLElement,
    private onError: (message: string) => void,
  ) {
    api.onBoardPartial((id, html) => {
      const card = this.cards.get(id);
      if (card?.drawing) this.setFrame(card, html);
    });
    new ResizeObserver(() => this.fitFrames()).observe(grid);
    this.renderEmpty();
  }

  reset() {
    this.cards.clear();
    this.lines = [];
    this.partials.clear();
    this.version = this.plannedVersion = 0;
    this.clearTimers();
    this.renderEmpty();
  }

  addLine(line: string) {
    this.lines.push(line);
    this.changed();
  }

  /** What a speaker is saying right now (null once it is committed). */
  setPartial(speaker: string, text: string | null) {
    if (text && text.trim().split(/\s+/).length >= 3) this.partials.set(speaker, text);
    else this.partials.delete(speaker);
    this.changed();
  }

  /** Plans right now (the "refresh" button, end of a recording). */
  async flush() {
    this.clearTimers();
    await this.plan(true);
  }

  private changed() {
    this.version++;
    if (!this.enabled) return;
    window.clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => void this.plan(), DEBOUNCE_MS);
    this.deadline ??= window.setTimeout(() => void this.plan(), MAX_WAIT_MS);
  }

  private clearTimers() {
    window.clearTimeout(this.debounce);
    window.clearTimeout(this.deadline);
    this.debounce = this.deadline = undefined;
  }

  private transcript() {
    const live = [...this.partials].map(([speaker, text]) => `[teraz] ${speaker}: ${text}…`);
    return [...this.lines, ...live].join("\n");
  }

  private async plan(force = false) {
    if (this.planning || (!force && !this.enabled)) return;
    if (!this.lines.length && !this.partials.size) return;
    if (!force && this.version === this.plannedVersion) return;
    this.clearTimers();
    this.planning = true;
    const version = this.version;
    const transcript = this.transcript();
    this.updateStatus();
    const started = performance.now();
    try {
      const plan = await this.api.planBoard(
        transcript,
        [...this.cards.values()].map(({ item: { id, kind, title, summary } }) => ({ id, kind, title, summary })),
      );
      this.plannedVersion = version;
      for (const id of plan.removals) this.remove(id);
      for (const planned of plan.upserts) {
        const { brief, ...meta } = planned;
        const card = this.upsert(meta);
        void this.draw(card, planned, transcript);
      }
      this.lastPlan = `Plan ${((performance.now() - started) / 1000).toFixed(1)} s`;
    } catch (err) {
      this.onError(String(err));
    } finally {
      this.planning = false;
      this.updateStatus();
    }
    // The conversation moved on while we were planning.
    if (this.version !== this.plannedVersion) this.changed();
  }

  private lastPlan = "";

  private updateStatus() {
    const drawing = [...this.cards.values()].filter((c) => c.drawing).length;
    const parts = [this.planning ? "Planuję…" : this.lastPlan, drawing ? `rysuję ${drawing}` : ""].filter(Boolean);
    this.statusEl.textContent = parts.join(" · ");
  }

  private async draw(card: Card, planned: Parameters<BestieApi["designCard"]>[0], transcript: string) {
    card.drawing = true;
    card.el.classList.add("drawing");
    this.updateStatus();
    try {
      const html = await this.api.designCard(planned, transcript);
      if (html === null || this.cards.get(card.item.id) !== card) return; // superseded or removed
      card.item.html = html;
      this.setFrame(card, html);
      card.drawing = false;
      card.el.classList.remove("drawing");
      void this.api.saveBoard([...this.cards.values()].map((c) => c.item));
    } catch (err) {
      card.drawing = false;
      card.el.classList.remove("drawing");
      this.onError(String(err));
    } finally {
      this.updateStatus();
    }
  }

  // MARK: - DOM

  private renderEmpty() {
    this.grid.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Tablica zapełni się mockupami i pomysłami, gdy zaczniecie rozmawiać.";
    this.grid.append(empty);
  }

  private upsert(meta: Omit<BoardItem, "html">): Card {
    let card = this.cards.get(meta.id);
    if (!card) {
      if (!this.cards.size) this.grid.replaceChildren();
      card = this.createCard({ ...meta, html: "" });
      this.cards.set(meta.id, card);
    }
    Object.assign(card.item, meta);
    card.el.className = `card ${meta.kind}${card.drawing ? " drawing" : ""}`;
    card.title.textContent = meta.title;
    card.summary.textContent = meta.summary;
    (card.el.querySelector(".badge") as HTMLElement).textContent = KIND_LABEL[meta.kind];
    // Newest change first, with a highlight.
    this.grid.prepend(card.el);
    this.fitFrame(card.frame);
    card.el.classList.remove("fresh");
    void card.el.offsetWidth; // restart the highlight animation
    card.el.classList.add("fresh");
    return card;
  }

  private remove(id: string) {
    this.cards.get(id)?.el.remove();
    this.cards.delete(id);
    if (!this.cards.size) this.renderEmpty();
  }

  private createCard(item: BoardItem): Card {
    const el = document.createElement("article");
    const header = document.createElement("header");
    const badge = document.createElement("span");
    badge.className = "badge";
    const title = document.createElement("h3");
    const live = document.createElement("span");
    live.className = "live";
    live.textContent = "rysuję";
    header.append(badge, title, live);

    const frame = document.createElement("div");
    frame.className = "frame";
    const summary = document.createElement("p");
    summary.className = "summary";

    el.append(header, frame, summary);
    const card: Card = { item, el, frame, title, summary, drawing: false };
    el.addEventListener("click", () => card.item.html && this.open(card.item));
    this.fitFrame(frame);
    return card;
  }

  /** Swaps in new HTML without flashing: the new iframe replaces the old one only once it has loaded. */
  private setFrame(card: Card, html: string) {
    const next = document.createElement("iframe");
    next.setAttribute("sandbox", ""); // no scripts, opaque origin
    next.className = "pending";
    next.addEventListener("load", () => {
      for (const old of card.frame.querySelectorAll("iframe")) if (old !== next) old.remove();
      next.className = "";
    });
    next.srcdoc = html;
    card.frame.append(next);
  }

  private fitFrame(frame: HTMLElement) {
    frame.style.setProperty("--scale", String(frame.clientWidth / 960 || 0.38));
  }

  /** Cards are laid out at 960 px wide; scale each preview to its card. */
  private fitFrames() {
    for (const card of this.cards.values()) this.fitFrame(card.frame);
  }

  private open(item: BoardItem) {
    const dialog = document.createElement("dialog");
    dialog.className = "viewer";
    const title = document.createElement("h3");
    title.textContent = `${KIND_LABEL[item.kind]} · ${item.title}`;
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "");
    frame.srcdoc = item.html;
    dialog.append(title, frame);
    dialog.addEventListener("click", (e) => e.target === dialog && dialog.close());
    dialog.addEventListener("close", () => dialog.remove());
    document.body.append(dialog);
    dialog.showModal();
  }
}
