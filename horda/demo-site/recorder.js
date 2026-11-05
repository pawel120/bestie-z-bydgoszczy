// Rejestrator prawdziwych sesji (bez zależności). Jeden rekord na odsłonę strony, wysyłany przy wyjściu przez sendBeacon.
// Agenci hordy mają ustawione window.__HORDE_AGENT, więc ich ruch się nie nagrywa.
(function () {
  if (window.__HORDE_AGENT || !navigator.sendBeacon) return;
  var sid;
  try {
    sid = sessionStorage.getItem('horde_sid');
    if (!sid) { sid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8); sessionStorage.setItem('horde_sid', sid); }
  } catch (e) { sid = 'x' + Math.random().toString(36).slice(2, 10); }
  var m = location.pathname.match(/\/demo\/([^/]+)\/([^/]*)$/);
  var variant = m ? m[1].toUpperCase() : '?';
  var step = m ? m[2].replace(/\.html?$/, '') : location.pathname;
  if (!step || step === 'index') step = 'start';
  var t0 = Date.now(), maxScroll = 0, clicks = [], rage = 0, fields = { focus: 0, blur: 0 }, leaving = 0, sent = false;
  var last = { el: null, t: 0, n: 0 };
  function depth() {
    var h = document.documentElement.scrollHeight - innerHeight;
    var d = h > 0 ? Math.round(100 * scrollY / h) : 100;
    if (d > maxScroll) maxScroll = Math.min(100, d);
  }
  addEventListener('scroll', depth, { passive: true });
  depth();
  document.addEventListener('click', function (e) {
    var el = e.target.closest('a,button,input,select,label,[onclick]') || e.target;
    var now = Date.now();
    clicks.push({ text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 60), tag: el.tagName.toLowerCase(), t: now - t0 });
    if (last.el === el && now - last.t < 1000) { if (++last.n === 3) rage++; } else last.n = 1;
    last.el = el; last.t = now;
    if (el.tagName === 'A' && el.getAttribute('href') && el.getAttribute('href')[0] !== '#') leaving = now;
  }, true);
  document.addEventListener('submit', function () { leaving = Date.now(); }, true);
  document.addEventListener('focusin', function (e) { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) fields.focus++; });
  document.addEventListener('focusout', function (e) { if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) fields.blur++; });
  function send() {
    if (sent) return;
    sent = true;
    var now = Date.now();
    navigator.sendBeacon('/api/sessions', JSON.stringify({
      sid: sid, variant: variant, step: step, device: innerWidth < 700 ? 'mobile' : 'desktop',
      t_enter: t0, dwell: now - t0, scroll: maxScroll, clicks: clicks.slice(0, 40), rage: rage, fields: fields,
      exited: !(leaving && now - leaving < 3000),
    }));
  }
  addEventListener('pagehide', send);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') send(); });
})();
