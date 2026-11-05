// Speech without an ElevenLabs key: the browser's own recognition behind the same class the app already uses.
// With a real key nothing changes. A browser recognises one source, its default microphone, so the app's second
// session (system audio) stays silent.

import { ScribeSession as Elevenlabs, type ScribeEvent } from "../../src/renderer/scribe.mts";
import { readConfig } from "./config";

export type { ScribeEvent };

const useBrowser = readConfig().elevenlabs === "browser";
let listening = false;

const LOCALES: Record<string, string> = { pl: "pl-PL", en: "en-US" };

class BrowserSpeech {
  private recognition: any = null;
  private active = false;

  constructor(
    _getToken: () => Promise<string>,
    private languageCode: string | null,
    private onEvent: (event: ScribeEvent) => void,
  ) {}

  async connect() {
    if (listening) return;
    const Recognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Recognition) throw new Error("Rozpoznawanie mowy działa tylko w Chrome lub Edge.");
    listening = this.active = true;
    this.recognition = new Recognition();
    this.recognition.lang = LOCALES[this.languageCode ?? ""] ?? navigator.language;
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) {
          if (text) this.onEvent({ type: "committed", text });
        } else interim += ` ${text}`;
      }
      if (interim) this.onEvent({ type: "partial", text: interim.trim() });
    };
    this.recognition.onerror = (e: any) => {
      if (e.error !== "no-speech" && e.error !== "aborted") this.onEvent({ type: "error", message: `Rozpoznawanie mowy: ${e.error}` });
    };
    // Chrome ends recognition after a silence, so keep it going while recording.
    this.recognition.onend = () => {
      if (this.active) this.recognition.start();
    };
    this.recognition.start();
  }

  send(_pcm: ArrayBuffer, _commit = false) {}

  async finish() {
    if (!this.active) return;
    this.active = listening = false;
    this.recognition.stop();
  }
}

export const ScribeSession = useBrowser ? BrowserSpeech : Elevenlabs;
