// Live whiteboard: feeds the transcript to the main process (Groq) and renders returned mockups/flows/ideas.

export interface BoardItem {
  id: string;
  kind: "mockup" | "flow" | "idea";
  title: string;
  summary: string;
  html: string;
}

interface BoardApi {
  updateBoard(transcript: string, board: BoardItem[]): Promise<{ upserts: BoardItem[]; removals: string[] }>;
  saveBoard(board: BoardItem[]): Promise<void>;
}

const KIND_LABEL: Record<BoardItem["kind"], string> = { mockup: "Mockup", flow: "Flow", idea: "Pomysł" };
/** Run after this many new transcript lines… */
const MIN_NEW_LINES = 2;
/** …or after this long with at least one new line. */
const MAX_WAIT_MS = 12_000;

export class Whiteboard {
  private items = new Map<string, BoardItem>();
  private lines: string[] = [];
  private sentLines = 0;
  private running = false;
  private waitTimer: number | undefined;
  enabled = true;

  constructor(
    private api: BoardApi,
    private grid: HTMLElement,
    private statusEl: HTMLElement,
    private onError: (message: string) => void,
  ) {
    new ResizeObserver(() => this.fitFrames()).observe(grid);
    this.render();
  }

  /** Mockups are laid out at 960 px wide; scale each preview to its card. */
  private fitFrames() {
    for (const frame of this.grid.querySelectorAll<HTMLElement>(".frame")) {
      frame.style.setProperty("--scale", String(frame.clientWidth / 960));
    }
  }

  reset() {
    this.items.clear();
    this.lines = [];
    this.sentLines = 0;
    window.clearTimeout(this.waitTimer);
    this.render();
  }

  addLine(line: string) {
    this.lines.push(line);
    this.schedule();
  }

  /** Forces an update now (e.g. the "refresh" button or at the end of a recording). */
  async flush() {
    window.clearTimeout(this.waitTimer);
    await this.run(true);
  }

  private schedule() {
    if (!this.enabled) return;
    const pending = this.lines.length - this.sentLines;
    if (pending >= MIN_NEW_LINES) {
      window.clearTimeout(this.waitTimer);
      void this.run();
    } else if (pending > 0) {
      window.clearTimeout(this.waitTimer);
      this.waitTimer = window.setTimeout(() => void this.run(), MAX_WAIT_MS);
    }
  }

  private async run(force = false) {
    if (this.running || (!force && !this.enabled)) return;
    if (this.lines.length === 0 || (!force && this.lines.length === this.sentLines)) return;
    this.running = true;
    const upTo = this.lines.length;
    this.setStatus("Rysuję…");
    const started = performance.now();
    try {
      const { upserts, removals } = await this.api.updateBoard(this.lines.join("\n"), [...this.items.values()]);
      this.sentLines = upTo;
      for (const id of removals) this.items.delete(id);
      for (const item of upserts) this.items.set(item.id, item);
      this.render(new Set(upserts.map((i) => i.id)));
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      this.setStatus(upserts.length || removals.length ? `Zaktualizowano ${upserts.length} (${seconds} s)` : `Bez zmian (${seconds} s)`);
      void this.api.saveBoard([...this.items.values()]);
    } catch (err) {
      this.setStatus("Błąd");
      this.onError(String(err));
    } finally {
      this.running = false;
    }
    // Lines that arrived while we were waiting for the model.
    this.schedule();
  }

  private setStatus(text: string) {
    this.statusEl.textContent = text;
  }

  private render(changed = new Set<string>()) {
    this.grid.replaceChildren();
    if (this.items.size === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Tablica zapełni się mockupami i pomysłami, gdy zaczniecie rozmawiać.";
      this.grid.append(empty);
      return;
    }
    // Most recently changed first.
    const items = [...this.items.values()].sort((a, b) => Number(changed.has(b.id)) - Number(changed.has(a.id)));
    for (const item of items) this.grid.append(this.card(item, changed.has(item.id)));
    this.fitFrames();
  }

  private card(item: BoardItem, fresh: boolean) {
    const card = document.createElement("article");
    card.className = `card ${item.kind}${fresh ? " fresh" : ""}`;

    const header = document.createElement("header");
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = KIND_LABEL[item.kind];
    const title = document.createElement("h3");
    title.textContent = item.title;
    header.append(badge, title);

    const frameWrap = document.createElement("div");
    frameWrap.className = "frame";
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", ""); // no scripts, opaque origin
    frame.srcdoc = item.html;
    frameWrap.append(frame);

    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = item.summary;

    card.append(header, frameWrap, summary);
    card.addEventListener("click", () => this.open(item));
    return card;
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
