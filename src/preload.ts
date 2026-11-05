import { contextBridge, ipcRenderer } from "electron";
import type { BoardItem, BoardUpdate } from "./board";

const api = {
  platform: process.platform,
  getSettings: (): Promise<{ hasElevenLabsKey: boolean; hasGroqKey: boolean; language: string }> =>
    ipcRenderer.invoke("settings:get"),
  setApiKey: (name: "elevenlabs" | "groq", key: string): Promise<void> => ipcRenderer.invoke("settings:set-api-key", name, key),
  setLanguage: (language: string): Promise<void> => ipcRenderer.invoke("settings:set-language", language),
  scribeToken: (): Promise<string> => ipcRenderer.invoke("scribe:token"),
  startSession: (): Promise<string> => ipcRenderer.invoke("session:start"),
  appendTranscript: (line: string): Promise<void> => ipcRenderer.invoke("session:transcript", line),
  appendAudio: (chunk: ArrayBuffer): Promise<void> => ipcRenderer.invoke("session:audio", chunk),
  finishSession: (): Promise<string | null> => ipcRenderer.invoke("session:finish"),
  revealRecordings: (): Promise<void> => ipcRenderer.invoke("session:reveal"),
  updateBoard: (transcript: string, board: BoardItem[]): Promise<BoardUpdate> =>
    ipcRenderer.invoke("board:update", transcript, board),
  saveBoard: (board: BoardItem[]): Promise<void> => ipcRenderer.invoke("board:save", board),
};

export type BestieApi = typeof api;

contextBridge.exposeInMainWorld("bestie", api);
