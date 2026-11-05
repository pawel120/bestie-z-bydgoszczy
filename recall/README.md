# Bestie · Meet (Recall.ai)

The desktop Bestie app, 1:1, running **inside a Recall.ai bot** in Google Meet. The bot opens this page in its own
browser and screen-shares it into the call, so everyone sees the live transcript and the whiteboard. The page does
everything itself: it listens to the meeting, transcribes with ElevenLabs and draws with Jev / Groq / Claude straight
from the browser. No server and no tunnel to the app.

This folder contains no copy of the app: Vite builds the desktop sources (`../src/renderer`, `../src/board.ts`)
for the browser, so every change in the desktop app reaches this version after `npm run build`. Only Electron is swapped out:

| File | Role |
|---|---|
| `src/handsfree.ts` | hands-free camera in the bot: zooms to the card being discussed / drawn / edited |
| `src/web-main.ts` | `window.bestie` (the desktop preload API) in the browser; in the bot: meeting audio as "Rozmówcy", auto-start |
| `src/tailwind.ts`, `src/anthropic-browser.ts` | browser versions of the engine's Node-only imports |
| `vite.config.ts` | builds the desktop `index.html` / styles / worklet, redirects those imports |
| `bot.mjs` | sends the bot into a Meet (Recall API, outbound only) |

## Run

```bash
cd recall
npm install
npm run build && npm run preview        # page at http://127.0.0.1:4173
```

The page has to be reachable from the internet. For example, host `dist/` on GitHub Pages, Vercel or Netlify, or
run `cloudflared tunnel --url http://127.0.0.1:4173` for a quick test. Then:

```bash
npm run bot -- https://meet.google.com/abc-defg-hij --url https://ADRES-STRONY
```

Let "Bestie" in from the waiting room. Recording starts on its own. Ctrl+C makes the bot leave
(or `npm run bot -- --leave <id>`).

Keys come from `recall/.env` or `../.env` (`RECALL_API_KEY`, `RECALL_REGION`, `ELEVENLABS_API_KEY`, `GROQ_API_KEY`,
`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`) and reach the page in the URL fragment (`#c=…`). The page host never
sees them, but Recall does (it stores the URL).

To test in your own browser: `npm run dev` and open the address from `npm run bot -- --local`. Your microphone is
"Ja"; for "Rozmówcy", share the Meet tab with audio.

## Differences from the desktop

- Everyone in the meeting is "Rozmówcy": the bot hears the meeting mixed together.
- The base product (screenshot of another site) works only on the desktop.
- The folder button downloads `transkrypcja.md` and `tablica.json`. The recording stays at Recall.
