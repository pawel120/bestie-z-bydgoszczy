# Thoughtline

Demo: nagranie z brainstormu zamienione w **mapę myśli osadzoną w czasie**. Przesuwasz oś czasu, a mapa rośnie dokładnie tak, jak rosła rozmowa — pomysł, kontra, decyzja, offtop.

Materiałem źródłowym jest 27-minutowa notatka głosowa z Discorda (`data/transcript.txt`): hackathonowa burza mózgów, z której wyszło 96 węzłów i 9 powiązań między wątkami, które wróciły później.

## Uruchomienie

```bash
npm install
npm run dev
```

Nie potrzebujesz żadnego klucza API. Mapa (`src/data/mindmap.json`) jest już wygenerowana i wchodzi do builda jako zwykły plik — aplikacja nie robi w runtime ani jednego zapytania sieciowego.

## Co widać

- **Mapa myśli** — promieniowe drzewo wokół tematu spotkania. Gałąź = wątek, kolor = rodzaj myśli. Węzeł zapala się w sekundzie, w której padł, i gaśnie po kilku sekundach do stanu spoczynku.
- **Oś czasu** — każdy pionowy prążek to jedna myśl, wysokość = jej waga. Można scrubować, puszczać 1×–30× albo sterować spacją i strzałkami.
- **Kamera** — `⌖ śledź` jedzie za tym, co właśnie powiedziano; `▦ całość` pokazuje kształt całej rozmowy.
- **Panel** — licznik pomysłów/kontr/decyzji/insightów na dany moment, feed „agent wyłapał", a po kliknięciu węzła: cytat, autor, rozwinięcia i wątki, które wróciły później (fioletowe cięciwy na mapie).

## Regeneracja mapy z innego transkryptu

```bash
npm run extract                      # tryb offline: odgrywa gotową mapę, nic nie woła
OPENAI_API_KEY=... npm run extract   # realna ekstrakcja modelem
LLM_API_KEY=... LLM_BASE_URL=https://api.cerebras.ai/v1 LLM_MODEL=llama-3.3-70b npm run extract
```

Skrypt tnie transkrypt na 5-minutowe fragmenty i przetwarza je po kolei, podając modelowi węzły z wcześniejszych fragmentów jako kontekst — dzięki temu potrafi podpiąć nową myśl pod wątek sprzed dziesięciu minut zamiast zakładać nową gałąź. Wynik nadpisuje `src/data/mindmap.json`.

Własne nagranie: podmień `data/transcript.txt` (format `[MM:SS] Mówca: tekst`) albo wskaż plik przez `TRANSCRIPT=...`.

## Struktura

```
data/transcript.txt      źródłowy transkrypt
scripts/extract.mjs      transkrypt → mapa myśli (LLM lub offline)
src/data/mindmap.json    wygenerowana mapa: węzły, czasy, cytaty, powiązania
src/lib/layout.ts        promieniowy layout drzewa
src/components/          mapa, oś czasu, transkrypt, panel szczegółów
```
