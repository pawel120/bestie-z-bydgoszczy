// Klient OpenRouter Decisions API dla Jev (TypeSafe). Jev nie pisze tekstu: na pytania typu choice/score/noul
// o podany `state` zwraca rozkład prawdopodobieństwa. Koszt i budżet liczymy w tym samym liczniku co LLM.
const URL_ = process.env.OPENROUTER_DECISIONS_URL || 'https://openrouter.ai/api/alpha/decisions';
export const JEV_MODEL = process.env.HORDE_JEV_MODEL || '~typesafe/jev-latest';
export const JEV_LABEL = 'Jev (decisions)';

export class Jev {
  // meter: instancja LLM, której liczniki (spent, calls, tokeny, budżet) współdzielimy.
  constructor({ key, meter, model = JEV_MODEL }) {
    this.key = key;
    this.meter = meter;
    this.model = model;
  }

  async decide(state, questions) {
    const m = this.meter;
    if (m.overBudget) throw new Error('BUDGET');
    m.inFlight++;
    try { return await this.#decide(state, questions); }
    finally { m.inFlight--; }
  }

  async #decide(state, questions) {
    const m = this.meter;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(URL_, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.key}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/horda',
            'X-Title': 'Horda',
          },
          body: JSON.stringify({ model: this.model, state, questions }),
        });
        if (!res.ok) {
          const t = await res.text();
          if (res.status === 402) throw Object.assign(new Error('Brak środków na OpenRouter (402)'), { fatal: true });
          if (res.status === 401) throw Object.assign(new Error('Zły klucz OpenRouter (401)'), { fatal: true });
          if (res.status === 400) throw Object.assign(new Error(`Jev 400: ${t.slice(0, 200)}`), { fatal: true });
          throw new Error(`Jev ${res.status}: ${t.slice(0, 200)}`);
        }
        const data = await res.json();
        m.calls++;
        if (data.model) m.servedBy[data.model] = (m.servedBy[data.model] || 0) + 1;
        const u = data.usage || {};
        m.tokensIn += u.input_tokens || 0;
        m.tokensOut += u.output_tokens || 0;
        m.spent += typeof u.cost === 'number' ? u.cost : (u.input_tokens || 0) * 0.04 / 1e6;
        if (!data.answers) throw new Error('Jev bez answers: ' + JSON.stringify(data).slice(0, 160));
        return data.answers;
      } catch (e) {
        lastErr = e;
        if (e.fatal) throw e;
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw lastErr;
  }
}

// Losowanie z rozkładu (zamiast argmax): różne persony z tym samym rozkładem robią różne rzeczy, jak ludzie.
export function sample(probs, r) {
  const entries = Object.entries(probs || {}).filter(([, p]) => p > 0);
  const total = entries.reduce((a, [, p]) => a + p, 0);
  if (!total) return null;
  let x = r() * total;
  for (const [k, p] of entries) { if ((x -= p) <= 0) return k; }
  return entries[entries.length - 1][0];
}

export const argmax = probs => Object.entries(probs || {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
