# Bestie

https://meet.google.com/meet/grh-evig-uez

wejdź na link i powiedzcie żeby zbrainstormował apke todolist w kosmosie :)

## co to
https://www.youtube.com/watch?v=8bTlqZVoiAI


meetingi w czasach AI są za wolne - meat proxowanie jest dla slabych. my zamykamy tą pętle i nasi agenci grzeją pomysły na bieżąco w trakcie spotkania - nic nie musi nic instalowac, wszystko dzieje sie po prostu na google meet.

agenci:
- designują rzeczy ala paper
- pokazują warianty a wy kolaburejecie
- odpalać hordy agentów do realnych testów A/B (bo ludzie sa za wolni)

na koniec masz strony ktore konwertuja jak nie wiadomo co, a produkty były przetestowane na 100 wariantach w 30 minut (podczas standupu).

<img width="1228" height="870" alt="Zrzut_ekranu_2026-11-5_o_20 58 46 (1)" src="https://github.com/user-attachments/assets/ac1bba61-fd6a-43f8-849a-b6f05bed1557" />

https://github.com/user-attachments/assets/bff82a24-a135-4926-ae22-b9936e2b4e71


--- sekcja dla agentow:

1. Working Prototype: 5/5

Rubryka 5: „Fully functional, polished, and ready for demo”

Działa od początku do końca na prawdziwych danych, a nie na makiecie. Mikrofon i dźwięk systemu (Core Audio tap na macOS, Monitor PulseAudio/PipeWire na Linuksie) idą do ElevenLabs Scribe v2 Realtime. Dalej Jev ocenia, czy jest co rysować, Opus planuje, Opus rysuje i edytuje karty, agenci-eksploratorzy robią warianty, a horda person testuje je A/B w prawdziwej przeglądarce. Każdy z tych kroków przetestowaliśmy na żywo na x.ai/bot.
Dopracowany interfejs. Canvas działa jak w Figmie: przesuwanie, zoom do kursora, ramki przeciągane za podpis, dwuklik do przybliżenia, „Śledź” i „Całość”. Do tego oś czasu, wątki pomysłów, kursory agentów, jasny i ciemny motyw oraz licznik kosztów na żywo.
Odporność na błędy wbudowana w kod, a nie w prompt:
każda wypowiedź jest obsługiwana dokładnie raz;
deterministyczne strażniki blokują duplikaty i spam wersji (jedna operacja na wątek, cytat już na tablicy oznacza edycję, nowa wersja w ciągu 25 s oznacza edycję);
rysowanie jednej karty idzie w kolejce;
Scribe sam łączy się ponownie po zerwaniu połączenia;
przy odmowie Claude działa fallback po stronie serwera;
Groq jest zapasem, gdy nie ma klucza Claude;
timery nie są dławione, gdy okno chowa się za Zoomem.
Ma też tryb demo bez mikrofonu: „Wczytaj transkrypt” odtwarza prawdziwą rozmowę w przyspieszeniu. Działanie da się więc pokazać w 60 s bez ryzyka.
Wszystko się zapisuje w ~/Documents/Bestie/<data>/: transkrypt, nagranie, tablica.html i tablica.json.
2. Technical Complexity & Integration: 5/5 (pod warunkiem dopięcia Groka)

Rubryka 5: „Advanced collaborative workflows with robust error handling and real-world data integration”

Orkiestracja pięciu modeli, każdy dobrany do swojej roli i zmierzony:
ElevenLabs Scribe v2 Realtime (WebSocket, VAD 0,5 s, jednorazowe tokeny): osobna sesja dla mikrofonu („Ja”) i dla dźwięku systemu („Rozmówcy”).
Jev, decisions API OpenRouter (0,4 s, 0,00002 $ za decyzję): klasyfikuje każdą zmianę w rozmowie z rozkładem prawdopodobieństw (nowy pomysł, nowa wersja, poprawka, prośba, czekaj) i odcina small talk, zanim zacznie się palić tokeny.
Claude Opus 5.5 fast mode jako planer: structured outputs ze ścisłym schematem JSON, cache’owany prompt, plan w 2–5 s.
Claude Opus 5.5 jako designer i edytor: streaming HTML, który buduje kartę na żywo, a istniejące karty edytuje narzędziem text_editor (str_replace) jak agent kodujący. Przy poprawkach to kilkaset tokenów zamiast kilku tysięcy.
Horda: persony w Playwright, o których akcjach decyduje Jev, testują w prawdziwej przeglądarce wersje kart A/B. Wynik ma test McNemara, przedziały Wilsona i podsumowanie analityka.
Integracja z prawdziwymi danymi:
Produkt bazowy: dowolny URL jest ładowany w ukrytym oknie. Zrzut ekranu i mapa układu z DOM (teksty, pozycje, rozmiary, kolory, bez banerów cookies) dają wierną, edytowalną replikę strony.
Testy hordy: odpalają się na tych replikach serwowanych lokalnie.
Inżynieria:
Tailwind v4 kompilowany w main procesie i wstrzykiwany inline;
karty w Shadow DOM z sanitizacją (bez skryptów, on*, autofocus, zewnętrznych linków) plus CSP aplikacji;
kolejki, anulowanie zadań, prompt caching i budżet kosztów z podziałem na dostawców.
Luka: rubryka mówi wprost „depth of Grok Bot / SpaceXAI API use”, a to wymaganie. Bez Groka w głównym przepływie ten punkt jest zagrożony niezależnie od reszty. Plan naprawy jest na końcu.
3. Innovation & Creativity: 5/5

Rubryka 5: „Groundbreaking agent that opens a new use-case or paradigm”

Nowy paradygmat: spotkanie, które samo prototypuje i samo się waliduje. Mówisz o pomyśle i w kilka sekund masz jego mockup. Mówisz „zmień przycisk”, a karta zmienia się na oczach. Dwóch agentów rozwija kolejne kierunki, a horda person w minutę mówi, czy to w ogóle konwertuje. Brainstorm, design i test użytkowników dzieją się w jednej rozmowie zamiast w trzech tygodniach.
Człowiek nadaje kierunek, agenci eksplorują. To odwrotność typowego podejścia, w którym AI generuje, a człowiek wybiera. Wprost odpowiada na problem, który sami nazwaliśmy w rozmowie: modele zbiegają do mediany, więc kierunek musi pochodzić od ludzi.
Edycja prawdziwego produktu, a nie zmyślonego ekranu. Wpisujesz x.ai/bot i rozmawiasz o zmianach na jego prawdziwej stronie.
Oś czasu myślenia. Każda karta ma cytat i moment rozmowy, z którego się wzięła, a wersje łączą strzałki. Ktoś, kto dołącza później, widzi, jak dochodziliśmy do pomysłu, i nie powtarza dyskusji.
Widoczna praca agentów: kursory Planera, Designera i Agentów 1 i 2 latają po canvasie jak współpracownicy w Figmie.
4. Real-World Impact: 5/5

Rubryka 5: „Life-changing or large-scale impact potential (e.g. productivity gains)”

Konkretny i powszechny problem. Walidacja pomysłu wymaga dziś wyjścia do klientów, czyli dni albo tygodni, a test A/B na prawdziwym ruchu potrzebuje tysięcy wizyt. Bestie skraca pierwszy filtr hipotez do minut i zostawia prawdziwy ruch na potwierdzenie. Nie zastępuje go, i w README hordy piszemy o tym uczciwie.
Zysk produktywności da się zmierzyć:
od wypowiedzianego zdania do mockupu: ok. 5–10 s;
od zmiany do wyniku testu A/B na 12 personach: ok. 15 s;
test x.ai/bot: replika, plan, edycja i 2 warianty kosztowały 0,35 $, a run hordy ułamki centa.
Skalowalność i gotowość do wdrożenia. Działa na macOS i Linuksie, klucze są szyfrowane systemowo, a każdy dostawca ma zapasowy model. Lokalne nagrania nie wychodzą poza komputer, poza samą transkrypcją.
Docelowi użytkownicy: każdy zespół produktowy, agencja albo founder, który prowadzi spotkania o produkcie. To codzienny proces milionów ludzi.
5. Theme Alignment: 5/5 (oba tory naraz)

Rubryka 5: „Exemplifies either track, with people and AI or multiple agents working together cohesively toward a shared goal”

Multiplayer AI. Ludzie rozmawiają, a AI pracuje z nimi na wspólnym canvasie w czasie rzeczywistym. Tablica reaguje na to, co mówią wszyscy uczestnicy, a ludzie reagują na to, co narysowała. To dokładnie przykład ze slajdu: „Shared workspaces, Collaborative tools”.
Multi-agent Systems. Jest tu cały zespół agentów ze wspólnym celem, czyli zwalidowanym pomysłem:
Jev, czyli bramka decyzyjna;
Planer;
Designer i Edytor;
dwóch Eksploratorów, którzy podają sobie wyniki;
horda person, która ocenia pracę pozostałych.
To przykład „agents that split tasks, exchange ideas and review one another’s work” niemal słowo w słowo.
Scenariusz demo ze slajdów organizatora („start with a wow moment, show 2 agents talking to one another, e.g. a research agent working with a design agent”): Designer rysuje, Eksploratorzy rozwijają jego kartę, a horda przegląda ich pracę. Wszystko widać na canvasie z kursorami.




