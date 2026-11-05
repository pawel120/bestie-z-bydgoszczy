/**
 * Scenariusz minutowego demo: przelot po kanwie w kolejności, w jakiej
 * rozmowa budowała produkt. Każdy przystanek to szybkie przewinięcie osi
 * czasu (idee wlatują do panelu), a potem chwila na przeczytanie ekranu.
 */
export interface TourStep {
  nodeId: string
  caption: string
  /** Sekundy zatrzymania na tym przystanku. */
  hold: number
}

export const RUSH_SEC = 1.2

export const TOUR: TourStep[] = [
  {
    nodeId: 'm-meeting',
    caption: 'Spotkanie trwa. Pięć myśli z rozmowy zamienia się w pierwszy ekran produktu.',
    hold: 5,
  },
  {
    nodeId: 'b-lovable',
    caption: 'Pierwsza kontra: „a to nie jest po prostu plugin do Lovable?”',
    hold: 3.5,
  },
  {
    nodeId: 'm-canvas',
    caption: 'Odpowiedź: rozdziel wypowiedzi po głosach i postaw warianty obok siebie.',
    hold: 5,
  },
  {
    nodeId: 'b-speed',
    caption: 'Decyzja, która ustawiła resztę spotkania: gramy prędkością, nie kompletnością.',
    hold: 3.5,
  },
  {
    nodeId: 'm-validation',
    caption: 'Więc zamiast dowozić produkt — 200 agentów na wariancie w osiemnaście sekund.',
    hold: 5,
  },
  {
    nodeId: 'b-value',
    caption: 'Kontra i rozróżnienie: oni testują pod bugi, my pod value.',
    hold: 3.5,
  },
  {
    nodeId: 'm-sessions',
    caption: 'Stąd test na nagraniach prawdziwych sesji, a nie na wymyślonych scenariuszach.',
    hold: 5,
  },
  {
    nodeId: 'b-bitter',
    caption: 'Bitter lesson: harness zniknie, kiedy modele dorosną.',
    hold: 3.5,
  },
  {
    nodeId: 'm-results',
    caption: 'Zostaje to, czego kolejny model nie skasuje — pomiar pieniędzy.',
    hold: 5,
  },
  {
    nodeId: 'b-final',
    caption: 'I decyzja, która domyka pętlę: wrzucamy cały transcript i generujemy z niego makiety.',
    hold: 5,
  },
]

export const TOUR_SECONDS = Math.round(TOUR.reduce((sum, step) => sum + step.hold + RUSH_SEC, 0))
