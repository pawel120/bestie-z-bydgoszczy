# bestie-z-bydgoszczy

**Bestie**: a macOS app that records meetings locally (your microphone plus system audio) and transcribes them live with ElevenLabs Scribe v2 Realtime.

## Build and run

```bash
./scripts/build-app.sh
open build/Bestie.app
```

Requires macOS 15+ and Xcode. Paste your ElevenLabs API key in Settings (⌘,), or set `ELEVENLABS_API_KEY`.

On first recording macOS asks for **Microphone** and **Screen & System Audio Recording** permissions (the latter is needed for system audio; restart the app after granting it).

## Output

Each meeting is saved in `~/Documents/Bestie/<date time>/`:

- `transkrypcja.md`: transcript, written live as segments are committed
- `mikrofon.m4a` / `system.m4a`: the two sources separately
- `spotkanie.m4a`: both mixed together

The mic and system audio go to separate Scribe sessions, so the transcript labels speakers as "Ja" (you) and "Rozmówcy" (everyone else). Use headphones, otherwise the mic picks up the speakers and other people's speech shows up twice.
