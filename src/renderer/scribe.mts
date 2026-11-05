// ElevenLabs Scribe v2 Realtime over WebSocket. Audio in: 16 kHz mono Int16 PCM; server-side VAD commits segments.

export type ScribeEvent =
  | { type: "partial"; text: string }
  | { type: "committed"; text: string }
  | { type: "error"; message: string };

const ENDPOINT = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const IGNORED = new Set(["session_started", "insufficient_audio_activity"]);

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export class ScribeSession {
  private socket: WebSocket | null = null;
  private active = false;
  private queue: string[] = [];

  constructor(
    private getToken: () => Promise<string>,
    private languageCode: string | null,
    private onEvent: (event: ScribeEvent) => void,
  ) {}

  async connect() {
    this.active = true;
    await this.open();
  }

  send(pcm: ArrayBuffer, commit = false) {
    const message = JSON.stringify({
      message_type: "input_audio_chunk",
      audio_base_64: toBase64(new Uint8Array(pcm)),
      commit,
      sample_rate: 16_000,
    });
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(message);
    else this.queue.push(message); // buffered while (re)connecting
  }

  /** Forces a final commit and waits briefly for the last transcript before closing. */
  async finish() {
    this.send(new ArrayBuffer(0), true);
    await new Promise((r) => setTimeout(r, 2000));
    this.active = false;
    this.socket?.close();
    this.socket = null;
  }

  private async open() {
    let token: string;
    try {
      token = await this.getToken();
    } catch (err) {
      this.onEvent({ type: "error", message: String(err) });
      this.active = false;
      return;
    }

    const params = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      audio_format: "pcm_16000",
      commit_strategy: "vad",
      // Commit after a short pause so lines land quickly; partials cover the rest.
      vad_silence_threshold_secs: "0.5",
      token,
    });
    if (this.languageCode) params.set("language_code", this.languageCode);

    const socket = new WebSocket(`${ENDPOINT}?${params}`);
    this.socket = socket;

    socket.onopen = () => {
      for (const message of this.queue.splice(0)) socket.send(message);
    };
    socket.onmessage = (event) => this.handle(String(event.data));
    socket.onclose = () => {
      if (!this.active || this.socket !== socket) return;
      this.onEvent({ type: "error", message: "Połączenie z ElevenLabs zerwane, łączę ponownie…" });
      this.socket = null;
      setTimeout(() => this.active && this.open(), 1000);
    };
  }

  private handle(raw: string) {
    let data: { message_type?: string; text?: string; error?: string; message?: string };
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const type = data.message_type ?? "";
    if (IGNORED.has(type)) return;
    if (type === "partial_transcript") {
      this.onEvent({ type: "partial", text: data.text ?? "" });
    } else if (type === "committed_transcript") {
      const text = (data.text ?? "").trim();
      if (text) this.onEvent({ type: "committed", text });
    } else {
      this.onEvent({ type: "error", message: `${type}: ${data.error ?? data.message ?? raw}` });
    }
  }
}
