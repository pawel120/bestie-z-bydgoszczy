# Bestie Room

Demo: wspólny pokój w przeglądarce. Każdy mówi przez własny mikrofon, a wszyscy widzą tę samą rozmowę i to samo płótno.

## Uruchomienie

```bash
node web/server.mjs
```

Serwer wypisze link do pokoju. Otwórz go w Chrome lub Edge. Kolejne osoby używają tego samego linku.

Serwer nasłuchuje tylko na tym komputerze. Żeby wpuścić inne osoby, wystaw go przez tunel HTTPS, który przepuszcza Server-Sent Events. Cloudflare Quick Tunnels ich nie obsługują, więc `cloudflared tunnel --url` nie zadziała. Mikrofon w przeglądarce wymaga HTTPS albo `localhost`, więc zwykły adres w sieci lokalnej nie wystarczy.

Limit wydatków (`BUDGET_USD`, domyślnie 5) liczy się od startu serwera, więc restart zeruje licznik. Restart czyści też pokój: transkrypt i karty zostają tylko w plikach sesji.

## Google Meet

Bota wysyła `recall/bot.mjs` (potrzebny `RECALL_API_KEY`). Pokój musi mieć publiczny adres HTTPS przez tunel obsługujący SSE. Końcówka `&x=` jest potrzebna, bo bot dokleja do adresu `/#c=...`:

```bash
cd recall && npm run bot -- https://meet.google.com/abc-defg-hij --url "https://publiczny-adres/?room=KLUCZ&bot=1&x="
```

## Test bez mikrofonu

```bash
node web/replay.mjs timeline/data/transcript.txt 1000 20
```

## API dla sesji Claude

Każde zapytanie wymaga nagłówka `x-room: <klucz z web/.room>`.

- `GET /api/lines?since=N&wait=50`: nowe wypowiedzi i metadane kart. Czeka do 50 s, gdy nic nowego nie ma.
- `POST /api/card`: tworzy lub aktualizuje element tablicy. Pola: `id`, `thread`, `threadTitle`, `kind`, `title`, `body`, `src`, `caption`, `summary`, `quote`, `at`, `from`, `with`, `status`, `html`. Bez `src` i `html` element jest samym napisem.
- `POST /api/clear`: czyści płótno i archiwizuje karty.

Tablica domyślnie pokazuje napisy i luźne obrazki. Makieta HTML powstaje tylko na wyraźną prośbę i działa w izolowanej ramce. Dwuklik włącza klikanie po makiecie, a kliknięcie obok niej wraca do płótna.

Sesje zapisują się w `web/sessions/`: transkrypt i karty, bez dźwięku. Testy powinny ustawiać `SESSIONS_DIR` na inny folder, żeby nie mieszać się z prawdziwymi sesjami.
