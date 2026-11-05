// Live whiteboard as a timeline on a Figma-like canvas. Every idea is a thread (a lane, top to bottom in the order
// ideas came up); every card in it is a version, and columns follow the order cards were created, so the board reads
// left to right as the history of the conversation. Arrows show what each version grew out of, and every card
// carries the quote it came from. Nothing ever moves on its own: cards are only added at the end or edited in place.

import type { BestieApi } from "../preload.js";

type Kind = "mockup" | "flow" | "idea";

interface BoardItem {
  id: string;
  thread: string;
  threadTitle: string;
  kind: Kind;
  title: string;
  summary: string;
  from: string;
  quote: string;
  at: string;
  source: string;
  html: string;
}

type PlanOp = Parameters<BestieApi["designCard"]>[0];

const KIND_LABEL: Record<Kind, string> = { mockup: "Mockup", flow: "Flow", idea: "Pomysł" };
const KIND_ICON: Record<Kind, string> = {
  mockup: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  flow: '<rect x="2" y="9" width="6" height="6" rx="1"/><rect x="16" y="9" width="6" height="6" rx="1"/><path d="M8 12h8"/>',
  idea: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
};
const GATE_LABEL: Record<string, string> = {
  create: "nowy pomysł",
  evolve: "nowa wersja",
  edit: "poprawka",
  ask: "prośba o pomysły",
  wait: "czekam",
};
/** Talking to the board directly always goes straight to the planner. */
const DIRECT_REQUEST = /\b(ai|aj|ej ai|tablic\w*|bestie)\b.*\b(pokaż|pokaz|zaprojektuj|narysuj|zrób|zrob|wymyśl|wymysl|zaproponuj|show|design|draw)|\b(pokaż|zaprojektuj|narysuj|wymyśl|zaproponuj)\w*\s+(mi|nam)?\s*(pomys|mockup|ekran|wersj|landing)/i;
/** Ask the gate this long after the conversation last changed… */
const DEBOUNCE_MS = 1_200;
/** …but at least this often while people keep talking. */
const MAX_WAIT_MS = 4_000;
/** Lines of conversation the gate looks at. */
const GATE_LINES = 10;

const FRAME_W = 960;
const FRAME_H = 600;
const GAP_X = 200;
const LANE_H = FRAME_H + 420;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2;

interface Card {
  item: BoardItem;
  col: number;
  x: number;
  y: number;
  el: HTMLElement;
  label: HTMLElement;
  title: HTMLElement;
  host: HTMLElement;
  shadow: ShadowRoot;
  quote: HTMLElement;
  caption: HTMLElement;
  drawing: boolean;
  createdAt: number;
  /** Drawings of this card run one after another. */
  queue: Promise<void>;
}

interface Lane {
  index: number;
  el: HTMLElement;
  title: HTMLElement;
}

const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

/** Strips anything executable from model-written HTML (the app CSP blocks inline handlers too). */
function sanitize(doc: Document) {
  doc.querySelectorAll("script, iframe, object, embed, link, meta, base, form").forEach((el) => el.remove());
  for (const el of doc.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || attr.name === "autofocus" || /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

/**
 * Tailwind v4 relies on @property registrations, which are ignored inside shadow roots; registering them once in
 * the document makes them apply to every card.
 */
const registeredProperties = new Set<string>();
function registerProperties(css: string) {
  const fresh: string[] = [];
  for (const match of css.matchAll(/@property\s+(--[\w-]+)\s*\{[^}]*\}/g)) {
    if (registeredProperties.has(match[1])) continue;
    registeredProperties.add(match[1]);
    fresh.push(match[0]);
  }
  if (fresh.length) {
    const style = document.createElement("style");
    style.textContent = fresh.join("\n");
    document.head.append(style);
  }
}

export class Whiteboard {
  private cards = new Map<string, Card>();
  private lanes = new Map<string, Lane>();
  private lines: string[] = [];
  private version = 0; // bumps on every transcript change
  private plannedLines = 0;
  private busy = false;
  private debounce: number | undefined;
  private deadline: number | undefined;
  private lastStep = "";
  private columns = 0;
  enabled = true;

  // Canvas camera: screen = world * z + (x, y)
  private cam = { x: 40, y: 40, z: 0.4 };
  private follow = true;
  private world: HTMLElement;
  private links: SVGSVGElement;
  private ruler: HTMLElement;
  private emptyEl: HTMLElement;
  private zoomLabel: HTMLElement;
  private followButton: HTMLButtonElement;
  private selected: Card | null = null;
  /**
   * Base product frame, left of the timeline: the starting point every idea grows out of. Its editable replica
   * (built once by Claude) is the base for every change to the product itself.
   */
  private product: {
    el: HTMLElement; x: number; y: number; title: string; img: HTMLImageElement; shadow: ShadowRoot;
    source: string; html: string; showReplica: boolean;
  } | null = null;

  constructor(
    private api: BestieApi,
    private viewport: HTMLElement,
    private statusEl: HTMLElement,
    private onError: (message: string) => void,
  ) {
    api.onBoardPartial((id, html) => {
      const card = this.cards.get(id);
      if (card?.drawing) this.setContent(card, html);
    });

    viewport.classList.add("canvas");
    this.world = document.createElement("div");
    this.world.className = "world";
    this.links = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.links.classList.add("links");
    this.ruler = document.createElement("div");
    this.ruler.className = "ruler";
    this.world.append(this.links, this.ruler);
    this.emptyEl = document.createElement("p");
    this.emptyEl.className = "empty";
    this.emptyEl.textContent = "Tablica zapełni się pomysłami, gdy zaczniecie rozmawiać. Każdy pomysł dostanie swój wiersz, a kolejne wersje pojawią się obok.";
    const controls = document.createElement("div");
    controls.className = "zoom-controls";
    controls.innerHTML = `
      <button data-act="follow" title="Pokazuj najnowsze karty">${svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>')}<span>Śledź</span></button>
      <span class="sep"></span>
      <button data-act="out" title="Oddal (⌘−)">${svg('<path d="M5 12h14"/>')}</button>
      <span class="zoom-value">40%</span>
      <button data-act="in" title="Przybliż (⌘+)">${svg('<path d="M12 5v14M5 12h14"/>')}</button>
      <button data-act="fit" title="Cała oś czasu (⇧1)">${svg('<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>')}<span>Całość</span></button>`;
    this.zoomLabel = controls.querySelector(".zoom-value")!;
    this.followButton = controls.querySelector('[data-act="follow"]')!;
    controls.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest("button")?.dataset.act;
      const rect = this.viewport.getBoundingClientRect();
      if (act === "in") this.zoomAt(rect.width / 2, rect.height / 2, 1.25, true);
      if (act === "out") this.zoomAt(rect.width / 2, rect.height / 2, 0.8, true);
      if (act === "fit") {
        this.setFollow(false);
        this.fitAll(true);
      }
      if (act === "follow") this.setFollow(!this.follow);
    });
    viewport.append(this.world, this.emptyEl, controls);

    // Focus inside a mockup would scroll the overflow:hidden viewport and desync it from the camera.
    viewport.addEventListener("scroll", () => (viewport.scrollTop = viewport.scrollLeft = 0));
    this.bindCanvasInput();
    this.applyCamera();
    this.setFollow(true);
  }

  /** Shows the base product as the starting point of the timeline (null removes it) and builds its replica. */
  setProduct(product: { url: string; title: string; screenshot: string } | null) {
    this.product?.el.remove();
    this.product = null;
    if (product) {
      const el = document.createElement("section");
      el.className = "frame product drawing";
      const label = document.createElement("header");
      label.className = "frame-label";
      label.innerHTML = `<span class="kind">${svg('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>')}Produkt bazowy</span><span class="title"></span><span class="note"></span><span class="live">odtwarzam do edycji</span>`;
      label.querySelector(".title")!.textContent = `${product.title} · ${product.url.replace(/^https?:\/\//, "")}`;
      const img = document.createElement("img");
      img.className = "artboard";
      img.src = product.screenshot;
      img.alt = product.title;
      const host = document.createElement("div");
      host.className = "artboard replica";
      host.hidden = true;
      const shadow = host.attachShadow({ mode: "open" });
      const caption = document.createElement("p");
      caption.className = "frame-caption";
      caption.textContent = "Odtwarzam stronę jako edytowalną replikę…";
      el.append(label, img, host, caption);
      this.world.append(el);
      this.product = { el, x: -(FRAME_W + GAP_X + 120), y: 0, title: product.title, img, shadow, source: "", html: "", showReplica: false };
      el.style.transform = `translate(${this.product.x}px, 0px)`;
      this.emptyEl.hidden = true;

      // Click toggles between the real page and the replica, to check how faithful it is.
      const current = this.product;
      const toggle = () => {
        if (!current.html) return;
        current.showReplica = !current.showReplica;
        img.hidden = current.showReplica;
        host.hidden = !current.showReplica;
        (label.querySelector(".note") as HTMLElement).textContent = current.showReplica ? "replika" : "oryginał";
      };
      img.addEventListener("click", toggle);
      host.addEventListener("click", toggle);
      this.api.onProductPartial((html) => this.product === current && this.render(shadow, html));
      this.api
        .replicateProduct()
        .then((drawn) => {
          if (this.product !== current) return;
          el.classList.remove("drawing");
          if (!drawn) {
            caption.textContent = "Bez klucza Claude zmiany produktu są rysowane od zera.";
            return;
          }
          current.source = drawn.source;
          current.html = drawn.html;
          this.render(shadow, drawn.html);
          caption.textContent = "Replika gotowa: zmiany produktu edytują tę stronę. Kliknij, aby porównać z oryginałem.";
        })
        .catch((err) => {
          el.classList.remove("drawing");
          caption.textContent = "Nie udało się odtworzyć strony.";
          this.onError(String(err));
        });
    }
    this.drawLinks();
    this.fitAll(true);
  }

  reset() {
    for (const card of this.cards.values()) card.el.remove();
    for (const lane of this.lanes.values()) lane.el.remove();
    this.cards.clear();
    this.lanes.clear();
    this.columns = 0;
    this.lines = [];
    this.version = this.plannedLines = 0;
    this.clearTimers();
    this.ruler.replaceChildren();
    this.links.replaceChildren();
    this.emptyEl.hidden = !!this.product;
    this.drawLinks();
    this.setFollow(true);
  }

  addLine(line: string) {
    this.lines.push(line);
    this.changed();
  }

  /**
   * Partials are only shown in the transcript: planning on them made the same sentence count twice (once while it
   * was being said, once when it was committed). The board works on committed lines, each handled exactly once.
   */
  setPartial(_speaker: string, _text: string | null) {}

  /** Plans right now, skipping the gate (the "refresh" button, end of a recording). */
  async flush() {
    this.clearTimers();
    await this.step(true);
  }

  // MARK: - Gate → plan → guard → draw

  private changed() {
    this.version++;
    if (!this.enabled) return;
    window.clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => void this.step(), DEBOUNCE_MS);
    this.deadline ??= window.setTimeout(() => void this.step(), MAX_WAIT_MS);
  }

  private clearTimers() {
    window.clearTimeout(this.debounce);
    window.clearTimeout(this.deadline);
    this.debounce = this.deadline = undefined;
  }

  /** Lines, with the ones not handled yet marked ">>" (the only ones the gate and the planner may react to). */
  private marked(from = 0) {
    return this.lines
      .slice(from)
      .map((line, i) => (from + i >= this.plannedLines ? `>> ${line}` : `   ${line}`))
      .join("\n");
  }

  private metas() {
    const cards = [...this.cards.values()].map(({ item: { source, html, ...meta } }) => meta);
    if (!this.product) return cards;
    const product = {
      id: "produkt", thread: "produkt", threadTitle: this.product.title, kind: "mockup" as Kind,
      title: "Strona produktu (oryginał)",
      summary: this.product.source ? "Edytowalna replika prawdziwej strony produktu" : "Zrzut strony produktu (replika w przygotowaniu)",
      from: "", quote: "", at: "",
    };
    return [product, ...cards];
  }

  private async step(force = false) {
    if (this.busy || (!force && !this.enabled)) return;
    const upTo = this.lines.length;
    const fresh = this.lines.slice(this.plannedLines);
    if (!fresh.length && !(force && upTo)) return;
    this.clearTimers();
    this.busy = true;
    try {
      let hint = "brak klasyfikatora";
      const ask = DIRECT_REQUEST.test(fresh.join(" "));
      if (!force && ask) {
        hint = "ask: someone asked the board directly to propose or design something";
        this.lastStep = "Prośba do tablicy";
      } else if (!force) {
        this.setStatus("Słucham…");
        const gate = await this.api.gateBoard(this.marked(Math.max(0, upTo - GATE_LINES)), this.metas());
        if (gate) {
          const lane = gate.thread ? this.lanes.get(gate.thread) : null;
          hint = `${gate.action} (pewność ${Math.round(gate.confidence * 100)}%)${gate.thread ? `, wątek ${gate.thread}` : ""}`;
          this.lastStep = `Jev: ${GATE_LABEL[gate.action] ?? gate.action}${lane ? ` · ${lane.title.textContent}` : ""}`;
          // Only wait when the classifier is quite sure; when in doubt, let the planner decide.
          if (gate.action === "wait" && gate.wait >= 0.7) {
            this.plannedLines = upTo; // small talk is handled too: it must not come back later
            return;
          }
        }
      }
      this.setStatus(`${this.lastStep ? this.lastStep + " · " : ""}planuję…`);
      const started = performance.now();
      const transcript = this.marked();
      // Mark the lines as handled before drawing, even if planning fails: a failed line must not loop forever.
      this.plannedLines = upTo;
      const ops = this.guard(await this.api.planBoard(transcript, this.metas(), hint), fresh.length, ask || hint.startsWith("ask"));
      for (const op of ops) this.apply(op, transcript);
      this.lastStep = `${this.lastStep ? this.lastStep + " · " : ""}plan ${((performance.now() - started) / 1000).toFixed(1)} s`;
    } catch (err) {
      this.onError(String(err));
    } finally {
      this.busy = false;
      this.setStatus();
    }
    // More lines arrived while we were busy.
    if (this.lines.length > this.plannedLines) this.changed();
  }

  /**
   * Deterministic guard rails on top of the planner, so the board cannot loop or spam versions whatever the model
   * returns: one op per thread, no more new cards than new lines (except "give me N ideas"), a quote that is already
   * on the board becomes an edit of that card, a version that would follow the previous one within 25 s becomes an
   * edit of it, and versions always continue from the newest card of their thread.
   */
  private guard(ops: PlanOp[], newLines: number, ask: boolean): PlanOp[] {
    const norm = (q: string) => q.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();
    const sameQuote = (a: string, b: string) => {
      const x = norm(a);
      const y = norm(b);
      return x.length >= 8 && y.length >= 8 && (x === y || (Math.min(x.length, y.length) >= 12 && (x.includes(y) || y.includes(x))));
    };
    const limit = ask ? 4 : Math.max(1, Math.min(2, newLines));
    const out: PlanOp[] = [];
    const threads = new Set<string>();
    for (const raw of ops) {
      if (out.length >= limit) break;
      const op = { ...raw };
      // A thread the model renamed slightly is still the same thread.
      if (!this.lanes.has(op.thread)) {
        const byTitle = [...this.lanes].find(([, lane]) => norm(lane.title.textContent ?? "") === norm(op.threadTitle));
        if (byTitle) op.thread = byTitle[0];
      }
      // Changes to the base product: a new version in the product lane, built from the newest product version.
      if (this.product && (op.thread === "produkt" || op.from === "produkt" || op.id === "produkt")) {
        const latest = this.latestIn("produkt");
        op.thread = "produkt";
        op.threadTitle = this.product.title;
        if (op.id === "produkt" || !latest || op.op !== "edit") op.op = "evolve";
        if (op.op === "evolve") {
          if (latest && Date.now() - latest.createdAt < 25_000) Object.assign(op, { op: "edit", id: latest.item.id });
          else op.from = latest ? latest.item.id : "produkt";
        }
        if (op.op === "edit") op.id = latest!.item.id;
        else op.id = this.uniqueId(op.id === "produkt" ? "produkt-v" : op.id || "produkt-v", (id) => this.cards.has(id) || id === "produkt");
        if (threads.has(op.thread)) continue;
        threads.add(op.thread);
        out.push(op);
        continue;
      }
      const duplicate = [...this.cards.values()].find((c) => sameQuote(c.item.quote, op.quote));
      if (duplicate && op.op !== "edit") {
        Object.assign(op, { op: "edit", id: this.latestIn(duplicate.item.thread).item.id, thread: duplicate.item.thread });
      }
      if (op.op === "edit") {
        const target = this.cards.get(op.id) ?? this.latestIn(op.thread);
        if (target) Object.assign(op, { id: target.item.id, thread: target.item.thread });
        else op.op = "create";
      }
      if (op.op === "evolve") {
        const latest = this.latestIn(op.thread);
        if (!latest) op.op = "create";
        else if (Date.now() - latest.createdAt < 25_000) Object.assign(op, { op: "edit", id: latest.item.id });
        else op.from = latest.item.id;
      }
      if (op.op === "create") {
        op.from = "";
        if (this.lanes.has(op.thread)) op.thread = this.uniqueId(op.thread, (id) => this.lanes.has(id));
      }
      if (op.op !== "edit") op.id = this.uniqueId(op.id || op.thread, (id) => this.cards.has(id));
      if (threads.has(op.thread)) continue;
      threads.add(op.thread);
      out.push(op);
    }
    return out;
  }

  private uniqueId(base: string, taken: (id: string) => boolean) {
    let id = base || "karta";
    for (let n = 2; taken(id); n++) id = `${base}-${n}`;
    return id;
  }

  private apply(op: PlanOp, transcript: string) {
    let card: Card;
    if (op.op === "edit") {
      // Small change in place: no new frame, no camera movement.
      card = this.cards.get(op.id)!;
      Object.assign(card.item, { title: op.title, summary: op.summary, kind: op.kind, quote: op.quote, at: op.at });
      this.fillLabels(card);
      this.flash(card, "edytowano");
    } else {
      const lane = this.lane(op.thread, op.threadTitle);
      const fromProduct = op.op === "evolve" && op.from === "produkt" && this.product;
      const from = op.op === "evolve" ? this.cards.get(op.from) : undefined;
      const base = fromProduct ? { source: this.product!.source, html: this.product!.html } : { source: from?.item.source ?? "", html: from?.item.html ?? "" };
      card = this.createCard(
        { id: op.id, thread: op.thread, threadTitle: op.threadTitle, kind: op.kind, title: op.title, summary: op.summary, from: fromProduct ? "produkt" : from?.item.id ?? "", quote: op.quote, at: op.at, source: base.source, html: base.html },
        lane,
      );
      if (base.html) this.setContent(card, base.html); // start from the previous version, then edit
      this.drawLinks();
      this.focusOn(card);
    }
    // One drawing per card at a time: a later edit waits and starts from the result of the earlier one.
    card.queue = card.queue.then(() => this.draw(card, op, transcript));
  }

  private latestIn(thread: string) {
    return [...this.cards.values()].filter((c) => c.item.thread === thread).sort((a, b) => b.col - a.col)[0];
  }

  private setStatus(text?: string) {
    const drawing = [...this.cards.values()].filter((c) => c.drawing).length;
    const parts = [text ?? this.lastStep, drawing ? `rysuję ${drawing}` : ""].filter(Boolean);
    this.statusEl.textContent = parts.join(" · ");
  }

  private async draw(card: Card, op: PlanOp, transcript: string) {
    if (this.cards.get(card.item.id) !== card) return; // removed meanwhile
    this.setDrawing(card, true);
    try {
      const drawn = await this.api.designCard(op, card.item.source, transcript);
      if (drawn === null || this.cards.get(card.item.id) !== card) return;
      card.item.source = drawn.source;
      card.item.html = drawn.html;
      this.setContent(card, drawn.html);
      void this.api.saveBoard([...this.cards.values()].map((c) => c.item));
    } catch (err) {
      this.onError(String(err));
    } finally {
      this.setDrawing(card, false);
    }
  }

  private setDrawing(card: Card, drawing: boolean) {
    card.drawing = drawing;
    card.el.classList.toggle("drawing", drawing);
    this.setStatus();
  }

  // MARK: - Lanes, frames, links

  private lane(id: string, title: string): Lane {
    let lane = this.lanes.get(id);
    if (!lane) {
      const el = document.createElement("div");
      el.className = "lane";
      const titleEl = document.createElement("h3");
      titleEl.className = "lane-title";
      el.append(titleEl);
      this.world.prepend(el);
      lane = { index: this.lanes.size, el, title: titleEl };
      this.lanes.set(id, lane);
      el.style.transform = `translate(-120px, ${lane.index * LANE_H - 380}px)`;
    }
    lane.title.textContent = title;
    return lane;
  }

  private createCard(item: BoardItem, lane: Lane): Card {
    const col = this.columns++;
    const x = col * (FRAME_W + GAP_X);
    const y = lane.index * LANE_H;

    const el = document.createElement("section");
    el.className = "frame";
    const label = document.createElement("header");
    label.className = "frame-label";
    label.innerHTML = `<span class="kind"></span><span class="title"></span><span class="note"></span><span class="live">rysuję</span>`;
    const host = document.createElement("div");
    host.className = "artboard";
    const shadow = host.attachShadow({ mode: "open" });
    const quote = document.createElement("blockquote");
    quote.className = "frame-quote";
    const caption = document.createElement("p");
    caption.className = "frame-caption";
    el.append(label, host, quote, caption);
    this.world.append(el);

    const card: Card = {
      item, col, x, y, el, label, title: label.querySelector(".title")!, host, shadow, quote, caption,
      drawing: false, createdAt: Date.now(), queue: Promise.resolve(),
    };
    this.cards.set(item.id, card);
    this.emptyEl.hidden = true;
    this.fillLabels(card);
    this.position(card);
    this.bindFrameInput(card);
    this.flash(card, item.from ? "nowa wersja" : "nowy pomysł");

    // Timeline ruler: one tick per column with the moment the card came from.
    const tick = document.createElement("span");
    tick.className = "tick";
    tick.style.transform = `translateX(${x}px)`;
    tick.textContent = item.at || "";
    this.ruler.append(tick);
    this.layoutLanes();
    return card;
  }

  private fillLabels(card: Card) {
    const { item } = card;
    card.el.dataset.kind = item.kind;
    card.title.textContent = item.title;
    card.label.querySelector(".kind")!.innerHTML = `${svg(KIND_ICON[item.kind])}${KIND_LABEL[item.kind]}`;
    card.quote.replaceChildren();
    if (item.quote) {
      const text = document.createElement("span");
      text.textContent = `„${item.quote.replace(/^["„”]+|["„”]+$/g, "")}”`;
      const at = document.createElement("time");
      at.textContent = item.at;
      card.quote.append(text, at);
    }
    card.caption.textContent = item.summary;
  }

  private flash(card: Card, note: string) {
    const el = card.label.querySelector(".note") as HTMLElement;
    el.textContent = note;
    card.el.classList.remove("fresh");
    void card.el.offsetWidth; // restart the highlight animation
    card.el.classList.add("fresh");
  }

  /** Lane backgrounds span the whole timeline width. */
  private layoutLanes() {
    const width = Math.max(1, this.columns) * (FRAME_W + GAP_X) - GAP_X + 240;
    for (const lane of this.lanes.values()) lane.el.style.width = `${width}px`;
    this.ruler.style.width = `${width}px`;
  }

  /** Arrows from each version to the one it grew out of. */
  private drawLinks() {
    const paths: string[] = [];
    for (const card of this.cards.values()) {
      const from = this.cards.get(card.item.from);
      if (!from) continue;
      const x0 = from.x + FRAME_W;
      const y0 = from.y + FRAME_H / 2;
      const x1 = card.x - 14;
      const y1 = card.y + FRAME_H / 2;
      const dx = Math.max(80, (x1 - x0) / 2);
      paths.push(`<path d="M${x0} ${y0} C${x0 + dx} ${y0}, ${x1 - dx} ${y1}, ${x1} ${y1}" marker-end="url(#arrow)"/>`);
    }
    // Every thread starts from the base product: solid for versions of the product itself, dashed for other ideas.
    if (this.product) {
      const firsts = new Map<string, Card>();
      for (const card of this.cards.values()) {
        if (card.item.from === "produkt") {
          const x0 = this.product.x + FRAME_W;
          const y0 = this.product.y + FRAME_H / 2;
          const x1 = card.x - 14;
          const y1 = card.y + FRAME_H / 2;
          const dx = Math.max(80, (x1 - x0) / 2);
          paths.push(`<path d="M${x0} ${y0} C${x0 + dx} ${y0}, ${x1 - dx} ${y1}, ${x1} ${y1}" marker-end="url(#arrow)"/>`);
          continue;
        }
        if (card.item.thread === "produkt") continue;
        const first = firsts.get(card.item.thread);
        if (!first || card.col < first.col) firsts.set(card.item.thread, card);
      }
      for (const card of firsts.values()) {
        const x0 = this.product.x + FRAME_W;
        const y0 = this.product.y + FRAME_H / 2;
        const x1 = card.x - 14;
        const y1 = card.y + FRAME_H / 2;
        const dx = Math.max(80, (x1 - x0) / 2);
        paths.push(`<path class="from-product" d="M${x0} ${y0} C${x0 + dx} ${y0}, ${x1 - dx} ${y1}, ${x1} ${y1}" marker-end="url(#arrow)"/>`);
      }
    }
    this.links.innerHTML = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>${paths.join("")}`;
  }

  private position(card: Card) {
    card.el.style.transform = `translate(${card.x}px, ${card.y}px)`;
  }

  private setContent(card: Card, html: string) {
    this.render(card.shadow, html);
  }

  /** Renders model HTML into a shadow root: styles stay scoped and nothing has to reload. */
  private render(shadow: ShadowRoot, html: string) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    sanitize(doc);
    const css = [...doc.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
    registerProperties(css);
    const style = document.createElement("style");
    style.textContent = `:host { all: initial; display: block; width: ${FRAME_W}px; height: ${FRAME_H}px; overflow: hidden; background: #fff; }
      .page { width: ${FRAME_W}px; height: ${FRAME_H}px; overflow: hidden; }\n${css}`;
    const page = document.createElement("div");
    page.className = `page ${doc.body.className}`;
    const inline = doc.body.getAttribute("style");
    if (inline) page.setAttribute("style", inline);
    for (const node of [...doc.body.childNodes]) {
      if (node.nodeName !== "STYLE") page.append(document.importNode(node, true));
    }
    shadow.replaceChildren(style, page);
  }

  private select(card: Card | null) {
    this.selected?.el.classList.remove("selected");
    this.selected = card;
    card?.el.classList.add("selected");
  }

  // MARK: - Camera

  private applyCamera() {
    const { x, y, z } = this.cam;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    this.world.style.setProperty("--z", String(z));
    this.viewport.style.backgroundPosition = `${x}px ${y}px`;
    this.viewport.style.backgroundSize = `${24 * z}px ${24 * z}px`;
    this.zoomLabel.textContent = `${Math.round(z * 100)}%`;
  }

  private animateTo(target: { x: number; y: number; z: number }) {
    this.world.classList.add("animating");
    this.cam = target;
    this.applyCamera();
    window.setTimeout(() => this.world.classList.remove("animating"), 420);
  }

  private zoomAt(sx: number, sy: number, factor: number, animate = false) {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.cam.z * factor));
    const k = z / this.cam.z;
    const next = { x: sx - (sx - this.cam.x) * k, y: sy - (sy - this.cam.y) * k, z };
    if (animate) this.animateTo(next);
    else {
      this.cam = next;
      this.applyCamera();
    }
  }

  private fitRect(x0: number, y0: number, x1: number, y1: number, animate: boolean) {
    const { width, height } = this.viewport.getBoundingClientRect();
    const pad = 64;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((width - pad * 2) / (x1 - x0), (height - pad * 2 - 40) / (y1 - y0))));
    const target = { x: (width - (x1 - x0) * z) / 2 - x0 * z, y: (height - (y1 - y0) * z) / 2 - y0 * z, z };
    if (animate) this.animateTo(target);
    else {
      this.cam = target;
      this.applyCamera();
    }
  }

  private fitCards(cards: Card[], animate: boolean) {
    if (!cards.length) return;
    const x0 = Math.min(...cards.map((c) => c.x)) - 80;
    const y0 = Math.min(...cards.map((c) => c.y)) - 220;
    const x1 = Math.max(...cards.map((c) => c.x + FRAME_W)) + 80;
    const y1 = Math.max(...cards.map((c) => c.y + FRAME_H)) + 220;
    this.fitRect(x0, y0, x1, y1, animate);
  }

  private fitAll(animate: boolean) {
    const cards = [...this.cards.values()];
    if (this.product) cards.push({ x: this.product.x, y: this.product.y } as Card);
    this.fitCards(cards, animate);
  }

  /** Follow mode: show the newest card next to the one it came from, not the whole (growing) board. */
  private focusOn(card: Card) {
    if (!this.follow) return;
    const from = this.cards.get(card.item.from);
    const recent = [...this.cards.values()].sort((a, b) => b.col - a.col).slice(0, 3);
    this.fitCards([...new Set([card, ...(from ? [from] : []), ...recent])], true);
    this.follow = true;
  }

  private setFollow(follow: boolean) {
    this.follow = follow;
    this.followButton.classList.toggle("active", follow);
    const newest = [...this.cards.values()].sort((a, b) => b.col - a.col)[0];
    if (follow && newest) this.focusOn(newest);
  }

  // MARK: - Input

  private bindCanvasInput() {
    const vp = this.viewport;
    vp.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.setFollow(false);
        const rect = vp.getBoundingClientRect();
        if (e.ctrlKey || e.metaKey) {
          // Pinch on a trackpad arrives as ctrl+wheel.
          this.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.01));
        } else {
          this.cam.x -= e.deltaX;
          this.cam.y -= e.deltaY;
          this.applyCamera();
        }
      },
      { passive: false },
    );

    let pan: { x: number; y: number } | null = null;
    vp.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest(".frame, .zoom-controls")) return;
      this.select(null);
      pan = { x: e.clientX, y: e.clientY };
      vp.setPointerCapture(e.pointerId);
      vp.classList.add("panning");
    });
    vp.addEventListener("pointermove", (e) => {
      if (!pan) return;
      this.setFollow(false);
      this.cam.x += e.clientX - pan.x;
      this.cam.y += e.clientY - pan.y;
      pan = { x: e.clientX, y: e.clientY };
      this.applyCamera();
    });
    const end = () => {
      pan = null;
      vp.classList.remove("panning");
    };
    vp.addEventListener("pointerup", end);
    vp.addEventListener("pointercancel", end);

    window.addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement).closest("input, select, textarea")) return;
      const rect = vp.getBoundingClientRect();
      if (e.shiftKey && e.code === "Digit1") {
        this.setFollow(false);
        this.fitAll(true);
      }
      else if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+")) this.zoomAt(rect.width / 2, rect.height / 2, 1.25, true);
      else if ((e.metaKey || e.ctrlKey) && e.key === "-") this.zoomAt(rect.width / 2, rect.height / 2, 0.8, true);
      else if (e.key === "Escape") this.select(null);
      else return;
      e.preventDefault();
    });
  }

  private bindFrameInput(card: Card) {
    // Frames are moved by their label, like in Figma.
    let drag: { x: number; y: number } | null = null;
    card.label.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.select(card);
      drag = { x: e.clientX, y: e.clientY };
      card.label.setPointerCapture(e.pointerId);
      card.el.classList.add("dragging");
    });
    card.label.addEventListener("pointermove", (e) => {
      if (!drag) return;
      card.x += (e.clientX - drag.x) / this.cam.z;
      card.y += (e.clientY - drag.y) / this.cam.z;
      drag = { x: e.clientX, y: e.clientY };
      this.position(card);
      this.drawLinks();
    });
    const end = () => {
      drag = null;
      card.el.classList.remove("dragging");
    };
    card.label.addEventListener("pointerup", end);
    card.label.addEventListener("pointercancel", end);

    card.host.addEventListener("pointerdown", () => this.select(card));
    card.host.addEventListener("dblclick", () => {
      this.setFollow(false);
      this.fitRect(card.x - 40, card.y - 80, card.x + FRAME_W + 40, card.y + FRAME_H + 200, true);
    });
  }
}
