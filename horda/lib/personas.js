// Generator person. Cechy behawioralne losujemy z rozkładów opartych na badaniach,
// a nie wymyślamy "z głowy" modelem (modele zbiegają do mediany, więc persony z LLM
// byłyby do siebie podobne). Źródła w README.md.

// Seedowany RNG, żeby ten sam seed dawał te same persony w wariancie A i B (projekt sparowany).
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
function weighted(r, table) {
  const total = table.reduce((a, [, w]) => a + w, 0);
  let x = r() * total;
  for (const [v, w] of table) { if ((x -= w) <= 0) return v; }
  return table[table.length - 1][0];
}

// Baymard Institute, "Reasons for abandonments during checkout" (badanie US, 2024; % respondentów).
export const BAYMARD_CONCERNS = [
  ['ukryte_koszty', 48, 'dodatkowe koszty, które wychodzą dopiero na końcu'],
  ['wymuszone_konto', 26, 'konieczność zakładania konta'],
  ['zaufanie', 25, 'brak zaufania do strony przy podawaniu danych karty'],
  ['zbyt_dlugi_proces', 22, 'zbyt długi lub skomplikowany proces'],
  ['brak_ceny', 21, 'brak jasnej, pełnej ceny od początku'],
  ['bledy', 17, 'błędy i crashe strony'],
  ['platnosci', 13, 'za mało metod płatności'],
];

// Nielsen (1997) "How Users Read on the Web": 79% skanuje, 16% czyta słowo po słowie.
const READING = [['skanuje nagłówki i przyciski, czyta ok. 20% tekstu', 79], ['czyta uważnie słowo po słowie', 16], ['czyta tylko nagłówek i od razu szuka ceny', 5]];
// StatCounter 2025: ok. 60% ruchu webowego to mobile.
const DEVICE = [['mobile', 60], ['desktop', 40]];
// Założenie (nie badanie): mieszanka intencji typowa dla ruchu z reklam.
const INTENT = [['tylko się rozgląda, łatwo się zniechęci', 50], ['porównuje kilka opcji', 35], ['ma problem i chce go dziś rozwiązać', 15]];
const TECH = [['niska', 25], ['średnia', 50], ['wysoka', 25]];
const PRICE = [['niska', 25], ['średnia', 45], ['wysoka', 30]];

const NAMES = ['Kasia', 'Marek', 'Ola', 'Tomek', 'Basia', 'Piotr', 'Zosia', 'Kuba', 'Ewa', 'Michał', 'Agnieszka', 'Grzegorz', 'Julia', 'Paweł', 'Magda', 'Andrzej', 'Natalia', 'Wojtek', 'Hania', 'Krzysztof', 'Iga', 'Bartek', 'Lena', 'Adam'];
const DEFAULT_ROLES = [
  'freelancerka graficzka, wystawia 5 faktur miesięcznie',
  'właściciel małego warsztatu samochodowego',
  'księgowa w biurze rachunkowym, obsługuje 30 firm',
  'programista B2B na kontrakcie',
  'właścicielka sklepu internetowego z rękodziełem',
  'student zakładający pierwszą działalność',
  'CTO startupu, szuka narzędzia dla zespołu',
  'emerytowany elektryk, dorabia na działalności',
  'fotograf ślubny, dużo pracy w terenie z telefonu',
  'tłumaczka, rozlicza klientów z zagranicy',
  'właściciel food trucka',
  'trenerka personalna, prowadzi jednoosobową firmę',
];

export function makePersonas(n, seed = 42, roles = null) {
  const r = rng(seed);
  const pool = roles && roles.length ? roles : DEFAULT_ROLES;
  const names = [...NAMES].sort(() => r() - 0.5);
  const out = [];
  for (let i = 0; i < n; i++) {
    const concern = weighted(r, BAYMARD_CONCERNS.map(([k, w]) => [k, w]));
    const age = 19 + Math.floor(r() * 50);
    out.push({
      id: i + 1,
      name: names[i % names.length],
      age,
      role: pool[i % pool.length],
      device: weighted(r, DEVICE),
      intent: weighted(r, INTENT),
      reading: weighted(r, READING),
      tech: weighted(r, TECH),
      priceSensitivity: weighted(r, PRICE),
      concern,
      concernText: BAYMARD_CONCERNS.find(c => c[0] === concern)[2],
      patience: 4 + Math.floor(r() * 6), // ile akcji zniesie, zanim się znudzi
    });
  }
  return out;
}

export function personaPrompt(p) {
  return `Jesteś ${p.name}, ${p.age} lat, ${p.role}.
Urządzenie: ${p.device === 'mobile' ? 'telefon (mały ekran, kciuk, mało cierpliwości do formularzy)' : 'laptop'}.
Intencja: ${p.intent}. Obeznanie z technologią: ${p.tech}. Wrażliwość na cenę: ${p.priceSensitivity}.
Sposób czytania: ${p.reading}.
Co Cię najbardziej zniechęca w zakupach online: ${p.concernText}.
Cierpliwość: wytrzymasz ok. ${p.patience} kroków, potem odpuszczasz.`;
}
