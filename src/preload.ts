import { contextBridge, ipcRenderer } from "electron";
import type { BoardItem, BoardPlan, PlannedItem } from "./board";

const api = {
  platform: process.platform,
  getSettings: (): Promise<{ hasElevenLabsKey: boolean; hasGroqKey: boolean; hasAnthropicKey: boolean; language: string }> =>
    ipcRenderer.invoke("settings:get"),
  setApiKey: (name: "elevenlabs" | "groq" | "anthropic", key: string): Promise<void> => ipcRenderer.invoke("settings:set-api-key", name, key),
  setLanguage: (language: string): Promise<void> => ipcRenderer.invoke("settings:set-language", language),
  scribeToken: (): Promise<string> => ipcRenderer.invoke("scribe:token"),
  startSession: (): Promise<string> => ipcRenderer.invoke("session:start"),
  appendTranscript: (line: string): Promise<void> => ipcRenderer.invoke("session:transcript", line),
  appendAudio: (chunk: ArrayBuffer): Promise<void> => ipcRenderer.invoke("session:audio", chunk),
  finishSession: (): Promise<string | null> => ipcRenderer.invoke("session:finish"),
  revealRecordings: (): Promise<void> => ipcRenderer.invoke("session:reveal"),
  planBoard: (transcript: string, board: Omit<BoardItem, "html">[]): Promise<BoardPlan> =>
    ipcRenderer.invoke("board:plan", transcript, board),
  /** Resolves with the final HTML, or null if a newer version of the card superseded this one. */
  designCard: (item: PlannedItem, transcript: string): Promise<string | null> =>
    ipcRenderer.invoke("board:design", item, transcript),
  onBoardPartial: (listener: (id: string, html: string) => void) => {
    ipcRenderer.on("board:partial", (_e, id: string, html: string) => listener(id, html));
  },
  saveBoard: (board: BoardItem[]): Promise<void> => ipcRenderer.invoke("board:save", board),
};

export type BestieApi = typeof api;

contextBridge.exposeInMainWorld("bestie", api);
