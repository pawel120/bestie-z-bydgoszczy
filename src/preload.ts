import { contextBridge, ipcRenderer } from "electron";

const api = {
  platform: process.platform,
  getSettings: (): Promise<{ hasApiKey: boolean; language: string }> => ipcRenderer.invoke("settings:get"),
  setApiKey: (key: string): Promise<void> => ipcRenderer.invoke("settings:set-api-key", key),
  setLanguage: (language: string): Promise<void> => ipcRenderer.invoke("settings:set-language", language),
  scribeToken: (): Promise<string> => ipcRenderer.invoke("scribe:token"),
  startSession: (): Promise<string> => ipcRenderer.invoke("session:start"),
  appendTranscript: (line: string): Promise<void> => ipcRenderer.invoke("session:transcript", line),
  appendAudio: (chunk: ArrayBuffer): Promise<void> => ipcRenderer.invoke("session:audio", chunk),
  finishSession: (): Promise<string | null> => ipcRenderer.invoke("session:finish"),
  revealRecordings: (): Promise<void> => ipcRenderer.invoke("session:reveal"),
};

export type BestieApi = typeof api;

contextBridge.exposeInMainWorld("bestie", api);
