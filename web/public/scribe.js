// ElevenLabs Scribe v2 Realtime over WebSocket: 16 kHz mono Int16 PCM in, partial and final text out.
const ENDPOINT = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";
const IGNORED = new Set(["session_started", "insufficient_audio_activity"]);

function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export class ScribeSession {
  socket = null;
  active = false;
  queue = [];

  constructor(getToken, languageCode, onEvent) {
    this.getToken = getToken;
    this.languageCode = languageCode;
    this.onEvent = onEvent;
  }

  async connect() {
    this.active = true;
    await this.open();
  }

  send(pcm) {
    const message = JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: toBase64(new Uint8Array(pcm)), commit: false, sample_rate: 16_000 });
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(message);
    else if (this.queue.length < 50) this.queue.push(message); // ~5 s, buffered while reconnecting
  }

  close() {
    this.active = false;
    this.socket?.close();
    this.socket = null;
  }

  async open() {
    let token;
    try {
      token = await this.getToken();
    } catch (err) {
      this.active = false;
      this.onEvent({ type: "error", message: err.message });
      return;
    }
    const params = new URLSearchParams({ model_id: "scribe_v2_realtime", audio_format: "pcm_16000", commit_strategy: "vad", vad_silence_threshold_secs: "0.5", token });
    if (this.languageCode) params.set("language_code", this.languageCode);
    const socket = new WebSocket(`${ENDPOINT}?${params}`);
    this.socket = socket;
    socket.onopen = () => {
      for (const message of this.queue.splice(0)) socket.send(message);
    };
    socket.onmessage = (event) => this.handle(String(event.data));
    socket.onclose = () => {
      if (!this.active || this.socket !== socket) return;
      this.socket = null;
      setTimeout(() => this.active && this.open(), 1000);
    };
  }

  handle(raw) {
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    const type = data.message_type ?? "";
    if (IGNORED.has(type)) return;
    if (type === "partial_transcript") this.onEvent({ type: "partial", text: data.text ?? "" });
    else if (type === "committed_transcript") {
      const text = (data.text ?? "").trim();
      if (text) this.onEvent({ type: "committed", text });
    } else this.onEvent({ type: "error", message: data.error ?? data.message ?? type });
  }
}
