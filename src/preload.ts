import { contextBridge, ipcRenderer } from "electron";
import type { BoardItem, CardMeta, Costs, Drawn, Gate, PlanOp } from "./board";
import type { Product } from "./product";

const api = {
  platform: process.platform,
  getSettings: (): Promise<{ hasElevenLabsKey: boolean; hasGroqKey: boolean; hasAnthropicKey: boolean; hasOpenRouterKey: boolean; language: string }> =>
    ipcRenderer.invoke("settings:get"),
  setApiKey: (name: "elevenlabs" | "groq" | "anthropic" | "openrouter", key: string): Promise<void> => ipcRenderer.invoke("settings:set-api-key", name, key),
  setLanguage: (language: string): Promise<void> => ipcRenderer.invoke("settings:set-language", language),
  scribeToken: (): Promise<string> => ipcRenderer.invoke("scribe:token"),
  startSession: (): Promise<string> => ipcRenderer.invoke("session:start"),
  appendTranscript: (line: string): Promise<void> => ipcRenderer.invoke("session:transcript", line),
  appendAudio: (chunk: ArrayBuffer): Promise<void> => ipcRenderer.invoke("session:audio", chunk),
  finishSession: (): Promise<string | null> => ipcRenderer.invoke("session:finish"),
  revealRecordings: (): Promise<void> => ipcRenderer.invoke("session:reveal"),
  /** Null when no OpenRouter key is set (no gate). */
  gateBoard: (recent: string, board: CardMeta[]): Promise<Gate | null> => ipcRenderer.invoke("board:gate", recent, board),
  planBoard: (transcript: string, board: CardMeta[], hint: string): Promise<PlanOp[]> =>
    ipcRenderer.invoke("board:plan", transcript, board, hint),
  /** Resolves with the final card, or null if a newer drawing of the same card superseded this one. */
  designCard: (op: PlanOp, base: string, transcript: string): Promise<Drawn | null> =>
    ipcRenderer.invoke("board:design", op, base, transcript),
  onBoardPartial: (listener: (id: string, html: string) => void) => {
    ipcRenderer.on("board:partial", (_e, id: string, html: string) => listener(id, html));
  },
  loadProduct: (url: string): Promise<Product> => ipcRenderer.invoke("product:load", url),
  clearProduct: (): Promise<void> => ipcRenderer.invoke("product:clear"),
  /** Null without a Claude key. */
  replicateProduct: (): Promise<Drawn | null> => ipcRenderer.invoke("product:replicate"),
  onProductPartial: (listener: (html: string) => void) => {
    ipcRenderer.on("product:partial", (_e, html: string) => listener(html));
  },
  onCosts: (listener: (costs: Costs) => void) => {
    ipcRenderer.on("costs", (_e, costs: Costs) => listener(costs));
  },
  resetCosts: (): Promise<void> => ipcRenderer.invoke("costs:reset"),
  /** Starts Horda if needed; resolves with the URL of its live panel. */
  prepareHorda: (): Promise<string> => ipcRenderer.invoke("horda:prepare"),
  runHorda: (
    a: { id: string; html: string },
    b: { id: string; html: string },
    agents: number,
  ): Promise<{ conv: { A: string; B: string }; headline: string; pValue: number | null; cost: number }> =>
    ipcRenderer.invoke("horda:run", a, b, agents),
  saveBoard: (board: BoardItem[]): Promise<void> => ipcRenderer.invoke("board:save", board),
};

export type BestieApi = typeof api;

contextBridge.exposeInMainWorld("bestie", api);
