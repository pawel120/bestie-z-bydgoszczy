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
- Whiteboard (`src/board.ts`), with three steps on every change in the conversation:
  1. **Gate: Jev** (`typesafe/jev-1.14` via OpenRouter decisions, ~0.4 s, ~$0.00002). Classifies the new lines as a new idea, a new version, a small tweak or "wait". On "wait" nothing else runs.
  2. **Plan: Groq** `gpt-oss-120b` (~2 s). Turns that into `create` / `evolve` / `edit` operations on threads, with the quote and the moment it came from.
  3. **Draw: Claude Opus 5.5 in fast mode.** It writes a new card from scratch (the first version is very visual, minimal text). It edits existing ones with `str_replace`, like a coding agent, without rewriting them. Without `ANTHROPIC_API_KEY`, Groq does the drawing.
- The board is a **timeline** on a Figma-like canvas:
  - one lane per idea; versions run left to right and are joined by arrows;
  - above them is a time axis, and under each card the quote it came from;
  - nothing moves on its own: cards are only added at the end or edited in place.
- Canvas controls:
  - pan by scrolling or dragging the background, zoom with a pinch or ⌘+scroll;
  - move a frame by dragging its label, double-click to zoom in;
  - ⇧1 or "Całość" shows everything, and "Śledź" follows new cards.
- **Base product** (field next to "Tablica", e.g. `x.ai/bot`): the app loads the page in a hidden window, takes a screenshot and extracts its design system. The screenshot is the starting point of the timeline, and the cards are drawn in that product's style. Claude gets a small screenshot (~700 tokens) plus a short description, cached.
- **"Wczytaj transkrypt"** replays a `[mm:ss] Speaker: text` file at ~20× speed. Use it to demo or backtest the whiteboard without recording.

Each meeting is saved in `~/Documents/Bestie/<date time>/`:

- `transkrypcja.md`: transcript, written live
- `spotkanie.webm`: mic + system audio mixed together
- `tablica.html` / `tablica.json`: the final whiteboard

Use headphones, otherwise the mic picks up the speakers and other people's speech shows up twice.
