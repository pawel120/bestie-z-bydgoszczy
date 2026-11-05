# bestie-z-bydgoszczy

**Bestie** records meetings locally (your microphone plus system audio) and transcribes them live with ElevenLabs Scribe v2 Realtime. Next to the transcript is a **live whiteboard**: while you talk, AI on Groq draws mockups, user flows and idea cards and updates them as the discussion moves on.

It runs on macOS and Linux (Electron + TypeScript).

## Setup

```bash
npm install
cp .env.example .env   # fill in ELEVENLABS_API_KEY and GROQ_API_KEY
```

If `node_modules/electron/dist` is missing after `npm install`, run `node node_modules/electron/install.js`.

You can also paste the keys in the app (⚙︎). They are encrypted through Keychain / libsecret.

## Running

| | |
|---|---|
| macOS (dev) | `npm run dev:mac`: launches Electron so macOS gives it the system-audio permission |
| Linux (dev) | `npm start` |
| macOS build | `npm run dist:mac` → `release/mac-arm64/Bestie.app` |
| Linux build | `npm run dist:linux` → AppImage |

System audio:
- **macOS 14.2+**: a Core Audio tap. The first time, macOS asks for the "System Audio Recording" permission.
- **Linux**: the PulseAudio/PipeWire "Monitor of …" input device.

If system audio is unavailable, the app records the microphone only.

## How it works

- Mic and system audio each get their own Scribe session, so the transcript labels speakers as **"Ja"** (you) and **"Rozmówcy"** (everyone else).
- Whiteboard (`src/board.ts`): after every ~2 new utterances (or after 12 s), a planner (`openai/gpt-oss-120b`) decides which cards to add, change or remove. Each changed card is then drawn by a separate, parallel call that returns a self-contained HTML card (960×600). It renders in a sandboxed iframe with no scripts. You can swap the designer model with `BESTIE_DESIGNER_MODEL` (for example `qwen/qwen3.8-27b`).
- **"Wczytaj transkrypt"** replays a `[mm:ss] Speaker: text` file at ~20× speed. Use it to demo or backtest the whiteboard without recording.

Each meeting is saved in `~/Documents/Bestie/<date time>/`:

- `transkrypcja.md`: transcript, written live
- `spotkanie.webm`: mic + system audio mixed together
- `tablica.html` / `tablica.json`: the final whiteboard

Use headphones, otherwise the mic picks up the speakers and other people's speech shows up twice.
