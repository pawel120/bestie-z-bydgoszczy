# bestie-z-bydgoszczy

**Bestie** records meetings locally (your microphone plus system audio) and transcribes them live with ElevenLabs Scribe v2 Realtime. Next to the transcript is a **live whiteboard**: a Figma-like canvas where AI draws mockups, user flows and idea cards while you talk, and updates them as the discussion moves on.

It runs on macOS and Linux (Electron + TypeScript).

## Setup

```bash
npm install
cp .env.example .env   # fill in ELEVENLABS_API_KEY, GROQ_API_KEY and optionally ANTHROPIC_API_KEY
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
- Whiteboard (`src/board.ts`):
  - It also sees what is being said right now (partials). A plan runs ~1.2 s after the last change in the conversation, and at least every 4 s while people keep talking.
  - The planner (Groq `gpt-oss-120b`, ~2 s) decides which cards to add, change or remove. A card shows up immediately as a frame with its title.
  - Each card's HTML streams into its frame. With `ANTHROPIC_API_KEY` set, Claude Opus 5.5 draws it in fast mode (~0.7 s to the first token, ~390 tok/s, much better design; roughly $0.15 per card). Without the key, the Groq model draws it (faster, weaker).
  - Cards are written in Tailwind (compiled in the main process) and rendered in Shadow DOM after removing scripts and `on*` handlers.
- The canvas works like Figma:
  - pan by scrolling or dragging the background, zoom with a pinch or ⌘+scroll;
  - move a frame by dragging its label, double-click to zoom into a frame;
  - ⇧1 or "Dopasuj" fits everything, and "Śledź" follows new frames.
- **"Wczytaj transkrypt"** replays a `[mm:ss] Speaker: text` file at ~20× speed. Use it to demo or backtest the whiteboard without recording.

Each meeting is saved in `~/Documents/Bestie/<date time>/`:

- `transkrypcja.md`: transcript, written live
- `spotkanie.webm`: mic + system audio mixed together
- `tablica.html` / `tablica.json`: the final whiteboard

Use headphones, otherwise the mic picks up the speakers and other people's speech shows up twice.
