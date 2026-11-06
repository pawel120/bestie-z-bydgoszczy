# Bestie: podsumowanie prac (5–6 listopada 2026)

Bestie to tablica, która słucha rozmowy i na bieżąco pokazuje pomysły. Działa teraz lokalnie: wersja zespołu z dodanym internetem, na logowaniu Claude, bez kluczy API.

## Uruchomienie

Stron nie trzeba budować od nowa, o ile `recall/dist` istnieje. W folderze projektu:

```
node recall/local.mjs
```

Potem otwórz w Chrome `http://localhost:4310/`. Wymaga zalogowanego `claude`. Po zmianach w kodzie strony trzeba ją przebudować:

```
cd recall
npx vite build
```

## Co jest w tym folderze

| Plik | Zawartość |
|---|---|
| `co-zrobilismy.md` | Co działa i co pozwala zrobić |
| `decyzje.md` | Dlaczego jest tak, a nie inaczej |
| `problemy-i-nastepne-kroki.md` | Co nie działa, ryzyka i kolejność dalszych prac |
| `uwagi-z-testu.md` | Co nie pasowało w 11-minutowym teście |
| `transkrypcja-2026-11-06.md` | Pełny transkrypt tego testu |

## Stan na koniec

- **Gałąź robocza:** `bestie-meet`, lokalnie. Ostatni commit to `f91f704`.
- **Niezapisane w gicie:** 11 zmienionych plików, w tym rysowanie na żywo, numerowane zdjęcia, kamera i zrzuty stron. Do tego nieśledzony folder `web/`.
- **GitHub:** nic z `bestie-meet` nie jest wypchnięte. Repo zespołu jest nietknięte, a PR #1 jest zamknięty i nie został scalony.
- **Twój fork:** https://github.com/pawel120/bestie-z-bydgoszczy
- **Klucze:** usunięte z `.env`, ale nadal aktywne u dostawców.

## Najpierw zrób

1. Zapisz pracę commitem, dodając pliki po nazwie. Nie używaj `git add .`, bo `web/` zawiera `.room` i transkrypty sesji, a na tej gałęzi `.gitignore` ich nie wyklucza.
2. Unieważnij klucze Anthropic, ElevenLabs, Groq i OpenRouter w panelach dostawców. Trafiły do logu sesji.
