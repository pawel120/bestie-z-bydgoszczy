import type { BestieApi } from "../preload.js";
import { Whiteboard } from "./board.mjs";
import { ScribeSession, type ScribeEvent } from "./scribe.mjs";

declare global {
  interface Window {
    bestie: BestieApi;
  }
}

/** "Ja" (mic) / "Rozmówcy" (system audio) when recording; whatever the file says when replaying a transcript. */
type Speaker = string;
interface Segment {
  speaker: Speaker;
  offset: number;
  text: string;
}

const api = window.bestie;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const recordButton = $<HTMLButtonElement>("record");
const timerEl = $("timer");
const languageSelect = $<HTMLSelectElement>("language");
const transcriptEl = $("transcript");
const statusEl = $("status");
const settingsEl = $<HTMLDetailsElement>("settings");
const replayButton = $<HTMLButtonElement>("replay");
const replayInput = $<HTMLInputElement>("replay-file");
const boardToggle = $<HTMLInputElement>("board-enabled");

let state: "idle" | "starting" | "recording" | "stopping" | "replaying" = "idle";
let startedAt = 0;
let timer: number | undefined;
let audioContext: AudioContext | null = null;
let streams: MediaStream[] = [];
let recorder: MediaRecorder | null = null;
const sessions = new Map<Speaker, ScribeSession>();
const partials = new Map<Speaker, string>();
const segments: Segment[] = [];
const board = new Whiteboard(api, $("board"), $("board-status"), (message) => setStatus(message));

function format(seconds: number) {
  const s = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, "0");
  return s >= 3600 ? `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
}

function setStatus(message: string | null) {
  statusEl.textContent = message ?? "";
  statusEl.hidden = !message;
}

function setState(next: typeof state) {
  state = next;
  recordButton.disabled = next !== "idle" && next !== "recording";
  replayButton.disabled = next !== "idle" && next !== "replaying";
  replayButton.textContent = next === "replaying" ? "Zatrzymaj odtwarzanie" : "Wczytaj transkrypt";
  recordButton.classList.toggle("recording", next === "recording");
  recordButton.querySelector("span")!.textContent = {
    idle: "Nagrywaj",
    starting: "Uruchamiam…",
    recording: "Zatrzymaj",
    stopping: "Zapisuję…",
    replaying: "Nagrywaj",
  }[next];
  languageSelect.disabled = next !== "idle";
}

// MARK: - Transcript rendering

function renderTranscript() {
  transcriptEl.replaceChildren();
  if (segments.length === 0 && partials.size === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = state === "recording" ? "Słucham…" : "Naciśnij Nagrywaj (⌘R / Ctrl+R), aby rozpocząć.";
    transcriptEl.append(empty);
    return;
  }
  const elapsed = startedAt ? (Date.now() - startedAt) / 1000 : 0;
  for (const s of segments) transcriptEl.append(row(s.speaker, s.offset, s.text, false));
  for (const [speaker, text] of partials) if (text) transcriptEl.append(row(speaker, elapsed, text, true));
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function row(speaker: Speaker, offset: number, text: string, partial: boolean) {
  const el = document.createElement("div");
  el.className = `segment ${/^(ja|you|me)$/i.test(speaker) ? "me" : "others"}${partial ? " partial" : ""}`;
  const time = document.createElement("time");
  time.textContent = format(offset);
  const who = document.createElement("strong");
  who.textContent = speaker;
  const body = document.createElement("p");
  body.textContent = text;
  el.append(time, who, body);
  return el;
}

function addSegment(segment: Segment) {
  segments.push(segment);
  const line = `[${format(segment.offset)}] ${segment.speaker}: ${segment.text}`;
  if (state !== "replaying") api.appendTranscript(line + "\n");
  board.addLine(line);
}

function handle(speaker: Speaker, event: ScribeEvent) {
  if (event.type === "partial") {
    partials.set(speaker, event.text);
  } else if (event.type === "committed") {
    partials.delete(speaker);
    addSegment({ speaker, offset: (Date.now() - startedAt) / 1000, text: event.text });
  } else {
    setStatus(event.message);
  }
  renderTranscript();
}

// MARK: - Audio sources

async function systemAudioStream(): Promise<MediaStream> {
  if (api.platform === "linux") {
    // PulseAudio / PipeWire expose the speakers' output as a "Monitor of …" input device.
    const devices = await navigator.mediaDevices.enumerateDevices();
    const monitor = devices.find((d) => d.kind === "audioinput" && /monitor/i.test(d.label));
    if (!monitor) throw new Error("nie znaleziono urządzenia „Monitor of …” (PulseAudio/PipeWire)");
    return navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: monitor.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  }
  // macOS / Windows: the main process answers getDisplayMedia with the screen + system audio loopback.
  const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
  for (const track of stream.getVideoTracks()) {
    track.stop();
    stream.removeTrack(track);
  }
  if (stream.getAudioTracks().length === 0) throw new Error("brak ścieżki audio");
  return stream;
}

async function attach(stream: MediaStream, speaker: Speaker, ctx: AudioContext, mix: MediaStreamAudioDestinationNode) {
  const source = ctx.createMediaStreamSource(stream);
  const worklet = new AudioWorkletNode(ctx, "pcm-capture");
  const session = new ScribeSession(api.scribeToken, languageSelect.value === "auto" ? null : languageSelect.value, (e) =>
    handle(speaker, e),
  );
  sessions.set(speaker, session);
  worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => session.send(e.data);
  source.connect(worklet);
  source.connect(mix);
  await session.connect();
}

// MARK: - Start / stop

async function start() {
  const settings = await api.getSettings();
  if (!settings.hasElevenLabsKey) {
    settingsEl.open = true;
    setStatus("Wklej klucz API ElevenLabs w ustawieniach.");
    return;
  }
  setState("starting");
  setStatus(null);

  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    setState("idle");
    setStatus(`Brak dostępu do mikrofonu: ${err}`);
    return;
  }

  let system: MediaStream | null = null;
  try {
    system = await systemAudioStream();
  } catch (err) {
    setStatus(`Nagrywam tylko mikrofon — dźwięk systemu niedostępny (${err}).`);
  }

  await api.startSession();
  board.reset();
  segments.length = 0;
  partials.clear();
  startedAt = Date.now();
  streams = system ? [mic, system] : [mic];

  audioContext = new AudioContext({ sampleRate: 48_000 });
  await audioContext.audioWorklet.addModule("pcm-worklet.mjs");
  const mix = audioContext.createMediaStreamDestination();
  await attach(mic, "Ja", audioContext, mix);
  if (system) await attach(system, "Rozmówcy", audioContext, mix);

  recorder = new MediaRecorder(mix.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 96_000 });
  recorder.ondataavailable = async (e) => {
    if (e.data.size > 0) await api.appendAudio(await e.data.arrayBuffer());
  };
  recorder.start(1000);

  timer = window.setInterval(() => (timerEl.textContent = format((Date.now() - startedAt) / 1000)), 500);
  setState("recording");
  renderTranscript();
}

async function stop() {
  setState("stopping");
  setStatus("Kończę transkrypcję…");
  window.clearInterval(timer);

  const recorderStopped = new Promise<void>((resolve) => {
    if (!recorder || recorder.state === "inactive") return resolve();
    recorder.addEventListener("stop", () => setTimeout(resolve, 200), { once: true });
    recorder.stop();
  });
  await Promise.all([...sessions.values()].map((s) => s.finish()));
  await recorderStopped;

  for (const stream of streams) for (const track of stream.getTracks()) track.stop();
  await audioContext?.close();
  audioContext = null;
  recorder = null;
  sessions.clear();

  // A trailing partial would otherwise be lost.
  for (const [speaker, text] of partials) {
    if (text.trim()) addSegment({ speaker, offset: (Date.now() - startedAt) / 1000, text });
  }
  partials.clear();

  await board.flush();
  const folder = await api.finishSession();
  setState("idle");
  setStatus(folder ? `Zapisano w ${folder}` : null);
  renderTranscript();
}

// MARK: - Wiring

recordButton.addEventListener("click", () => {
  if (state === "idle") start().catch((err) => (setState("idle"), setStatus(String(err))));
  else if (state === "recording") stop();
});

window.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r") {
    e.preventDefault();
    recordButton.click();
  }
});

$("reveal").addEventListener("click", () => api.revealRecordings());
languageSelect.addEventListener("change", () => api.setLanguage(languageSelect.value));
$("save-keys").addEventListener("click", async () => {
  for (const name of ["elevenlabs", "groq"] as const) {
    const input = $<HTMLInputElement>(`key-${name}`);
    if (input.value.trim()) await api.setApiKey(name, input.value.trim());
    input.value = "";
  }
  await showKeyState();
  settingsEl.open = false;
  setStatus(null);
});

async function showKeyState() {
  const settings = await api.getSettings();
  languageSelect.value = settings.language;
  const saved = "Zapisano ✓ (wklej nowy, aby zmienić)";
  if (settings.hasElevenLabsKey) $<HTMLInputElement>("key-elevenlabs").placeholder = saved;
  if (settings.hasGroqKey) $<HTMLInputElement>("key-groq").placeholder = saved;
  boardToggle.checked = board.enabled = settings.hasGroqKey;
}

boardToggle.addEventListener("change", () => {
  board.enabled = boardToggle.checked;
  if (board.enabled) void board.flush();
});
$("board-refresh").addEventListener("click", () => void board.flush());

// MARK: - Replay a saved transcript (demo / backtesting without recording)

let replayAbort: AbortController | null = null;

function parseTranscript(text: string): Segment[] {
  const result: Segment[] = [];
  let base = 0;
  let last = 0;
  for (const raw of text.split("\n")) {
    const m = raw.match(/^\[(?:(\d+):)?(\d+):(\d+)\]\s*([^:]{1,40}):\s*(.+)$/);
    if (!m) continue;
    let offset = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    // A transcript stitched from several recordings restarts at 00:00.
    if (offset + base < last - 5) base = last;
    offset += base;
    last = offset;
    result.push({ speaker: m[4].trim(), offset, text: m[5].trim() });
  }
  return result;
}

async function replay(file: File) {
  const items = parseTranscript(await file.text());
  if (items.length === 0) return setStatus("Nie znalazłem linii w formacie „[mm:ss] Kto: tekst”.");
  replayAbort = new AbortController();
  const { signal } = replayAbort;
  setState("replaying");
  setStatus(`Odtwarzam ${file.name} (${items.length} wypowiedzi, przyspieszone)…`);
  board.reset();
  segments.length = 0;
  startedAt = Date.now();
  let previous = 0;
  for (const item of items) {
    if (signal.aborted) break;
    // ~20× faster than real time, but never more than 1.5 s between lines.
    await new Promise((r) => setTimeout(r, Math.min(1500, Math.max(150, ((item.offset - previous) * 1000) / 20))));
    previous = item.offset;
    timerEl.textContent = format(item.offset);
    addSegment(item);
    renderTranscript();
  }
  await board.flush();
  setState("idle");
  setStatus(signal.aborted ? "Odtwarzanie zatrzymane." : "Odtwarzanie zakończone.");
}

replayButton.addEventListener("click", () => {
  if (state === "replaying") replayAbort?.abort();
  else replayInput.click();
});
replayInput.addEventListener("change", () => {
  const file = replayInput.files?.[0];
  replayInput.value = "";
  if (file) replay(file).catch((err) => (setState("idle"), setStatus(String(err))));
});

await showKeyState();
setState("idle");
renderTranscript();
