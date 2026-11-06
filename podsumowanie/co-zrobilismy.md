# Co zrobiliśmy

Wszystko poniżej działa w wersji lokalnej na gałęzi `bestie-meet`.

## Praca bez kluczy API

- `recall/local.mjs` serwuje stronę i odpowiada na zapytania aplikacji jak API Claude. Każde zapytanie uruchamia `claude -p` na Twoim logowaniu.
- Rysowanie idzie domyślnie na Sonnecie, a zadania też na Sonnecie. Model rysowania zmienia `BESTIE_DRAW_MODEL`.
- Karty rysują się na żywo, zamiast pojawiać się dopiero na końcu.
- Mowę rozpoznaje przeglądarka, więc ElevenLabs nie jest potrzebny.

## Interfejs

- Wersja zespołu, z transkryptem z boku.
- „AI na żywo” włącza się samo, a warianty agentów są domyślnie wyłączone.
- Przycisk „Wycisz mikrofon” zatrzymuje tylko mikrofon, a nagrywanie i tablica działają dalej.
- Strona mówi, na co czeka przy starcie, i pokazuje błąd, zamiast wisieć na „Uruchamiam…”.

## Polecenia głosowe

| Co mówisz | Co się dzieje |
|---|---|
| „Napisz Siema” | Sam napis na tablicy, bez karty |
| „Sprawdź w internecie konkurencję” | Research z krokami na żywo, wynikami i zrzutami stron |
| „Znajdź na pintereście zdjęcia burgera” | 4 ponumerowane zdjęcia w rzędzie |
| „Weź trzecie zdjęcie” | Dokładnie to zdjęcie trafia do strony |
| „Włącz subway surfera z boku” | Film z YouTube w rogu ekranu, wyciszony |
| „Wyłącz ten film” | Film znika |
| „Przybliż”, „oddal”, „pokaż całość” | Zmiana widoku |
| „Pokaż kartę 2” | Przejście do karty (nietestowane) |

## Kamera

Włączona jest kamera zespołu z `recall/src/handsfree.ts`. Sama jedzie do nowej lub edytowanej karty i pokazuje ją w czytelnym powiększeniu.

## Co dodaliśmy w kodzie

- `src/internet.ts`: rozpoznawanie poleceń, research, zdjęcia i film.
- `recall/local.mjs`: mostek do `claude`, wyszukiwanie na Pintereście i zrzuty stron przez Chrome.
- `recall/src/browser-scribe.ts`: rozpoznawanie mowy z przeglądarki zamiast ElevenLabs.
- `src/renderer/board.mts`: wykonywanie poleceń na tablicy.

## Poprawki błędów zespołu

- Budowanie `recall` nie działało na Windowsie, bo ścieżki miały ukośniki w różne strony.
- Strona dla Meeta padała przy starcie, bo po wycofaniu commita zabrakło `onHordaEvent`.

Te poprawki są tylko u nas. Zespół ich nie ma.

## Wersja odłożona

Własny pokój z `web/` jest zachowany na gałęzi `web-room`. Ma wspólną rozmowę kilku osób, napisy zamiast slajdów i podgląd przez Chrome. Odłożyliśmy go na rzecz interfejsu zespołu.
