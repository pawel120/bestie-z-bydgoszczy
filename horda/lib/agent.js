// Jeden agent = jedna persona w osobnym kontekście przeglądarki, który klika jak człowiek.
import { personaPrompt } from './personas.js';

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
  const els = [...document.querySelectorAll(sel)];
  const out = [];
  let id = 0;
  for (const el of els) {
    if (el.tagName === 'LABEL') continue;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none' || el.type === 'hidden') continue;
    el.setAttribute('data-hid', id);
    let text = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.title || el.name || '').trim().replace(/\s+/g, ' ').slice(0, 70);
    const lab = el.labels && el.labels[0] ? el.labels[0].innerText.trim().replace(/\s+/g, ' ').slice(0, 50) : '';
    const o = { id, t: el.tagName.toLowerCase() };
    if (el.type && el.tagName === 'INPUT') o.type = el.type;
    if (text) o.text = text;
    if (lab) o.label = lab;
    if (el.required) o.req = 1;
    if (el.tagName === 'SELECT') o.options = [...el.options].map(x => x.text).slice(0, 8);
    if (r.top > innerHeight || r.bottom < 0) o.offscreen = 1;
    out.push(o);
    if (++id >= 45) break;
  }
  const text = (document.body?.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, 1800);
  return { url: location.href, title: document.title, text, els: out };
};

export async function runAgent({ browser, persona, variant, startUrl, goal, llm, emit, maxSteps = 12, signal }) {
  const mobile = persona.device === 'mobile';
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 780 } : { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
    locale: 'pl-PL',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 100)));
  const result = { personaId: persona.id, variant, converted: false, steps: 0, path: [], reason: null, quote: null, thoughts: [], moods: [], errors, ms: 0 };
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
    if (goal.url && url.includes(goal.url)) return true;
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
    await page.waitForTimeout(400);
    visit();
    const memory = [];
    let stuck = 0;
    while (result.steps < maxSteps) {
      if (signal?.aborted) { result.reason = 'przerwane'; break; }
      if (await reachedGoal()) { result.converted = true; break; }
      const state = await page.evaluate(EXTRACT);
      send({ status: 'thinking', shot: await shot(), url: state.url });
      const left = persona.patience - result.steps;
      const user = `${personaPrompt(persona)}

Twoje dotychczasowe kroki:
${memory.slice(-6).join('\n') || '(dopiero wszedłeś na stronę)'}
${left <= 1 ? 'Kończy Ci się cierpliwość. Jeśli zaraz nie dostaniesz tego, czego chcesz, wyjdź.' : ''}

STRONA: ${state.title} (${state.url})
TREŚĆ:
${state.text}

ELEMENTY (id, typ, tekst; offscreen=trzeba przewinąć):
${state.els.map(e => JSON.stringify(e)).join('\n')}`;
      let d;
      try {
        d = await llm.json(SYSTEM, user);
      } catch (e) {
        if (String(e.message).includes('BUDGET') || e.fatal) { result.reason = 'limit_budzetu'; break; }
        stuck++;
        if (stuck >= 3) { result.reason = 'blad_modelu'; result.quote = String(e.message).slice(0, 120); break; }
        continue;
      }
      result.steps++;
      const think = String(d.think || '').slice(0, 140);
      result.thoughts.push(think);
      if (d.mood) result.moods.push(Number(d.mood));
      if (d.leave && d.leave.reason) {
        result.reason = d.leave.reason;
        result.quote = String(d.leave.quote || think).slice(0, 200);
        send({ status: 'left', think, quote: result.quote, reason: result.reason, mood: d.mood, shot: await shot() });
        break;
      }
      const actions = Array.isArray(d.actions) ? d.actions.slice(0, 12) : [];
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
      send({ status: 'acting', think, mood: d.mood, shot: preview || undefined, actions });
      for (const a of actions) {
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
      memory.push(`${result.steps}. [${stepName(state.url)}] myśl: "${think}" -> ${done.join(', ') || 'nic'}${page.url() !== state.url ? ` -> jestem na ${stepName(page.url())}` : ''}`);
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
