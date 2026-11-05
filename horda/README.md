# Horda 🐝

**Problem:** po każdej zmianie landingu czy onboardingu na feedback od użytkowników czeka się dni albo tygodnie
(A/B test na prawdziwym ruchu potrzebuje setek–tysięcy wizyt, żeby cokolwiek wykazać).

**Horda:** wypuszczasz na swoją stronę (albo na dwa warianty naraz) kilkanaście person-agentów. Każdy dostaje prawdziwą
przeglądarkę (Playwright), czyta stronę, klika, wypełnia formularze i odchodzi wtedy, kiedy odszedłby człowiek.
Po około minucie masz:

- **lejek** (ile osób doszło do którego kroku) dla A i B obok siebie,
- **gdzie i dlaczego odpadają** (kategorie powodów + cytaty z „ankiety wyjścia”),
- **konwersję z przedziałem ufności** i **test istotności** różnicy A vs B,
- **podsumowanie analityka** z 3 problemami i 3 zmianami do przetestowania,
- **koszt przebiegu** (zwykle ułamek centa) i podgląd na żywo, co widzi i myśli każdy agent.

## Uruchomienie

```bash
cd horda
npm install
npx playwright install chromium   # albo pomiń: użyje zainstalowanego Chrome
cp .env.example .env              # wpisz OPENROUTER_API_KEY
npm start                         # http://localhost:3333
```

Domyślnie panel ma wpisane dwa warianty demo (`/demo/a/` i `/demo/b/`) fikcyjnej apki do faktur „Fakturix”
i cel „URL zawiera `sukces`”. Można wpisać dowolny URL (np. apki innych drużyn z hackathonu).

Model: `typesafe/jev-router` (Jev Router, działa na `~typesafe/jev-latest`; sam `jev-latest` to model „decisions” i nie
obsługuje `/chat/completions`) przez OpenRouter, z automatycznym przełączeniem na `x-ai/grok-4-fast` i
`openai/gpt-oss-120b` przy błędzie (`HORDE_MODELS` w `.env`). Twardy limit wydatków na przebieg: `HORDE_BUDGET_USD`.
Każdy przebieg zapisuje się do `runs/` (poza gitem).

## Dlaczego to nie jest „LLM zgaduje”

1. **Persony nie są wymyślane przez model.** Modele zbiegają do mediany, więc persony „z LLM” są do siebie podobne.
   Cechy zachowania losujemy z rozkładów z badań (seedowany RNG):
   - główna obawa przy zakupie: rozkład powodów porzucania checkoutu z badania Baymard Institute
     (dodatkowe koszty 48%, wymuszone konto 26%, brak zaufania 25%, za długi proces 22%, brak pełnej ceny 21%…)
     – https://baymard.com/lists/cart-abandonment-rate
   - sposób czytania: 79% użytkowników skanuje, 16% czyta słowo po słowie – Nielsen (1997),
     https://www.nngroup.com/articles/how-users-read-on-the-web/
   - szybkie odchodzenie, gdy wartość jest niejasna (pierwsze 10–20 s decydują) – Nielsen (2011),
     https://www.nngroup.com/articles/how-long-do-users-stay-on-web-pages/
   - urządzenie: ok. 60% ruchu webowego to mobile – StatCounter, https://gs.statcounter.com/platform-market-share/desktop-mobile-tablet
   - rola/sytuacja: z opisu grupy docelowej (jedno wywołanie LLM) albo z listy domyślnej.
2. **Projekt sparowany.** Te same persony przechodzą przez A i B, więc porównujemy pary, a nie dwie losowe grupy.
   Różnicę testujemy **dokładnym testem McNemara** (liczy się tylko, kto konwertuje na jednym wariancie, a na drugim nie).
   Konwersje mają **przedział Wilsona 95%**, który zachowuje się dobrze przy małych próbach.
3. **Prawdziwa przeglądarka, prawdziwe ekrany.** Mobile dostaje viewport 390 px i dotyk, więc banner cookies
   zasłaniający pół ekranu albo 10-polowy formularz naprawdę przeszkadza.

## Ograniczenia (uczciwie)

To symulacja. Badania nad „silicon samples” pokazują, że LLM-y dobrze odtwarzają *kierunek* zachowań grup
(Argyle i in. 2023, *Out of One, Many*, Political Analysis, https://doi.org/10.1017/pan.2023.2), ale gorzej ich
wariancję i dokładne liczby. Horda jest więc szybkim filtrem hipotez („który wariant ma oczywisty problem i gdzie”)
przed testem na prawdziwym ruchu, a nie jego zamiennikiem. Procenty konwersji z hordy nie są prognozą prawdziwej konwersji.

## Struktura

- `server.js` – serwer HTTP, SSE z podglądem na żywo, orkiestracja przebiegu
- `lib/agent.js` – pętla agenta: ekstrakcja elementów strony → decyzja LLM (JSON) → akcje Playwright
- `lib/personas.js` – generator person z rozkładów z badań
- `lib/stats.js` – lejek, Wilson, McNemar
- `lib/llm.js` – klient OpenRouter z licznikiem kosztu i limitem budżetu
- `public/index.html` – panel
- `demo-site/a`, `demo-site/b` – dwa warianty demo landingu
