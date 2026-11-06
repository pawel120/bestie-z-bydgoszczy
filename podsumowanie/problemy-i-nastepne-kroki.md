# Problemy i następne kroki

## Do zrobienia od razu

1. **Commit.** 11 plików jest niezapisanych. Dodawaj je po nazwie, bez `git add .`.
2. **Unieważnienie kluczy.** Klucze API trafiły do logu sesji i są nadal aktywne.

## Znane ograniczenia

- **Nie ma sekund.** Karta to około 15 s, research około 30 s.
- **Limit Pro.** 11-minutowy test zużył 85 wywołań. Gdy na tablicy są zdjęcia, każde zdanie przechodzi dodatkowe sprawdzenie.
- **Pamięć komputera.** System dwa razy zatrzymał serwer przy braku pamięci. Zrzuty stron i Pinterest uruchamiają dodatkowe okna Chrome.
- **Transkrypt nie zapisuje się sam.** Jest tylko w otwartej karcie. Pobierzesz go ikoną folderu, a po odświeżeniu przepada.
- **Zdjęcia nie są na pewno prawdziwe.** Na Pintereście też są obrazy z AI, a strona wyników ich nie oznacza.
- **Wybór zdjęcia tylko numerem.** „To z różowym bratkiem” nie zadziała, bo model nie widzi obrazków.
- **Zrzuty, nie przeglądarka na żywo.** Nie widać przewijania ani klikania. Część zrzutów zasłaniają okna cookies i logowania.
- **Research nie zawsze czyta stronę, którą pokazuje.** Strony blokujące roboty dają tylko dane z wyszukiwarki.
- **Mowa z przeglądarki.** Po polsku działa słabiej niż ElevenLabs i słyszy tylko Twój mikrofon.
- **Mostek nie ma ochrony.** Nie wystawiaj portu 4310 do internetu. Inna strona otwarta w tej przeglądarce też mogłaby teoretycznie wysłać do niego zapytanie, więc przed szerszym użyciem warto dodać token.

## Nieprzetestowane

- Polecenia „pokaż kartę 2”, „zrób z trzeciego grafikę” i „zmień burgera na prawdziwego z pinteresta”.
- Kamera, zwykły tekst, zdjęcia i zrzuty stron na prawdziwym głosie. Testy szły na udawanej mowie, a prawdziwą mowę sprawdziłeś w wersji wcześniejszej.
- Przycisk wyciszania na prawdziwym mikrofonie.
- Aplikacja desktopowa Electron po tych zmianach. Nie mam jej zainstalowanej na tym komputerze.

## Propozycja kolejności

1. Zapis transkryptu na dysk, żeby nic nie przepadało.
2. Test wszystkich funkcji głosem, według listy z `co-zrobilismy.md`.
3. Prostszy ekran z pomysłami po kolei. To powtarzająca się uwaga z sesji w pokoju: „żeby pokazywało się po kolei rzeczy”.
4. Token w mostku, jeśli ktoś oprócz Ciebie ma z tego korzystać.
5. Pasek postępu przy rysowaniu, tak jak przy wyszukiwaniu.

## Co mogłoby wrócić

- **Bot na Google Meet:** wymaga kluczy Recall i ElevenLabs oraz publicznej strony.
- **Sekundy zamiast 15 s:** wymaga API z trybem fast.
- **Grok:** zablokowany dostęp działał w teście, gdy zostawiliśmy tylko wyszukiwanie, ale był za wolny.
