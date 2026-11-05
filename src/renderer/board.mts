// Live whiteboard as a Figma-like canvas: plans card changes from the running transcript (including what is being
// said right now), places each card as a 960x600 frame on an infinite pan/zoom canvas and streams its HTML in live.

import type { BestieApi } from "../preload.js";

export interface BoardItem {
  id: string;
  kind: "mockup" | "flow" | "idea";
  title: string;
  summary: string;
  html: string;
}

const KIND_LABEL: Record<BoardItem["kind"], string> = { mockup: "Mockup", flow: "Flow", idea: "Pomysł" };
const KIND_ICON: Record<BoardItem["kind"], string> = {
  mockup: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  flow: '<rect x="2" y="9" width="6" height="6" rx="1"/><rect x="16" y="9" width="6" height="6" rx="1"/><path d="M8 12h8"/>',
  idea: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
};
/** Plan this long after the conversation last changed… */
const DEBOUNCE_MS = 1_200;
/** …but at least this often while people keep talking. */
const MAX_WAIT_MS = 4_000;

const FRAME_W = 960;
const FRAME_H = 600;
const GAP_X = 160;
const GAP_Y = 260;
const COLUMNS = 3;
const MIN_ZOOM = 0.08;
const MAX_ZOOM = 2;

interface Card {
  item: BoardItem;
  x: number;
  y: number;
  el: HTMLElement;
  label: HTMLElement;
  title: HTMLElement;
  host: HTMLElement;
  shadow: ShadowRoot;
  caption: HTMLElement;
  drawing: boolean;
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
  private lines: string[] = [];
  private partials = new Map<string, string>();
  private version = 0; // bumps on every transcript change
  private plannedVersion = 0;
  private planning = false;
  private debounce: number | undefined;
  private deadline: number | undefined;
  private lastPlan = "";
  private slots = 0;
  enabled = true;

  // Canvas camera: screen = world * z + (x, y)
  private cam = { x: 40, y: 40, z: 0.4 };
  private follow = true;
  private world: HTMLElement;
  private emptyEl: HTMLElement;
  private zoomLabel: HTMLElement;
  private followButton: HTMLButtonElement;
  private selected: Card | null = null;

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
    this.emptyEl = document.createElement("p");
    this.emptyEl.className = "empty";
    this.emptyEl.textContent = "Tablica zapełni się mockupami i pomysłami, gdy zaczniecie rozmawiać.";
    const controls = document.createElement("div");
    controls.className = "zoom-controls";
    controls.innerHTML = `
      <button data-act="follow" title="Śledź nowe ramki">${svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>')}<span>Śledź</span></button>
      <span class="sep"></span>
      <button data-act="out" title="Oddal (⌘−)">${svg('<path d="M5 12h14"/>')}</button>
      <span class="zoom-value">40%</span>
      <button data-act="in" title="Przybliż (⌘+)">${svg('<path d="M12 5v14M5 12h14"/>')}</button>
      <button data-act="fit" title="Dopasuj wszystko (⇧1)">${svg('<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/>')}<span>Dopasuj</span></button>`;
    this.zoomLabel = controls.querySelector(".zoom-value")!;
    this.followButton = controls.querySelector('[data-act="follow"]')!;
    controls.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest("button")?.dataset.act;
      const rect = this.viewport.getBoundingClientRect();
      if (act === "in") this.zoomAt(rect.width / 2, rect.height / 2, 1.25, true);
      if (act === "out") this.zoomAt(rect.width / 2, rect.height / 2, 0.8, true);
      if (act === "fit") this.setFollow(true);
      if (act === "follow") this.setFollow(!this.follow);
    });
    viewport.append(this.world, this.emptyEl, controls);

    // Focus inside a mockup would scroll the overflow:hidden viewport and desync it from the camera.
    viewport.addEventListener("scroll", () => (viewport.scrollTop = viewport.scrollLeft = 0));
    this.bindCanvasInput();
    new ResizeObserver(() => this.follow && this.fitAll(false)).observe(viewport);
    this.applyCamera();
    this.setFollow(true);
  }

  reset() {
    for (const card of this.cards.values()) card.el.remove();
    this.cards.clear();
    this.slots = 0;
    this.lines = [];
    this.partials.clear();
    this.version = this.plannedVersion = 0;
    this.clearTimers();
    this.emptyEl.hidden = false;
    this.setFollow(true);
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

  // MARK: - Planning

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
        void this.draw(this.upsert(meta), planned, transcript);
      }
      if (this.follow) this.fitAll(true);
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

  private updateStatus() {
    const drawing = [...this.cards.values()].filter((c) => c.drawing).length;
    const parts = [this.planning ? "Planuję…" : this.lastPlan, drawing ? `rysuję ${drawing}` : ""].filter(Boolean);
    this.statusEl.textContent = parts.join(" · ");
  }

  private async draw(card: Card, planned: Parameters<BestieApi["designCard"]>[0], transcript: string) {
    this.setDrawing(card, true);
    try {
      const html = await this.api.designCard(planned, transcript);
      if (html === null || this.cards.get(card.item.id) !== card) return; // superseded or removed
      card.item.html = html;
      this.setContent(card, html);
      this.setDrawing(card, false);
      void this.api.saveBoard([...this.cards.values()].map((c) => c.item));
    } catch (err) {
      this.setDrawing(card, false);
      this.onError(String(err));
    }
  }

  private setDrawing(card: Card, drawing: boolean) {
    card.drawing = drawing;
    card.el.classList.toggle("drawing", drawing);
    this.updateStatus();
  }

  // MARK: - Frames

  private upsert(meta: Omit<BoardItem, "html">): Card {
    let card = this.cards.get(meta.id);
    if (!card) {
      card = this.createCard({ ...meta, html: "" });
      this.cards.set(meta.id, card);
      this.emptyEl.hidden = true;
    }
    Object.assign(card.item, meta);
    card.el.dataset.kind = meta.kind;
    card.title.textContent = meta.title;
    card.caption.textContent = meta.summary;
    card.label.querySelector(".kind")!.innerHTML = `${svg(KIND_ICON[meta.kind])}${KIND_LABEL[meta.kind]}`;
    card.el.classList.remove("fresh");
    void card.el.offsetWidth; // restart the highlight animation
    card.el.classList.add("fresh");
    return card;
  }

  private remove(id: string) {
    const card = this.cards.get(id);
    if (!card) return;
    card.el.remove();
    this.cards.delete(id);
    if (this.selected === card) this.selected = null;
    this.emptyEl.hidden = this.cards.size > 0;
  }

  private createCard(item: BoardItem): Card {
    const slot = this.slots++;
    const x = (slot % COLUMNS) * (FRAME_W + GAP_X);
    const y = Math.floor(slot / COLUMNS) * (FRAME_H + GAP_Y);

    const el = document.createElement("section");
    el.className = "frame";
    const label = document.createElement("header");
    label.className = "frame-label";
    label.innerHTML = `<span class="kind"></span><span class="title"></span><span class="live">rysuję</span>`;
    const host = document.createElement("div");
    host.className = "artboard";
    const shadow = host.attachShadow({ mode: "open" });
    const caption = document.createElement("p");
    caption.className = "frame-caption";
    el.append(label, host, caption);
    this.world.append(el);

    const card: Card = { item, x, y, el, label, title: label.querySelector(".title")!, host, shadow, caption, drawing: false };
    this.position(card);
    this.bindFrameInput(card);
    return card;
  }

  private position(card: Card) {
    card.el.style.transform = `translate(${card.x}px, ${card.y}px)`;
  }

  /** Renders model HTML into the frame's shadow root: styles stay scoped and no iframe has to reload. */
  private setContent(card: Card, html: string) {
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
    card.shadow.replaceChildren(style, page);
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

  private fitAll(animate: boolean) {
    if (!this.cards.size) return;
    const cards = [...this.cards.values()];
    const x0 = Math.min(...cards.map((c) => c.x));
    const y0 = Math.min(...cards.map((c) => c.y)) - 60;
    const x1 = Math.max(...cards.map((c) => c.x + FRAME_W));
    const y1 = Math.max(...cards.map((c) => c.y + FRAME_H)) + 120;
    this.fitRect(x0, y0, x1, y1, animate);
  }

  private setFollow(follow: boolean) {
    this.follow = follow;
    this.followButton.classList.toggle("active", follow);
    if (follow) this.fitAll(true);
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
      if (e.shiftKey && e.code === "Digit1") this.setFollow(true);
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
      this.fitRect(card.x, card.y - 40, card.x + FRAME_W, card.y + FRAME_H + 40, true);
    });
  }
}
