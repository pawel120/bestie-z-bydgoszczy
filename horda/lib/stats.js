// Statystyka, żeby nie wyciągać wniosków z szumu.

// Przedział Wilsona 95% dla proporcji (Wilson 1927) – działa sensownie także dla małych n.
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d;
  const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

// Dokładny test McNemara (dwustronny). Te same persony przechodzą przez A i B,
// więc porównujemy pary: liczy się tylko, ile osób konwertuje na B, a nie na A (b) i odwrotnie (c).
export function mcnemarExact(b, c) {
  const n = b + c;
  if (!n) return 1;
  const k = Math.min(b, c);
  let p = 0;
  let coef = 1; // C(n,0)
  for (let i = 0; i <= k; i++) {
    if (i > 0) coef = coef * (n - i + 1) / i;
    p += coef;
  }
  return Math.min(1, 2 * p / Math.pow(2, n));
}

// Agent przerwany przez technikalia (budżet, błąd modelu, stop) nie mówi nic o stronie: nie liczymy go do konwersji.
const TECHNICAL = new Set(['limit_budzetu', 'blad_modelu', 'przerwane', 'zablokowane']);

export function summarize(allResults, personas) {
  const results = allResults.filter(r => r.converted || !TECHNICAL.has(r.reason));
  const byVariant = {};
  for (const r of results) (byVariant[r.variant] ||= []).push(r);
  const variants = [...new Set(allResults.map(r => r.variant))].sort();
  const out = { variants: {}, funnel: [], paired: null };
  const orderScore = {};
  for (const v of variants) {
    const rs = byVariant[v] || [];
    const conv = rs.filter(r => r.converted).length;
    const reasons = {};
    for (const r of rs) if (!r.converted && r.reason) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    const reached = {};
    for (const r of rs) r.path.forEach((s, i) => {
      reached[s] = (reached[s] || 0) + 1;
      (orderScore[s] ||= []).push(i);
    });
    const moods = rs.flatMap(r => r.moods);
    const pl = rs.flatMap(r => (r.decisions || []).map(d => d.p_leave)).filter(x => typeof x === 'number');
    out.variants[v] = {
      n: rs.length, conv, incomplete: allResults.filter(r => r.variant === v).length - rs.length, rate: rs.length ? conv / rs.length : 0, ci: wilson(conv, rs.length),
      reasons, reached,
      avgSteps: rs.reduce((a, r) => a + r.steps, 0) / (rs.length || 1),
      avgMood: moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null,
      avgPLeave: pl.length ? pl.reduce((a, b) => a + b, 0) / pl.length : null,
      quotes: rs.filter(r => r.quote).map(r => ({ personaId: r.personaId, reason: r.reason, quote: r.quote, lastStep: r.path[r.path.length - 1], converted: r.converted })),
    };
  }
  // Kroki lejka uporządkowane po średniej pozycji w ścieżce.
  out.funnel = Object.keys(orderScore)
    .map(s => ({ step: s, pos: orderScore[s].reduce((a, b) => a + b, 0) / orderScore[s].length, count: orderScore[s].length }))
    .filter(s => s.count >= 1)
    .sort((a, b) => a.pos - b.pos)
    .slice(0, 8)
    .map(s => ({ step: s.step, ...Object.fromEntries(variants.map(v => [v, out.variants[v].reached[s.step] || 0])) }));
  if (variants.length === 2) {
    const [A, B] = variants;
    const map = {};
    for (const r of results) (map[r.personaId] ||= {})[r.variant] = r.converted;
    let b = 0, c = 0;
    for (const id in map) {
      if (map[id][A] === undefined || map[id][B] === undefined) continue;
      if (!map[id][A] && map[id][B]) b++;
      if (map[id][A] && !map[id][B]) c++;
    }
    out.paired = { onlyB: b, onlyA: c, p: mcnemarExact(b, c), lift: out.variants[A].rate ? (out.variants[B].rate - out.variants[A].rate) / out.variants[A].rate : null };
  }
  return out;
}
