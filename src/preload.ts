import { contextBridge, ipcRenderer } from "electron";
import type { BoardItem, CardMeta, Costs, Drawn, Gate, PlanOp } from "./board";
import type { Images, InternetIntent, Research, Video } from "./internet";
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
  internetIntent: (earlier: string, fresh: string): Promise<InternetIntent[]> => ipcRenderer.invoke("internet:intent", earlier, fresh),
  researchWeb: (request: string, context: string): Promise<Research> => ipcRenderer.invoke("internet:research", request, context),
  findImages: (request: string): Promise<Images> => ipcRenderer.invoke("internet:images", request),
  findVideo: (query: string): Promise<Video | null> => ipcRenderer.invoke("internet:video", query),
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
  /** Runs Horda on two cards; live events arrive through onHordaEvent with the same runId. */
  runHorda: (
    runId: string,
    a: { id: string; html: string },
    b: { id: string; html: string },
    agents: number,
  ): Promise<{ conv: { A: string; B: string }; headline: string; pValue: number | null; cost: number }> =>
    ipcRenderer.invoke("horda:run", runId, a, b, agents),
  onHordaEvent: (listener: (runId: string, ev: HordaEvent) => void) => {
    ipcRenderer.on("horda:event", (_e, runId: string, ev: HordaEvent) => listener(runId, ev));
  },
  saveBoard: (board: BoardItem[]): Promise<void> => ipcRenderer.invoke("board:save", board),
};

/** Horda's live events (see horda/server.js and horda/lib/agent.js). */
export interface HordaEvent {
  type: "start" | "agent" | "phase" | "done";
  text?: string;
  personas?: { id: string; name: string; age: number; role: string; device: string }[];
  variants?: Record<string, string>;
  variant?: string;
  personaId?: string;
  status?: string;
  shot?: string;
  think?: string;
  quote?: string;
  reason?: string;
  path?: string[];
}

export type BestieApi = typeof api;

contextBridge.exposeInMainWorld("bestie", api);
