# Horda na prawdziwych stronach: test terenowy (5.11.2026)

Ustawienia: mózg Jev (`~typesafe/jev-latest`, losowanie z rozkładu `p^1.5`), 6 person, seed 7 (chyba że napisano inaczej),
**tryb bezpieczny** (włącza się sam dla adresów spoza localhost albo przez `HORDE_SAFE=1`):

- brak `fill_form`, brak wpisywania/zaznaczania; przyciski w formularzach typu „wyślij / kup / zarejestruj / zaloguj” są niedostępne,
- wszystkie żądania inne niż GET są blokowane na poziomie przeglądarki (nic nie da się wysłać, kupić ani założyć),
- maks. 6 kroków na agenta, maks. 4 agentów naraz,
- cel = **intencja**: dojście do strony pasującej do regexu (signup, pricing, download, demo…). Agent kończy w chwili wejścia na nią,
- baner cookies: agent klika najbardziej prywatną opcję („Odrzuć wszystkie”, „Reject all”, „Tylko niezbędne”), także w ramkach CMP,
  a gdy jej nie ma, baner zostaje i persona radzi sobie z nim sama,
- blokada anty-bot (Cloudflare, DataDome/captcha, „Zostałeś zablokowany”) = wynik techniczny `zablokowane`, wyłączony z konwersji.
  Nie próbujemy jej obchodzić (bez podmiany user-agenta, bez rozwiązywania captchy).

Łączny koszt testu: ok. **$0.037** (9 przebiegów, 6–12 agentów każdy). Pojedynczy przebieg: $0.002–0.008, 10–23 s.

## Wyniki

| # | Strona (cel = intencja) | Odbiorcy | Intencja | Gdzie odpadają | Główne powody | śr. p_leave/krok | Kroki | Koszt / czas | Problemy | Werdykt |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | x.ai/grok (konsola API / pobranie apki) | devs + konsumenci | – (6/6 zablokowane) | start | (pierwotnie „nie działa”, p_leave 0.96) | 0.96 | 1 | $0.0024 / 10 s | Cloudflare blokuje headless Chromium, `curl` też dostaje 403 | **nie działa** (blokada), teraz poprawnie raportowane jako `zablokowane` |
| 2 | e2e.com (signup / quickstart / demo / GitHub) | engineering leads | 0/6 (seed 7), 0/6 (seed 7 ponownie), 0/6 (seed 99) | start → docs (3, 2, 0 z 6) | niejasna wartość 5–6/6 | 0.19–0.32 | 2.5–3 | $0.0064–0.0075 / 21 s | na mobile jedyne CTA to „skopiuj `npx e2e@latest init`” i hamburger; mój regex celu nie liczył skopiowania komendy | **częściowo**: zachowanie wiarygodne, ale cel źle zdefiniowany dla narzędzia CLI |
| 3 | inpost.pl (nadanie paczki / cennik) | polscy konsumenci | 3/6 (wszystkie przez „Cennik”) | start → wysylam → SzybkieNadania | nuda 2, za długi formularz 1 | 0.19 | 1.8 | $0.0030 / 17 s | regex celu nie złapał `SzybkieNadania` ani `wysylam` (to też intencja nadania, prawdziwy wynik raczej 5/6) | **działa** (z poprawionym celem) |
| 4 | linear.app vs notion.com (signup / pricing) | PM-owie w startupach | A 3/6, B 3/6 (McNemar p=1.0) | start → pricing | niejasna wartość (A 3, B 2) | A 0.27, B 0.18 | A 1.3, B 2.3 | $0.0062 / 23 s | Notion: baner cookies odrzucony automatycznie; jeden agent wszedł w „Request a demo” → formularz contact-sales (nic nie wysłał) i nie liczył się jako cel | **częściowo**: kierunek sensowny, ale powód „niejasna wartość” na stronie Linear jest mało wiarygodny dla PM-a |
| 5 | allegro.pl, kategoria smartfony (oferta / koszyk) | polscy konsumenci | – (6/6 zablokowane) | start | (pierwotnie „nuda” 5/6, cytaty o „ukrytych kosztach”) | 0.26 (przed poprawką) | 2.8 | $0.0033 → $0.0001 po poprawce | DataDome: strona blokady jest w iframe `captcha-delivery.com`, główny DOM pusty | **nie działa** (blokada); przed poprawką dawał **fałszywe** wyniki |

Zrzuty: `field-test/xai-cloudflare-block.jpg`, `field-test/allegro-datadome-block.jpg`, `field-test/inpost-szybkie-nadania.jpg`,
`field-test/notion-contact-sales.jpg`, `field-test/e2e-mobile-hero.jpg`.

## Testy realizmu

**(a) Czy p_leave rośnie na stronach mylących lub zablokowanych?** Częściowo. Na tekstowej stronie blokady x.ai Jev dał
p_leave 0.94–0.97 (dobrze). Na Allegro strona blokady była w iframe, więc agent widział pustą stronę, a Jev wybierał
„przewiń” z p≈0.8. Model nie wie, że brak treści oznacza problem. Poprawka: wykrywanie blokady przed decyzją
(tekst i ramki captcha), a nie poleganie na modelu.

**(b) Czy powody pasują do strony?** Najsłabszy punkt. Powód to argmax osobnego pytania i bardzo często wypada
„niejasna wartość”, także tam, gdzie strona jest jasna (Linear dla PM-a). Cytaty z ankiety wyjścia (gpt-oss) zmyślają
szczegóły, których na stronie nie ma („ukryte koszty” na stronie blokady Allegro, „dane karty” na formularzu e-mail Notion).
Powód i cytat traktować jako hipotezę, nie obserwację.

**(c) Zachowanie zdegenerowane?** Nie ma kliknięć w tę samą nawigację u wszystkich: wyostrzenie `p^1.5` działa i agenci
rozkładają się między „Pricing”, CTA i przewijanie. Jest natomiast odchylenie w stronę wcześnie odchodzących: przy
p_leave 0.2–0.3 na krok i losowaniu połowa person odpada w 1–2 krokach. Na prawdziwych stronach wygląda to rozsądnie,
ale nie jest skalibrowane względem prawdziwego bounce rate.

**(d) Powtarzalność (e2e.com):** ten sam seed: 0/6 i 0/6, docs 3/6 vs 2/6. Inny seed: 0/6, docs 0/6, p_leave 0.32
zamiast 0.19. Wniosek „nikt nie dochodzi do quickstartu, powód: niejasna wartość” jest stabilny, a liczby pośrednie przy
6 personach skaczą o ±1–3 osoby. Ten sam seed nie daje identycznego wyniku, bo role person z opisu odbiorców generuje
LLM przy każdym przebiegu.

## Werdykt

- **Działa** na zwykłych, otwartych stronach marketingowych (InPost, Linear, Notion, e2e.com): szybko (10–25 s), tanio
  (< 1 centa), bezpiecznie (zero wysłanych formularzy) i z sensownym kierunkiem (kto klika cennik, kto odpada od razu).
- **Nie działa** na stronach z ochroną anty-bot (x.ai/Cloudflare, Allegro/DataDome). Teraz kończy się to czytelnym
  `zablokowane` zamiast fałszywego lejka. Obejścia celowo brak.
- **Najważniejsza lekcja:** wynik zależy od definicji celu bardziej niż od modelu. W 3 z 5 przypadków mój regex pominął
  prawdziwą intencję (skopiowanie komendy CLI, `SzybkieNadania`, „Request a demo”). Cel trzeba ustalać, patrząc na stronę.
- **Słabe:** powody odejścia i cytaty. Jev ma silny prior na „niejasną wartość”, a model cytatów dopowiada szczegóły.
  Do prezentacji wyników na prawdziwych stronach lepiej pokazywać lejek i p_leave niż cytaty.

## Co poprawiono przy okazji

- tryb bezpieczny (opis wyżej), cel jako regex,
- elementy widoczne w oknie są brane jako pierwsze, limit podniesiony z 45 do 90 elementów (80 opcji klikania dla Jev),
- czyszczenie starych `data-hid` między krokami (w SPA strona się nie przeładowuje, więc stare id trafiały w złe elementy),
- linki `target=_blank` otwierają się w tej samej karcie (wcześniej agent „gubił” stronę),
- wykrywanie blokad anty-bot (tekst EN/PL i ramki captcha) jako wynik techniczny.
