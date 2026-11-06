// Speech without an ElevenLabs key: the browser's own recognition behind the same class the app already uses.
// With a real key nothing changes. A browser recognises one source, its default microphone, so the app's second
// session (system audio) stays silent.

import { ScribeSession as Elevenlabs, type ScribeEvent } from "../../src/renderer/scribe.mts";
import { readConfig } from "./config";

export type { ScribeEvent };

const useBrowser = readConfig().elevenlabs === "browser";
let listening = false;

const LOCALES: Record<string, string> = { pl: "pl-PL", pol: "pl-PL", en: "en-US", eng: "en-US" };
const MESSAGES: Record<string, string> = {
  "no-speech": "Nie słyszę mowy. Sprawdź, czy przeglądarka używa właściwego mikrofonu.",
  "not-allowed": "Przeglądarka zablokowała mikrofon. Zezwól na niego przy pasku adresu i odśwież stronę.",
  "service-not-allowed": "Przeglądarka zablokowała rozpoznawanie mowy.",
  "audio-capture": "Nie mogę użyć mikrofonu. Sprawdź, czy jest podłączony i czy nie zajmuje go inny program.",
  network: "Rozpoznawanie mowy nie ma połączenia z internetem.",
};

class BrowserSpeech {
  private recognition: any = null;
  private active = false;
  private muted = false;
  private onMic = (e: Event) => this.setMuted((e as CustomEvent<{ muted: boolean }>).detail.muted);

  constructor(
    _getToken: () => Promise<string>,
    private languageCode: string | null,
    private onEvent: (event: ScribeEvent) => void,
  ) {}

  async connect() {
    if (listening) return;
    const Recognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Recognition) return this.onEvent({ type: "error", message: "Rozpoznawanie mowy działa tylko w Chrome lub Edge." });
    listening = this.active = true;
    window.addEventListener("bestie-mic", this.onMic);
    this.recognition = new Recognition();
    this.recognition.lang = LOCALES[this.languageCode ?? ""] ?? "pl-PL";
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
      if (e.error === "aborted") return;
      const fatal = e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture";
      if (fatal) this.active = false; // restarting can't help, and would loop
      this.onEvent({ type: "error", message: MESSAGES[e.error] ?? `Rozpoznawanie mowy: ${e.error}` });
    };
    this.recognition.onspeechstart = () => this.onEvent({ type: "error", message: "Słyszę Cię, rozpoznaję…" });
    // Chrome ends recognition after a silence, so keep it going while recording.
    this.recognition.onend = () => {
      if (!this.active || this.muted) return;
      try {
        this.recognition.start();
      } catch {
        // Already running again.
      }
    };
    this.recognition.start();
  }

  private setMuted(on: boolean) {
    this.muted = on;
    if (on) return this.recognition.stop();
    try {
      this.recognition.start();
    } catch {
      // Still stopping: onend starts it again.
    }
  }

  send(_pcm: ArrayBuffer, _commit = false) {}

  async finish() {
    if (!this.active) return;
    this.active = listening = false;
    window.removeEventListener("bestie-mic", this.onMic);
    this.recognition.stop();
  }
}

export const ScribeSession = useBrowser ? BrowserSpeech : Elevenlabs;
