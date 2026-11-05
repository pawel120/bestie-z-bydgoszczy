// Jeden agent = jedna persona w osobnym kontekście przeglądarki, który klika jak człowiek.
import { personaPrompt, rng } from './personas.js';
import { sample, argmax } from './jev.js';

const SYSTEM = `Symulujesz PRAWDZIWEGO odwiedzającego stronę, nie asystenta. Zostań w roli.
Zachowuj się jak ta osoba: jeśli nie rozumiesz, co to jest, nudzisz się, nie ufasz stronie, widzisz zaskakujący koszt
albo za długi formularz, to po prostu WYCHODZISZ (prawdziwi ludzie odpadają w 10-20 s, gdy wartość jest niejasna).
Nie masz obowiązku nic kupić. Jeśli strona cię przekonuje, idź dalej w stronę rejestracji/zakupu.
Wypełniając formularze wpisuj realistyczne, wymyślone dane (np. e-mail imie@example.com). Kartę testową: 4242 4242 4242 4242, 12/30, 123.
Odpowiadasz WYŁĄCZNIE JSON-em:
{"think":"max 15 słów, w 1. osobie, po polsku, jak ta persona",
 "mood":1-5,
 "actions":[{"do":"click","id":N} | {"do":"type","id":N,"text":"..."} | {"do":"select","id":N,"value":"..."} | {"do":"check","id":N} | {"do":"scroll"} | {"do":"back"}],
 "leave":null albo {"reason":"cena|ukryte_koszty|zaufanie|niejasna_wartosc|za_dlugi_formularz|wymuszone_konto|nie_dziala|nuda|inne","quote":"jedno zdanie, co byś napisał w ankiecie wyjścia"}}
Maks. 12 akcji naraz (np. wypełnij pola formularza i kliknij wyślij). Gdy wychodzisz, actions = [].`;

const EXTRACT = () => {
  const sel = 'a[href],button,input,select,textarea,[role=button],[onclick],summary,label[for]';
  // Stare id z poprzedniego kroku (SPA nie przeładowuje strony) muszą zniknąć, inaczej klik trafi w zły element.
  document.querySelectorAll('[data-hid]').forEach(e => e.removeAttribute('data-hid'));
  const RISKY = /sign ?up|zarejestr|załóż|kup|buy|pay|zapłać|subscribe|subskryb|send|wyślij|get started|zamów|order|log ?in|zaloguj/i;
  const vis = [...document.querySelectorAll(sel)].filter(el => {
    if (el.tagName === 'LABEL') return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return !(r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none' || el.type === 'hidden');
  });
  // Najpierw to, co widać w oknie (na prawdziwych stronach nawigacja i stopka zjadałyby limit elementów).
  const inView = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  const els = [...vis.filter(inView), ...vis.filter(el => !inView(el))];
  const out = [];
  let id = 0;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    el.setAttribute('data-hid', id);
    if (el.tagName === 'A' && el.target === '_blank') el.removeAttribute('target'); // nowa karta = agent zgubiłby stronę
    let text = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.title || el.name || '').trim().replace(/\s+/g, ' ').slice(0, 70);
    const lab = el.labels && el.labels[0] ? el.labels[0].innerText.trim().replace(/\s+/g, ' ').slice(0, 50) : '';
    const o = { id, t: el.tagName.toLowerCase() };
    if (el.type && el.tagName === 'INPUT') o.type = el.type;
    if (text) o.text = text;
    if (lab) o.label = lab;
    if (el.required) o.req = 1;
    if (el.form) o.form = [...document.forms].indexOf(el.form);
    if (el.form && (el.type === 'submit' || (el.tagName === 'BUTTON' && !el.getAttribute('type')))) o.submit = 1;
    if (el.tagName === 'SELECT') o.options = [...el.options].map(x => x.text).slice(0, 8);
    if (r.top > innerHeight || r.bottom < 0) o.offscreen = 1;
    // Na prawdziwych stronach (tryb bezpieczny) nie wolno wysłać formularza: przyciski w formularzu typu „wyślij/kup” blokujemy.
    if (el.form && (o.submit || RISKY.test(text))) o.risky = 1;
    out.push(o);
    if (++id >= 90) break;
  }
  const text = (document.body?.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, 1800);
  return { url: location.href, title: document.title, text, els: out };
};

export async function runAgent({ browser, persona, variant, startUrl, goal, llm, jev, emit, maxSteps = 12, signal, safe = false }) {
  if (safe) maxSteps = Math.min(maxSteps, 6);
  const mobile = persona.device === 'mobile';
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 780 } : { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'pl-PL',
  });
  await ctx.addInitScript(() => { window.__HORDE_AGENT = true; }); // nie nagrywaj agentów jako prawdziwych sesji
  const page = await ctx.newPage();
  // Tryb bezpieczny: żadnych żądań innych niż GET (nic nie wysyłamy, nie logujemy, nie płacimy na prawdziwej stronie).
  if (safe) await page.route('**/*', route => route.request().method() === 'GET' ? route.continue() : route.abort());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 100)));
  const result = { personaId: persona.id, variant, converted: false, steps: 0, path: [], reason: null, quote: null, thoughts: [], moods: [], decisions: [], errors, ms: 0 };
  // Ten sam strumień losowy dla persony w A i B (wspólne liczby losowe = mniejsza wariancja w porównaniu par).
  const r = rng(persona.id * 7919 + persona.age * 31 + 17);
  const t0 = Date.now();
  const base = (() => { const u = new URL(startUrl); return u.origin + u.pathname.replace(/[^/]*$/, ''); })();
  const stepName = url => {
    try {
      const u = new URL(url);
      let p = (u.origin + u.pathname).startsWith(base) ? (u.origin + u.pathname).slice(base.length) : u.pathname;
      p = p.replace(/\.html?$/, '').replace(/\/$/, '').replace(/^index$/, '');
      return p || 'start';
    } catch { return url; }
  };
  const shot = async () => {
    try { return (await page.screenshot({ type: 'jpeg', quality: 38 })).toString('base64'); } catch { return null; }
  };
  const reachedGoal = async () => {
    const url = page.url();
    if (goal.url && goalRe(goal.url).test(url)) return true;
    if (goal.text) {
      const body = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
      if (body.toLowerCase().includes(goal.text.toLowerCase())) return true;
    }
    return false;
  };
  const visit = () => {
    const s = stepName(page.url());
    if (result.path[result.path.length - 1] !== s) result.path.push(s);
  };
  const send = (extra) => emit({ type: 'agent', variant, personaId: persona.id, step: result.steps, path: result.path, ...extra });

  try {
    send({ status: 'loading' });
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(safe ? 1200 : 400);
    if (safe) result.consent = await dismissConsent(page);
    visit();
    const memory = [];
    let stuck = 0;
    while (result.steps < maxSteps) {
      if (signal?.aborted) { result.reason = 'przerwane'; break; }
      if (await reachedGoal()) { result.converted = true; break; }
      const state = await page.evaluate(EXTRACT);
      // Ochrona przed botami (Cloudflare itp.) to nie decyzja człowieka: kończymy jako błąd techniczny, nie omijamy jej.
      if (BLOCKED.test(state.title + '\n' + state.text.slice(0, 600))) {
        result.reason = 'zablokowane'; result.quote = 'Strona zablokowała automatyczną przeglądarkę (ochrona przed botami).';
        send({ status: 'left', reason: result.reason, quote: result.quote, shot: await shot() });
        break;
      }
      send({ status: 'thinking', shot: await shot(), url: state.url });
      let d;
      try {
        d = jev ? await decideJev({ jev, llm, persona, state, memory, steps: result.steps, r, stepName, safe })
          : await llm.json(SYSTEM, userPrompt(persona, state, memory, result.steps));
      } catch (e) {
        if (String(e.message).includes('BUDGET') || e.fatal) { result.reason = 'limit_budzetu'; result.quote = e.fatal ? String(e.message).slice(0, 120) : null; break; }
        stuck++;
        if (stuck >= 3) { result.reason = 'blad_modelu'; result.quote = String(e.message).slice(0, 120); break; }
        continue;
      }
      result.steps++;
      const think = String(d.think || '').slice(0, 140);
      result.thoughts.push(think);
      if (d.mood) result.moods.push(Number(d.mood));
      if (d.meta) result.decisions.push({ step: result.steps, page: stepName(state.url), ...d.meta, mood: d.mood });
      const pl = d.meta?.p_leave;
      if (d.leave && d.leave.reason) {
        result.reason = d.leave.reason;
        result.quote = String(d.leave.quote || think).slice(0, 200);
        send({ status: 'left', think, quote: result.quote, reason: result.reason, mood: d.mood, p_leave: pl, shot: await shot() });
        break;
      }
      const actions = Array.isArray(d.actions) ? d.actions.slice(0, 20) : [];
      const done = [];
      // Pokaż, gdzie agent "patrzy", zanim kliknie (do podglądu na żywo).
      const firstClick = actions.find(a => a.do === 'click');
      let preview = null;
      if (firstClick) {
        await page.evaluate(id => {
          const el = document.querySelector(`[data-hid="${id}"]`);
          if (!el) return;
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          const d = document.createElement('div');
          d.id = '__horde_dot';
          d.style.cssText = `position:fixed;left:${r.left + r.width / 2 - 14}px;top:${r.top + r.height / 2 - 14}px;width:28px;height:28px;border-radius:50%;background:rgba(255,60,90,.55);border:3px solid #ff3c5a;z-index:2147483647;pointer-events:none;box-shadow:0 0 0 8px rgba(255,60,90,.25)`;
          document.body.appendChild(d);
        }, firstClick.id).catch(() => {});
        preview = await shot();
        await page.evaluate(() => document.getElementById('__horde_dot')?.remove()).catch(() => {});
      }
      send({ status: 'acting', think, mood: d.mood, p_leave: pl, shot: preview || undefined, actions });
      for (const a of actions) {
        if (safe && (['type', 'select', 'check'].includes(a.do) || (a.do === 'click' && state.els.find(e => e.id === a.id)?.risky))) { done.push(`pominięte w trybie bezpiecznym: ${a.do} #${a.id}`); continue; }
        const loc = a.id !== undefined ? page.locator(`[data-hid="${a.id}"]`).first() : null;
        try {
          if (a.do === 'click' && loc) { await loc.click({ timeout: 3000 }); done.push(`kliknąłem #${a.id}`); await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(250); }
          else if (a.do === 'type' && loc) { await loc.fill(String(a.text ?? ''), { timeout: 3000 }); done.push(`wpisałem w #${a.id}`); }
          else if (a.do === 'select' && loc) { await loc.selectOption({ label: String(a.value) }, { timeout: 3000 }).catch(() => loc.selectOption(String(a.value), { timeout: 3000 })); done.push(`wybrałem #${a.id}`); }
          else if (a.do === 'check' && loc) { await loc.check({ timeout: 3000 }); done.push(`zaznaczyłem #${a.id}`); }
          else if (a.do === 'scroll') { await page.mouse.wheel(0, 600); await page.waitForTimeout(150); done.push('przewinąłem'); }
          else if (a.do === 'back') { await page.goBack({ timeout: 5000 }); done.push('cofnąłem'); }
        } catch (e) {
          done.push(`NIE UDAŁO SIĘ ${a.do} #${a.id}`);
          break; // strona się zmieniła, nowe id
        }
        if (page.url() !== state.url) break; // przeszliśmy dalej, stare id nieaktualne
      }
      visit();
      memory.push(`${result.steps}. [${stepName(state.url)}] ${d.meta ? d.meta.label : `myśl: "${think}"`} -> ${done.join(', ') || 'nic'}${page.url() !== state.url ? ` -> jestem na ${stepName(page.url())}` : ''}`);
      stuck = done.length && !done.every(x => x.startsWith('NIE')) ? 0 : stuck + 1;
      if (stuck >= 3) { result.reason = 'nie_dziala'; result.quote = 'Klikam i nic się nie dzieje.'; break; }
      if (result.steps >= persona.patience + 2) { result.reason = 'nuda'; result.quote = result.quote || 'Za długo to trwa, odpuszczam.'; break; }
    }
    if (!result.converted && !result.reason && (await reachedGoal())) result.converted = true;
    if (!result.converted && !result.reason) { result.reason = 'nuda'; result.quote = 'Za długo to trwa, odpuszczam.'; }
    visit();
    result.ms = Date.now() - t0;
    send({ status: result.converted ? 'converted' : 'left', reason: result.reason, quote: result.quote, shot: await shot(), final: result });
  } catch (e) {
    result.reason = result.reason || 'nie_dziala';
    result.quote = result.quote || ('Strona się nie ładuje: ' + String(e.message).slice(0, 80));
    result.ms = Date.now() - t0;
    send({ status: 'left', reason: result.reason, quote: result.quote, final: result });
  } finally {
    await ctx.close().catch(() => {});
  }
  return result;
}

function userPrompt(persona, state, memory, steps) {
  const left = persona.patience - steps;
  return `${personaPrompt(persona)}

Twoje dotychczasowe kroki:
${memory.slice(-6).join('\n') || '(dopiero wszedłeś na stronę)'}
${left <= 1 ? 'Kończy Ci się cierpliwość. Jeśli zaraz nie dostaniesz tego, czego chcesz, wyjdź.' : ''}

STRONA: ${state.title} (${state.url})
TREŚĆ:
${state.text}

ELEMENTY (id, typ, tekst; offscreen=trzeba przewinąć):
${state.els.map(e => JSON.stringify(e)).join('\n')}`;
}

// ---- Mózg Jev: jeden request Decisions na krok, akcja losowana z rozkładu ----

const REASONS = {
  cena: 'produkt jest dla tej osoby za drogi',
  ukryte_koszty: 'pojawiły się dodatkowe, wcześniej nieujawnione opłaty lub automatyczne odnowienie',
  zaufanie: 'strona nie budzi zaufania (dane karty, zgody marketingowe, brak informacji o firmie)',
  niejasna_wartosc: 'nie wiadomo, co to za produkt i co z niego będzie miała',
  za_dlugi_formularz: 'formularz jest za długi albo wymaga zbyt wielu danych',
  wymuszone_konto: 'wymaga założenia konta, zanim pokaże cokolwiek',
  nie_dziala: 'coś na stronie nie działa albo jest mylące',
  nuda: 'znudziła się, nic jej nie zatrzymało',
  inne: 'inny powód',
};
const QUOTE_FALLBACK = {
  cena: 'Za drogo jak na to, ile faktur wystawiam.',
  ukryte_koszty: 'Na końcu wyskoczyły dodatkowe opłaty, o których nikt nie wspominał.',
  zaufanie: 'Nie podam karty stronie, której nie znam.',
  niejasna_wartosc: 'Nie zrozumiałem, co właściwie dostaję.',
  za_dlugi_formularz: 'Tyle pól do wypełnienia? Szkoda mi czasu.',
  wymuszone_konto: 'Nie chcę zakładać konta tylko po to, żeby zobaczyć produkt.',
  nie_dziala: 'Klikam i nic się nie dzieje.',
  nuda: 'Nic mnie tu nie zatrzymało, zamykam.',
  inne: 'Nie przekonało mnie to.',
};
const quoteModels = () => (process.env.HORDE_QUOTE_MODELS || 'openai/gpt-oss-120b,x-ai/grok-4-fast').split(',').map(s => s.trim()).filter(Boolean);

const FILLABLE = e => (e.t === 'input' && !['submit', 'button', 'image', 'reset', 'file'].includes(e.type)) || e.t === 'select' || e.t === 'textarea';
const CLICKABLE = e => ['a', 'button', 'summary'].includes(e.t) || (e.t === 'input' && ['submit', 'button'].includes(e.type)) || (!FILLABLE(e) && e.t !== 'input');
const elLabel = e => (e.text || e.label || '').slice(0, 60);

async function decideJev({ jev, llm, persona, state, memory, steps, r, stepName, safe }) {
  const fields = safe ? [] : state.els.filter(FILLABLE);
  const clicks = state.els.filter(e => CLICKABLE(e) && elLabel(e) && !(safe && e.risky)).slice(0, 80);
  const options = {
    leave: 'Ta osoba rezygnuje i zamyka kartę TERAZ (biorąc pod uwagę jej cierpliwość, obawy, intencję i to, co widzi na tej stronie).',
    scroll: 'Ta osoba przewija stronę w dół, bo chce zobaczyć więcej, zanim coś kliknie.',
  };
  if (fields.length) options.fill_form = `Ta osoba wypełnia widoczny formularz (${fields.length} pól: ${fields.map(f => f.label || f.text || f.type || f.t).slice(0, 12).join(', ')}) i go wysyła.`;
  for (const e of clicks) {
    const kind = e.t === 'a' ? 'link' : 'przycisk';
    options['el_' + e.id] = `Ta osoba klika ${kind} „${elLabel(e)}”${e.offscreen ? ' (niżej na stronie, trzeba przewinąć)' : ''}.`;
  }
  const left = persona.patience - steps;
  const jstate = {
    persona: personaPrompt(persona),
    cierpliwosc: left <= 1 ? 'Cierpliwość prawie się skończyła: jeśli strona zaraz nie da jej tego, czego chce, wyjdzie.' : `To jej krok ${steps + 1}, wytrzyma jeszcze ok. ${left}.`,
    dotychczasowe_kroki: memory.slice(-6).join('\n') || '(dopiero weszła na stronę)',
    strona: `${state.title} (${stepName(state.url)})`,
    tresc_strony: state.text.slice(0, 1500),
    formularz: fields.length ? fields.map(f => `${f.label || f.text || f.t}${f.req ? ' (wymagane)' : ''}`).join('; ') : 'brak',
  };
  const answers = await jev.decide(jstate, {
    action: {
      type: 'choice',
      instructions: 'Przewidujesz, co ZROBI TERAZ ta konkretna osoba (persona w state), a NIE co byłoby optymalne albo grzeczne. Prawdziwi ludzie często odchodzą: gdy wartość jest niejasna, gdy widzą zaskakujący koszt, za długi formularz albo prośbę o kartę, której się nie spodziewali. Osoba przekonana idzie dalej w stronę rejestracji.',
      criteria: options,
    },
    reason: {
      type: 'choice',
      instructions: 'Gdyby ta osoba odeszła z tej strony teraz, jaki byłby główny powód?',
      criteria: REASONS,
    },
    mood: {
      type: 'score',
      instructions: 'Jak ta osoba czuje się teraz z tą stroną?',
      criteria: ['zirytowana, chce wyjść', 'zniechęcona', 'neutralna', 'zainteresowana', 'przekonana, chce działać'],
    },
  });
  const probs = answers.action?.probabilities || {};
  const action = sample(probs, r) || 'leave';
  const p = probs[action] ?? 0;
  const pLeave = probs.leave ?? 0;
  const mood = typeof answers.mood?.score === 'number' ? +(answers.mood.score + 1).toFixed(2) : null;
  const tail = `(p=${p.toFixed(2)}) · odejście p=${pLeave.toFixed(2)}`;
  const top = argmax(probs);
  const meta = { action, p: +p.toFixed(3), p_leave: +pLeave.toFixed(3), top, p_top: +(probs[top] ?? 0).toFixed(3) };
  if (action === 'leave') {
    const reason = argmax(answers.reason?.probabilities) || 'inne';
    const quote = await exitQuote(llm, persona, state, reason, stepName);
    return { think: `→ wychodzę ${tail}`, mood, actions: [], leave: { reason, quote }, meta: { ...meta, reason, label: 'zamknięcie karty' } };
  }
  if (action === 'scroll') return { think: `→ przewijam ${tail}`, mood, actions: [{ do: 'scroll' }], meta: { ...meta, label: 'przewinięcie' } };
  if (action === 'fill_form') return { think: `→ wypełniam formularz (${fields.length} pól) ${tail}`, mood, actions: fillForm(state.els, persona), meta: { ...meta, label: 'wypełnienie i wysłanie formularza' } };
  const id = Number(action.slice(3));
  const el = state.els.find(e => e.id === id);
  // Klik w „wyślij” formularza z pustymi polami = człowiek najpierw wypełnia formularz.
  if (el?.submit && fields.some(f => f.form === el.form)) return { think: `→ wypełniam i klikam „${elLabel(el)}” ${tail}`, mood, actions: fillForm(state.els, persona), meta: { ...meta, label: `wypełnienie formularza i klik „${elLabel(el)}”` } };
  return { think: `→ klik „${elLabel(el || {})}” ${tail}`, mood, actions: [{ do: 'click', id }], meta: { ...meta, label: `klik „${elLabel(el || {})}”` } };
}

const SURNAMES = ['Nowak', 'Kowalska', 'Wiśniewski', 'Wójcik', 'Kamińska', 'Lewandowski', 'Zielińska', 'Szymański'];
const ascii = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase().replace(/[^a-z0-9]/g, '');

// Jev nie pisze tekstu, więc formularz wypełniamy deterministycznie danymi persony, po typie/etykiecie pola.
function fillForm(els, persona) {
  const fields = els.filter(FILLABLE);
  const form = fields.find(f => f.form !== undefined)?.form;
  const surname = SURNAMES[persona.id % SURNAMES.length];
  const pass = 'Fakturix!2026pl';
  const actions = [];
  for (const f of fields) {
    if (form !== undefined && f.form !== undefined && f.form !== form) continue;
    const k = `${f.label || ''} ${f.text || ''}`.toLowerCase();
    if (f.type === 'checkbox' || f.type === 'radio') { if (f.req || /zgod|akceptuj|regulamin|wymagane/.test(k)) actions.push({ do: 'check', id: f.id }); continue; }
    if (f.t === 'select') { if (f.options?.[1]) actions.push({ do: 'select', id: f.id, value: f.options[1] }); continue; }
    let v;
    if (f.type === 'email' || /mail/.test(k)) v = `${ascii(persona.name)}.${persona.id}@example.com`;
    else if (f.type === 'password' || /hasł|haslo|password/.test(k)) v = pass;
    else if (f.type === 'tel' || /telefon|phone|komórk/.test(k)) v = '+48 601 234 567';
    else if (/nip/.test(k)) v = '5261040828';
    else if (/kart|card/.test(k)) v = '4242 4242 4242 4242';
    else if (/ważn|wazn|mm\/|expir/.test(k)) v = '12/30';
    else if (/cvc|cvv/.test(k)) v = '123';
    else if (/firm|company/.test(k)) v = `${surname} Usługi`;
    else if (/nazwisk|last/.test(k)) v = surname;
    else if (/imi|first|name/.test(k)) v = persona.name;
    else if (/kod|zip|postal/.test(k)) v = '85-001';
    else if (/miast|city/.test(k)) v = 'Bydgoszcz';
    else if (/adres|ulic|street/.test(k)) v = 'ul. Gdańska 1';
    else if (f.type === 'number') v = '1';
    else if (f.type === 'date') v = '2026-12-01';
    else if (f.t === 'textarea') v = 'Dzień dobry, proszę o kontakt.';
    else v = persona.name;
    actions.push({ do: 'type', id: f.id, text: v });
  }
  const submit = els.find(e => e.submit && (form === undefined || e.form === form))
    || els.find(e => e.t === 'button' && /dalej|wyślij|zarejestr|załóż|zapłać|kontynuuj|aktywuj|start|zapisz|submit/i.test(e.text || ''));
  if (submit) actions.push({ do: 'click', id: submit.id });
  return actions.slice(0, 20);
}

// Jedno krótkie wywołanie taniego modelu czatu: cytat z „ankiety wyjścia” głosem persony.
async function exitQuote(llm, persona, state, reason, stepName) {
  try {
    const d = await llm.json('Zwracasz tylko JSON: {"quote":"..."}. Jedno krótkie zdanie po polsku, potocznie, w 1. osobie.',
      `${personaPrompt(persona)}\nWłaśnie zamykasz stronę „${state.title}” (${stepName(state.url)}). Główny powód: ${REASONS[reason] || reason}.\nFragment strony: ${state.text.slice(0, 500)}\nCo wpiszesz w ankiecie wyjścia (max 20 słów)?`,
      { maxTokens: 400, temperature: 0.9, models: quoteModels(), reasoning: { effort: 'low' } });
    const q = String(d.quote || '').trim();
    if (q) return q.slice(0, 200);
  } catch (e) {
    if (String(e.message).includes('BUDGET')) return QUOTE_FALLBACK[reason] || QUOTE_FALLBACK.inne;
  }
  return QUOTE_FALLBACK[reason] || QUOTE_FALLBACK.inne;
}

// Cel jako wyrażenie regularne (np. "signup|pricing|accounts\\.") albo zwykły fragment URL, gdy regex jest niepoprawny.
function goalRe(g) {
  try { return new RegExp(g, 'i'); } catch { return { test: u => u.includes(g) }; }
}

// Banery cookies: klikamy opcję najbardziej prywatną (odrzuć / tylko niezbędne), także w ramkach CMP.
// Jeśli jej nie ma, banner zostaje i persona radzi sobie z nim jak człowiek.
const REJECT = /^(odrzuć( wszystkie)?|odrzucam|reject( all)?|decline( all)?|deny( all)?|only (necessary|essential)|tylko niezbędne|necessary only|use necessary cookies only|refuse( all)?|nie zgadzam się)(?![a-ząćęłńóśźż])/i;
async function dismissConsent(page) {
  for (const frame of page.frames()) {
    try {
      const buttons = frame.locator('button, [role=button], a[role=button], input[type=button]');
      const n = Math.min(await buttons.count(), 80);
      for (let i = 0; i < n; i++) {
        const b = buttons.nth(i);
        const t = ((await b.innerText({ timeout: 300 }).catch(() => '')) || '').trim();
        if (t.length < 40 && REJECT.test(t) && await b.isVisible().catch(() => false)) {
          await b.click({ timeout: 2000 });
          await page.waitForTimeout(400);
          return 'odrzucone: ' + t;
        }
      }
    } catch {}
  }
  return 'brak przycisku odrzuć';
}

const BLOCKED = /you have been blocked|attention required|verify you are (a )?human|just a moment\.\.\.|checking your browser|access denied|are you a robot|captcha|unusual traffic|request blocked|px-captcha/i;
