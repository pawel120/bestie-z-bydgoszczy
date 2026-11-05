// Room client: joins the shared session, turns this person's speech into text, renders the shared board.

import { ScribeSession } from "/scribe.js";
import { AgentCursors } from "/agents.js";

const $ = (id) => document.getElementById(id);
const room = new URLSearchParams(location.search).get("room") || "";

const showOffline = (offline) => { $("offline").hidden = !offline; };

/** A lost request must never break the mic loop: it only shows that the room is out of reach. */
const post = (route, body) =>
  fetch(route, { method: "POST", headers: { "Content-Type": "application/json", "x-room": room }, body: JSON.stringify(body) })
    .catch((err) => {
      showOffline(true);
      return new Response(JSON.stringify({ error: err.message }), { status: 503 });
    });

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 2;

let me = "";
let lang = "pl-PL";

// ---- Join ----
const savedName = (() => { try { return localStorage.getItem("bestie-name") || ""; } catch { return ""; } })();
$("name").value = savedName;

$("join").addEventListener("submit", (e) => {
  e.preventDefault();
  me = $("name").value.trim();
  lang = $("lang").value;
  if (!me) return;
  try { localStorage.setItem("bestie-name", me); } catch { /* private window */ }
  connect();
});

function connect() {
  const events = new EventSource(`/api/events?room=${encodeURIComponent(room)}&name=${encodeURIComponent(me)}`);
  let joined = false;
  events.onmessage = (e) => {
    if (!joined) {
      joined = true;
      $("join").hidden = true;
      $("app").hidden = false;
    }
    handle(JSON.parse(e.data));
  };
  events.onerror = () => {
    if (joined) return showOffline(true); // EventSource reconnects by itself and resends the state
    events.close();
    $("joinError").textContent = "Nie mogę wejść do pokoju. Sprawdź, czy link jest pełny.";
    $("joinError").hidden = false;
  };
}

function handle(event) {
  switch (event.type) {
    case "state":
      showOffline(false);
      resetBoard();
      partials.clear();
      $("lines").replaceChildren();
      event.lines.forEach(addLine);
      event.cards.forEach(drawCard);
      setPeople(event.people);
      showBrain(event.budget);
      if (event.cards.length) fit();
      break;
    case "brain":
      showBrain(event);
      break;
    case "line":
      addLine(event.line);
      clearPartial(event.line.speaker);
      break;
    case "partial":
      showPartial(event.speaker, event.text);
      break;
    case "people":
      setPeople(event.people);
      break;
    case "card": {
      const isNew = !cardEls.has(event.card.id);
      drawCard(event.card);
      if (isNew && $("follow").checked) fit();
      break;
    }
    case "move":
      moveCard(event.id, event.x, event.y);
      break;
    case "agent":
      cursors.show(event);
      break;
    case "agent-done":
      cursors.hide(event.id);
      break;
    case "clear":
      resetBoard();
      break;
  }
}

function showBrain({ activity, spent, limit, stopped, error }) {
  $("brainStatus").textContent = error || activity || "";
  $("budget").textContent = `$${spent.toFixed(2)} / $${limit.toFixed(2)}`;
  $("budget").classList.toggle("over", stopped);
  if (stopped && listening) stopMic("Limit budżetu wyczerpany.");
}

function setPeople(people) {
  $("people").replaceChildren(...people.map((name) => {
    const el = document.createElement("span");
    el.className = "person";
    el.textContent = name;
    return el;
  }));
}

// ---- Transcript ----
const partials = new Map();

function lineElement(speaker, at, text) {
  const el = document.createElement("div");
  el.className = "line";
  const who = document.createElement("b");
  who.textContent = speaker;
  const body = document.createElement("p");
  body.textContent = text;
  el.append(who);
  if (at) {
    const time = document.createElement("time");
    time.textContent = at;
    el.append(time);
  }
  el.append(body);
  return el;
}

function pinToBottom(update) {
  const list = $("lines");
  const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  update();
  if (atEnd) list.scrollTop = list.scrollHeight;
}

function addLine(line) {
  pinToBottom(() => {
    const anchor = partials.values().next().value ?? null;
    $("lines").insertBefore(lineElement(line.speaker, line.at, line.text), anchor);
  });
}

function showPartial(speaker, text) {
  if (!text) return clearPartial(speaker);
  pinToBottom(() => {
    let el = partials.get(speaker);
    if (!el) {
      el = lineElement(speaker, "", text);
      el.classList.add("partial");
      partials.set(speaker, el);
      $("lines").append(el);
    }
    el.querySelector("p").textContent = text;
  });
}

function clearPartial(speaker) {
  partials.get(speaker)?.remove();
  partials.delete(speaker);
}

// ---- Microphone: ElevenLabs when the room has a key, otherwise the browser's own recognition ----
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let listening = false;
let lastPartial = 0;

function micState(on, message = "") {
  listening = on;
  $("mic").textContent = on ? "Wyłącz mikrofon" : "Włącz mikrofon";
  $("mic").classList.toggle("on", on);
  $("micStatus").textContent = message;
}

let audio = null; // { ctx, stream, session, ticker }

async function scribeToken() {
  const res = await post("/api/scribe-token", {});
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.error), { status: res.status });
  return body.token;
}

async function startScribe() {
  let first = await scribeToken(); // fails here, before asking for the mic, when the room has no key
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const ctx = new AudioContext({ sampleRate: 48_000 });
  await ctx.audioWorklet.addModule("/pcm-worklet.js");
  const worklet = new AudioWorkletNode(ctx, "pcm-capture");
  const getToken = async () => {
    const value = first ?? (await scribeToken());
    first = null;
    return value;
  };
  const session = new ScribeSession(getToken, lang.slice(0, 2), (event) => {
    if (event.type === "partial" && performance.now() - lastPartial > 300) {
      lastPartial = performance.now();
      post("/api/partial", { speaker: me, text: event.text });
    } else if (event.type === "committed") post("/api/line", { speaker: me, text: event.text });
    else if (event.type === "error") $("micStatus").textContent = event.message;
  });
  worklet.port.onmessage = (e) => session.send(e.data);
  ctx.createMediaStreamSource(stream).connect(worklet);
  const silent = ctx.createGain();
  silent.gain.value = 0;
  worklet.connect(silent).connect(ctx.destination); // keeps the worklet running without playing anything
  await session.connect();
  const ticker = setInterval(() => post("/api/speech-tick", { seconds: 10 }), 10_000);
  audio = { ctx, stream, session, ticker };
  micState(true, "Słucham");
}

function stopMic(message = "") {
  micState(false, message);
  recognition?.stop();
  if (audio) {
    clearInterval(audio.ticker);
    audio.session.close();
    audio.stream.getTracks().forEach((track) => track.stop());
    audio.ctx.close();
    audio = null;
  }
}

function startMic() {
  if (!Recognition) return micState(false, "Mikrofon działa tylko w Chrome lub Edge.");
  recognition = new Recognition();
  recognition.lang = lang;
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const text = e.results[i][0].transcript.trim();
      if (e.results[i].isFinal) {
        if (text) post("/api/line", { speaker: me, text });
      } else interim += ` ${text}`;
    }
    if (interim && performance.now() - lastPartial > 300) {
      lastPartial = performance.now();
      post("/api/partial", { speaker: me, text: interim.trim() });
    }
  };
  recognition.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") micState(false, "Przeglądarka zablokowała mikrofon.");
    else if (e.error === "network") micState(false, "Rozpoznawanie mowy nie ma połączenia.");
    else if (e.error === "audio-capture") micState(false, "Nie widzę mikrofonu.");
  };
  // Chrome ends recognition after a silence, so keep it going while the mic is on.
  recognition.onend = () => { if (listening) recognition.start(); };
  micState(true, "Słucham");
  recognition.start();
}

$("mic").addEventListener("click", async () => {
  if (listening) return stopMic();
  $("mic").disabled = true;
  try {
    await startScribe();
  } catch (err) {
    if (err.status === 501) startMic();
    else if (err.name === "NotAllowedError") micState(false, "Przeglądarka zablokowała mikrofon.");
    else micState(false, err.message);
  } finally {
    $("mic").disabled = false;
  }
});

// ---- Canvas ----
const world = $("world");
const canvas = $("canvas");
const view = { x: 40, y: 40, k: 0.5 };
const cardEls = new Map();

/** The card an agent works on, or the empty spot past the board while it is still thinking. */
function agentArea(id) {
  const card = cardEls.get(id);
  if (card) return { x: card.x, y: card.y, w: card.el.offsetWidth, h: card.el.offsetHeight };
  const right = Math.max(0, ...[...cardEls.values()].map((c) => c.x + c.el.offsetWidth));
  return { x: right + 60, y: 0, w: 400, h: 200 };
}
const cursors = new AgentCursors(world, agentArea);

function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  world.style.setProperty("--z", view.k);
  canvas.style.backgroundPosition = `${view.x}px ${view.y}px`;
}

function fit() {
  const all = [...cardEls.values()];
  if (!all.length) return;
  const left = Math.min(...all.map((c) => c.x));
  const top = Math.min(...all.map((c) => c.y));
  const right = Math.max(...all.map((c) => c.x + c.el.offsetWidth));
  const bottom = Math.max(...all.map((c) => c.y + c.el.offsetHeight));
  const box = canvas.getBoundingClientRect();
  view.k = Math.min(1, Math.max(MIN_ZOOM, Math.min((box.width - 48) / (right - left), (box.height - 48) / (bottom - top))));
  view.x = (box.width - (right - left) * view.k) / 2 - left * view.k;
  view.y = (box.height - (bottom - top) * view.k) / 2 - top * view.k;
  applyView();
}

function resetBoard() {
  for (const card of cardEls.values()) card.el.remove();
  cardEls.clear();
  cursors.clear();
  drawLinks();
  $("empty").hidden = false;
}

/** Text is the default element: a picture or a framed mockup appears only when the element has one. */
function drawCard(card) {
  let entry = cardEls.get(card.id);
  if (!entry) {
    const el = document.createElement("article");
    el.className = "card";
    el.innerHTML = `<p class="say"></p><p class="more"></p><div class="status"></div>
      <img alt="" draggable="false" hidden><small class="caption"></small><div class="frame" hidden></div>`;
    world.append(el);
    entry = { el, x: card.x, y: card.y, html: null, card };
    cardEls.set(card.id, entry);
    wireCard(entry);
    $("empty").hidden = true;
  }
  entry.card = card;
  const picture = entry.el.querySelector("img");
  entry.el.classList.toggle("picture", !!card.src);
  entry.el.classList.toggle("framed", !!card.html);
  entry.el.querySelector(".say").textContent = card.title;
  entry.el.querySelector(".more").textContent = card.body;
  entry.el.querySelector(".status").textContent = card.status;
  entry.el.querySelector(".caption").textContent = card.caption;
  picture.hidden = !card.src;
  if (card.src && picture.getAttribute("src") !== card.src) picture.src = card.src;
  if (entry.html !== card.html) fillFrame(entry, card);
  moveCard(card.id, card.x, card.y);
}

/** Cards are model-written HTML from a live conversation, so each one runs sandboxed, cut off from the room. */
function fillFrame(entry, card) {
  entry.html = card.html;
  const frame = entry.el.querySelector(".frame");
  frame.hidden = !card.html;
  if (!card.html) return;
  // The new render loads behind the old one, so a card that is being drawn doesn't flash white.
  const iframe = document.createElement("iframe");
  iframe.title = card.title;
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.srcdoc = card.html;
  iframe.addEventListener("load", () => {
    for (const old of frame.querySelectorAll("iframe")) if (old !== iframe) old.remove();
    iframe.classList.remove("loading");
  });
  iframe.classList.add("loading");
  frame.append(iframe);
}

function moveCard(id, x, y) {
  const entry = cardEls.get(id);
  if (!entry) return;
  entry.x = x;
  entry.y = y;
  entry.el.style.transform = `translate(${x}px, ${y}px)`;
  drawLinks();
}

function drawLinks() {
  const svg = $("links");
  svg.querySelectorAll("line").forEach((l) => l.remove());
  for (const { card, x, y, el } of cardEls.values()) {
    if (card.src) continue; // a picture belongs to the text beside it; arrows would only tangle the row
    for (const parent of [card.from, card.with]) {
      const source = cardEls.get(parent);
      if (!source) continue;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", source.x + source.el.offsetWidth);
      line.setAttribute("y1", source.y + source.el.offsetHeight / 2);
      line.setAttribute("x2", x);
      line.setAttribute("y2", y + el.offsetHeight / 2);
      svg.append(line);
    }
  }
}

function wireCard(entry) {
  const head = entry.el;
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".frame")) return; // a mockup keeps its own clicks; drag it by its text
    e.stopPropagation();
    head.setPointerCapture(e.pointerId);
    const start = { px: e.clientX, py: e.clientY, x: entry.x, y: entry.y };
    const drag = (m) => moveCard(entry.card.id, start.x + (m.clientX - start.px) / view.k, start.y + (m.clientY - start.py) / view.k);
    head.addEventListener("pointermove", drag);
    head.addEventListener("pointerup", () => {
      head.removeEventListener("pointermove", drag);
      if (entry.x !== start.x || entry.y !== start.y) post("/api/move", { id: entry.card.id, x: entry.x, y: entry.y });
    }, { once: true });
  });
  // Double click makes the card interactive (clickable mockup); Escape returns to the board.
  entry.el.querySelector(".frame").addEventListener("dblclick", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".card.live").forEach((c) => c.classList.remove("live"));
    entry.el.classList.add("live");
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".card.live").forEach((c) => c.classList.remove("live"));
});

canvas.addEventListener("pointerdown", (e) => {
  if (e.target.closest(".card.live")) return;
  // Focus may be inside the mockup, where Escape can't be heard, so a press beside it also leaves it.
  document.querySelectorAll(".card.live").forEach((c) => c.classList.remove("live"));
  const start = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
  const pan = (m) => {
    // Capture only once this is a real drag: capturing on press would swallow double clicks on cards.
    if (!canvas.hasPointerCapture(e.pointerId)) {
      if (Math.hypot(m.clientX - start.px, m.clientY - start.py) < 4) return;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("panning");
    }
    view.x = start.x + m.clientX - start.px;
    view.y = start.y + m.clientY - start.py;
    applyView();
  };
  canvas.addEventListener("pointermove", pan);
  canvas.addEventListener("pointerup", () => {
    canvas.removeEventListener("pointermove", pan);
    canvas.classList.remove("panning");
  }, { once: true });
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const box = canvas.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.k * Math.exp(-e.deltaY * 0.002)));
    view.x = px - ((px - view.x) / view.k) * k;
    view.y = py - ((py - view.y) / view.k) * k;
    view.k = k;
  } else {
    view.x -= e.deltaX;
    view.y -= e.deltaY;
  }
  applyView();
}, { passive: false });

$("fit").addEventListener("click", fit);
$("clear").addEventListener("click", () => {
  if (confirm("Wyczyścić tablicę dla wszystkich? Karty zostaną w archiwum sesji.")) post("/api/clear", {});
});
applyView();
