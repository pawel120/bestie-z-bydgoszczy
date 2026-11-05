// Cienki klient OpenRouter z licznikiem kosztów i twardym limitem budżetu.
const URL_ = process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1/chat/completions';

export class LLM {
  constructor({ key, models, budgetUsd }) {
    this.key = key;
    this.models = models;
    this.budgetUsd = budgetUsd;
    this.spent = 0;
    this.calls = 0;
    this.tokensIn = 0;
    this.tokensOut = 0;
    this.lastModel = null;
    this.inFlight = 0;
    this.servedBy = {}; // Jev Router wybiera model per żądanie
  }
  // Liczymy też żądania w locie (po średnim koszcie), bo przy 8 równoległych agentach limit inaczej przestrzeliwuje.
  get overBudget() {
    const avg = this.calls ? this.spent / this.calls : 0;
    return this.spent + this.inFlight * avg >= this.budgetUsd;
  }

  // final: jedno podsumowanie analityka na koniec przebiegu, wykonywane zawsze, nawet po wyczerpaniu limitu.
  async json(system, user, { maxTokens = 300, temperature = 0.8, final = false } = {}) {
    if (!final && this.overBudget) throw new Error('BUDGET');
    this.inFlight++;
    try { return await this.#json(system, user, maxTokens, temperature); }
    finally { this.inFlight--; }
  }

  async #json(system, user, maxTokens, temperature) {
    const body = () => ({
      model: this.models[0],
      models: this.models.slice(0, 3),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: maxTokens,
      temperature,
      response_format: { type: 'json_object' },
      reasoning: { enabled: false },
      usage: { include: true },
      provider: { sort: 'throughput', require_parameters: false },
    });
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const b = body();
        const res = await fetch(URL_, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.key}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/horda',
            'X-Title': 'Horda',
          },
          body: JSON.stringify(b),
        });
        if (!res.ok) {
          const t = await res.text();
          if (res.status === 402) throw Object.assign(new Error('Brak środków na OpenRouter (402)'), { fatal: true });
          if (res.status === 401) throw Object.assign(new Error('Zły klucz OpenRouter (401)'), { fatal: true });
          // Model, który odrzuca żądanie (zły id, zły endpoint), wypada z listy na resztę przebiegu.
          if ([400, 404].includes(res.status) && this.models.length > 1) {
            if (this.models[0] === b.model) {
              console.warn(`[llm] ${b.model} odrzucony (${res.status}), przełączam: ${t.slice(0, 160)}`);
              this.models = this.models.slice(1);
            }
            attempt--;
            continue;
          }
          throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 200)}`);
        }
        const data = await res.json();
        this.calls++;
        this.lastModel = data.model || this.lastModel;
        if (data.model) this.servedBy[data.model] = (this.servedBy[data.model] || 0) + 1;
        const u = data.usage || {};
        this.tokensIn += u.prompt_tokens || 0;
        this.tokensOut += u.completion_tokens || 0;
        this.spent += typeof u.cost === 'number' ? u.cost : ((u.prompt_tokens || 0) * 0.2 + (u.completion_tokens || 0) * 0.5) / 1e6;
        const text = data.choices?.[0]?.message?.content || '';
        return parseJson(text);
      } catch (e) {
        lastErr = e;
        if (e.fatal) throw e;
        await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw lastErr;
  }
}

export function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new Error('Model nie zwrócił JSON: ' + text.slice(0, 120));
}
