# Decyzje

| Decyzja | Powód | Skutek |
|---|---|---|
| Bez kluczy API | Testy na API kosztowały około 2 dolarów jednego wieczoru | Klucze usunięte z `.env`, Claude działa przez logowanie |
| Praca lokalnie | Aplikacja potrzebuje logowania `claude` i Chrome na tym komputerze | Nie ma publicznego adresu |
| Bez deployu na Vercel | Vercel nie ma tego logowania, a bez kluczy AI by tam nie ruszyło | Aplikacja działa tylko na tym komputerze |
| Bez publicznego tunelu | Mostek nie ma blokady, więc każdy z adresem mógłby używać Twojego Claude | Zespół nie wejdzie z własnych komputerów |
| Interfejs zespołu zamiast własnego pokoju | Chciałeś mieć to, co oni | `web/` odłożony na `web-room` |
| Bez bota Recall | Wymaga kluczy Recall i ElevenLabs | Na Meecie można tylko samemu udostępnić kartę, a tablica słyszy wtedy tylko Twój mikrofon |
| Praca na swoim forku | Nie chcieliśmy zmieniać produkcji | PR #1 zamknięty, wypychanie do repo zespołu zablokowane |
| Bez Groka | W teście był wolniejszy: 90 s na kartę, a Sonnet około 14–36 s | Zainstalowany i zalogowany, ale niepodpięty |
| Sonnet do rysowania | Opus dawał pierwszą treść po około 43 s, Sonnet po 13 s | Szybciej, choć nadal nie sekundy |
| Zdjęcia z Pinteresta przez Chrome | Pinterest odrzuca zwykłe zapytania, a Bing z filtrem zwracał śmieci | Prawdziwe wyszukiwanie, 5–7 s, bez konta |
| Warianty agentów wyłączone | Kosztują czas i limit, a nie było ich w potrzebach | Można włączyć przełącznikiem „Eksploracja” |

## Dlaczego zespół ma sekundy, a my nie

Ich wersja używa API z płatnym trybem fast i stałym połączeniem. U nas każde wywołanie to nowy proces `claude`, bez trybu fast. Na logowaniu sekund nie osiągniemy. Karta powstaje w około 15 s.
