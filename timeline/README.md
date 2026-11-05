# Timeline

Demo: brainstorm zamieniony w **kanwę makiet z łańcuchem przyczynowo-skutkowym**. Przewijasz oś czasu rozmowy, a na kanwie pojawiają się kolejne ekrany produktu — każdy wynika z tego, co padło wcześniej, i z kontry, która zmieniła kierunek.

Materiałem źródłowym jest 27-minutowa notatka głosowa z Discorda (`data/transcript.txt`).

## Uruchomienie

```bash
npm install
npm run dev
```

Bez klucza API. Dane (`src/data/board.json`) są wygenerowane i wchodzą do builda jako plik — aplikacja nie robi w runtime żadnego zapytania sieciowego.

## Jak to jest zbudowane

- **Idee** — 37 myśli wyciągniętych z transkryptu, każda z czasem i dosłownym cytatem. Zbierają się w lewym panelu w trakcie odtwarzania.
- **Makiety** — pięć, nie jedna na myśl. Każda scala kilka idei w jeden ekran produktu: spotkanie na żywo, kanwa wariantów, walidacja hordą, replay sesji, wyniki kampanii. To zwykły HTML ze wspólną nawigacją, więc wyglądają jak pięć widoków tej samej aplikacji.
- **Zwroty akcji** — cztery momenty, w których rozmowa zmieniła kierunek (kontra o Lovable, decyzja o prędkości, rozróżnienie bugów od value, bitter lesson). Siedzą nad głównym pasmem i łączą makiety strzałkami z podpisem.
- **Oś czasu** — prążki to pojedyncze idee, kafelki `v1`–`v5` to momenty, w których powstała makieta. Klik przeskakuje do tego miejsca; spacja i strzałki też działają.

Podwójny klik albo „Otwórz" na karcie pokazuje makietę w pełnym rozmiarze razem z cytatami, z których powstała.

## Regeneracja z innego nagrania

```bash
npm run extract                      # tryb offline: odgrywa gotowy wynik, nic nie woła
OPENAI_API_KEY=... npm run extract   # realna ekstrakcja modelem
```

Podmień `data/transcript.txt` (format `[MM:SS] Mówca: tekst`) albo wskaż plik przez `TRANSCRIPT=...`.

## Struktura

```
data/transcript.txt      źródłowy transkrypt
scripts/extract.mjs      transkrypt → idee i makiety
src/data/board.json      idee, makiety, krawędzie przyczynowo-skutkowe
src/components/mocks.tsx pięć ekranów produktu
src/components/Canvas.tsx kanwa z pan/zoom i kamerą jadącą za rozmową
```
