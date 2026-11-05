// Prawdziwe sesje z rejestratora (demo-site/recorder.js): zapis, agregacja, persony-bliźniaki i kalibracja hordy.
import fs from 'node:fs';
import path from 'node:path';

export class SessionStore {
  constructor(file) { this.file = file; }

  add(rec) {
    const clean = {
      sid: String(rec.sid || '').slice(0, 40), variant: String(rec.variant || '?').slice(0, 4), step: String(rec.step || '').slice(0, 60),
      device: rec.device === 'mobile' ? 'mobile' : 'desktop', t_enter: Number(rec.t_enter) || Date.now(), dwell: Math.max(0, Number(rec.dwell) || 0),
      scroll: Math.max(0, Math.min(100, Number(rec.scroll) || 0)), rage: Number(rec.rage) || 0, exited: !!rec.exited,
      clicks: Array.isArray(rec.clicks) ? rec.clicks.slice(0, 40).map(c => ({ text: String(c.text || '').slice(0, 60), tag: String(c.tag || '').slice(0, 10), t: Number(c.t) || 0 })) : [],
      fields: { focus: Number(rec.fields?.focus) || 0, blur: Number(rec.fields?.blur) || 0 },
    };
    if (!clean.sid || !clean.step) return false;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, JSON.stringify(clean) + '\n');
    return true;
  }

  clear() { try { fs.unlinkSync(this.file); } catch {} }

  records() {
    try {
      return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }

  // Sesja = odsłony z tym samym sid, w kolejności wejścia.
  sessions(variant = null) {
    const by = {};
    for (const r of this.records()) (by[r.sid] ||= []).push(r);
    return Object.entries(by).map(([sid, pages]) => {
      pages.sort((a, b) => a.t_enter - b.t_enter);
      const path = [];
      for (const p of pages) if (path[path.length - 1] !== p.step) path.push(p.step);
      return { sid, variant: pages[0].variant, device: pages[0].device, pages, path, dwell: pages.reduce((a, p) => a + p.dwell, 0), started: pages[0].t_enter };
    }).filter(s => !variant || s.variant === variant).sort((a, b) => a.started - b.started);
  }

  aggregate() {
    const out = {};
    for (const s of this.sessions()) {
      const v = (out[s.variant] ||= { n: 0, devices: {}, reached: {}, dropoff: {}, dwell: {}, pos: {} });
      v.n++;
      v.devices[s.device] = (v.devices[s.device] || 0) + 1;
      s.path.forEach((st, i) => { v.reached[st] = (v.reached[st] || 0) + 1; (v.pos[st] ||= []).push(i); });
      const last = s.path[s.path.length - 1];
      v.dropoff[last] = (v.dropoff[last] || 0) + 1;
      for (const p of s.pages) (v.dwell[p.step] ||= []).push(p.dwell);
    }
    for (const v of Object.values(out)) {
      v.funnel = Object.keys(v.pos).sort((a, b) => mean(v.pos[a]) - mean(v.pos[b]))
        .map(st => ({ step: st, reached: v.reached[st], dropoff: v.dropoff[st] || 0, avgDwellMs: Math.round(mean(v.dwell[st] || [0])) }));
      delete v.pos; delete v.dwell;
    }
    return out;
  }
}

const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

// Opis prawdziwej sesji jednym zdaniem do promptu persony-bliźniaka.
export function describeSession(s, goal = 'sukces') {
  const parts = [`weszła ${s.device === 'mobile' ? 'z telefonu' : 'z komputera'}`];
  for (const p of s.pages.slice(0, 5)) {
    const click = p.clicks.find(c => c.text);
    parts.push(`${p.step}: ${Math.round(p.dwell / 1000)} s, przewinęła ${p.scroll}%${click ? `, kliknęła „${click.text}”` : ''}${p.rage ? ', klikała nerwowo w to samo' : ''}${p.fields.focus ? `, weszła w ${p.fields.focus} pól formularza` : ''}`);
  }
  const last = s.path[s.path.length - 1];
  parts.push(last.includes(goal) ? 'doszła do celu' : `odpadła na: ${last}`);
  return parts.join('; ');
}

// Persony-bliźniaki: cechy losowe zostają (rola, obawy), ale urządzenie, cierpliwość i opis zachowania biorą się z prawdziwej sesji.
export function twinPersonas(personas, sessions, goal) {
  if (!sessions.length) return personas;
  return personas.map((p, i) => {
    const s = sessions[i % sessions.length];
    const patience = Math.max(2, Math.min(9, s.path.length + 1 + Math.floor(s.dwell / 15000)));
    return { ...p, device: s.device, patience, realSession: describeSession(s, goal), twinOf: s.sid };
  });
}

// Kalibracja: porównujemy zasięg kroków lejka na A (prawdziwi ludzie vs horda) i przenosimy poprawkę na B.
// c_k = real_cont_k / horde_cont_k, gdzie cont_k = (n_k + 1) / (n_{k-1} + 2) (wygładzenie Laplace'a), surowe c_k ∈ [0.2, 5],
// potem ściągnięte do 1: c_k = 1 + (c_k - 1) · n / (n + 10), n = prawdziwe sesje na kroku k-1, i przycięte do [0.5, 2].
// Prognoza B: szanse zasięgu kroku k = szanse surowego zasięgu B × iloczyn c_j po krokach B do k (kroki spoza A mają c = 1).
export function calibrate(realSessionsA, run, goal = 'sukces') {
  const results = run.results.filter(r => r.converted || !['limit_budzetu', 'blad_modelu', 'przerwane', 'zablokowane'].includes(r.reason));
  const hA = results.filter(r => r.variant === 'A'), hB = results.filter(r => r.variant === 'B');
  if (!realSessionsA.length || !hA.length) return null;
  const pos = {};
  const addPaths = paths => paths.forEach(p => p.forEach((st, i) => (pos[st] ||= []).push(i)));
  addPaths(realSessionsA.map(s => s.path)); addPaths(hA.map(r => r.path)); addPaths(hB.map(r => r.path));
  // Krok-cel zawsze na końcu lejka (inaczej wariant ze skrótem do celu przesuwa go przed kroki A).
  const order = Object.keys(pos).sort((a, b) => (a.includes(goal) - b.includes(goal)) || mean(pos[a]) - mean(pos[b]));
  const count = (paths, st) => paths.filter(p => p.includes(st)).length;
  const realPaths = realSessionsA.map(s => s.path), aPaths = hA.map(r => r.path), bPaths = hB.map(r => r.path);
  const stepsA = order.filter(st => count(realPaths, st) || count(aPaths, st));
  const factor = {}, rawFactor = {}, nReal = {};
  stepsA.forEach((st, k) => {
    if (k === 0) { factor[st] = 1; return; }
    const prev = stepsA[k - 1];
    const nPrev = count(realPaths, prev);
    const realCont = (count(realPaths, st) + 1) / (nPrev + 2);
    const hordeCont = (count(aPaths, st) + 1) / (count(aPaths, prev) + 2);
    const raw = Math.max(0.2, Math.min(5, realCont / hordeCont));
    // Ściąganie do 1 przy małej próbie: przy n prawdziwych sesjach na poprzednim kroku zostaje n/(n+10) poprawki.
    factor[st] = Math.max(0.5, Math.min(2, 1 + (raw - 1) * nPrev / (nPrev + 10)));
    rawFactor[st] = raw; nReal[st] = nPrev;
  });
  const steps = order.map(st => ({
    step: st,
    realA: count(realPaths, st) / realPaths.length,
    hordeA: count(aPaths, st) / aPaths.length,
    c: factor[st] ?? 1,
    cRaw: rawFactor[st] ?? 1,
    nPrev: nReal[st] ?? null,
    inA: st in factor,
  }));
  const errSteps = steps.filter(s => s.inA);
  const maeBefore = mean(errSteps.map(s => Math.abs(s.hordeA - s.realA))) * 100;
  if (bPaths.length) {
    let cum = 1;
    for (const s of steps) {
      s.rawB = count(bPaths, s.step) / bPaths.length;
      if (!s.rawB) { s.calB = 0; continue; }
      cum *= s.c;
      // Poprawkę nakładamy na szanse (odds), nie na prawdopodobieństwo: jak przesunięcie w skali logit u Platta,
      // więc wynik zostaje w (0, 1) i nie nasyca się na 100% przy wysokim surowym zasięgu.
      const odds = s.rawB >= 1 ? Infinity : s.rawB / (1 - s.rawB) * cum;
      s.calB = odds === Infinity ? 1 : odds / (1 + odds);
    }
  }
  const goalStep = steps.find(s => s.step.includes(goal));
  return {
    nReal: realPaths.length, nHordeA: aPaths.length, nHordeB: bPaths.length, maeBefore, steps,
    conv: goalStep ? { realA: goalStep.realA, hordeA: goalStep.hordeA, rawB: goalStep.rawB ?? null, calB: goalStep.calB ?? null } : null,
  };
}
