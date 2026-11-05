// Base product: the meeting discusses features of an existing product, so cards are designed inside its look.
// Loads the page in a hidden, sandboxed window, screenshots it and extracts a rough design system from the DOM.

import { BrowserWindow } from "electron";

export interface Product {
  url: string;
  title: string;
  description: string;
  /** 1440x900 JPEG data URL, shown on the board. */
  screenshot: string;
  /** Small JPEG (768 px wide, ~700 tokens) given to Claude as the visual reference, base64 without prefix. */
  reference: string;
  /** Fonts, colours, radii and the visible structure (nav, headings, buttons) as compact text. */
  designSystem: string;
  /** Every visible text / image block of the first screen, in 960x600 coordinates, for an exact replica. */
  layout: string;
}

// Runs inside the product page: frequency-ranked colours / fonts / radii plus the page's visible skeleton.
const EXTRACT = `(() => {
  const count = (map, key, w = 1) => key && map.set(key, (map.get(key) || 0) + w);
  const top = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  const bg = new Map(), text = new Map(), accent = new Map(), fonts = new Map(), radius = new Map();
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.top < innerHeight * 2; };
  for (const el of document.querySelectorAll("body *")) {
    if (!visible(el)) continue;
    const s = getComputedStyle(el);
    const area = Math.min(el.offsetWidth * el.offsetHeight, 400000) / 1000;
    if (s.backgroundColor !== "rgba(0, 0, 0, 0)") count(bg, s.backgroundColor, area);
    if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      count(text, s.color);
      count(fonts, s.fontFamily.split(",")[0].replace(/["']/g, "").trim());
    }
    if (el.matches("button, a[class], [role=button], input[type=submit]")) {
      if (s.backgroundColor !== "rgba(0, 0, 0, 0)") count(accent, s.backgroundColor);
      count(radius, s.borderRadius);
    }
  }
  // Layout map of the first screen, scaled from 1440x900 to the 960x600 card.
  const k = 960 / innerWidth;
  const layout = [];
  for (const el of document.querySelectorAll("body *")) {
    if (layout.length >= 160) break;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.width < 6 || r.height < 6) continue;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.opacity === "0") continue;
    const box = Math.round(r.left * k) + "," + Math.round(r.top * k) + " " + Math.round(r.width * k) + "x" + Math.round(r.height * k);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(" ").trim();
    if (own) {
      layout.push(box + " text " + Math.round(parseFloat(s.fontSize) * k) + "px w" + s.fontWeight + " " + s.color +
        (s.backgroundColor !== "rgba(0, 0, 0, 0)" ? " bg " + s.backgroundColor : "") +
        (parseFloat(s.borderRadius) ? " r" + Math.min(999, Math.round(parseFloat(s.borderRadius) * k)) : "") + ' "' + own.slice(0, 90) + '"');
    } else if (el.matches("img, svg, video, canvas, picture") && r.width * r.height > 1500) {
      layout.push(box + " " + el.tagName.toLowerCase() + (el.alt ? ' "' + el.alt.slice(0, 40) + '"' : ""));
    } else if (s.backgroundColor !== "rgba(0, 0, 0, 0)" && r.width * r.height > 20000 && r.width < innerWidth) {
      layout.push(box + " panel bg " + s.backgroundColor + (parseFloat(s.borderRadius) ? " r" + Math.round(parseFloat(s.borderRadius) * k) : ""));
    }
  }
  const texts = (sel, n) => [...document.querySelectorAll(sel)].filter(visible).map((e) => e.innerText.trim().replace(/\\s+/g, " ")).filter(Boolean).slice(0, n);
  return {
    title: document.title,
    description: document.querySelector('meta[name="description"], meta[property="og:description"]')?.content || "",
    body: getComputedStyle(document.body).backgroundColor,
    bg: top(bg, 5), text: top(text, 4), accent: top(accent, 4), fonts: top(fonts, 3), radius: top(radius, 3),
    layout: layout.join(String.fromCharCode(10)),
    nav: texts("nav a, header a", 10), headings: texts("h1, h2, h3", 10), buttons: texts("button, [role=button]", 8),
  };
})()`;

export async function loadProduct(url: string): Promise<Product> {
  const win = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: { sandbox: true, partition: "product-preview" },
  });
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Strona ładuje się za długo.")), 25_000)),
    ]);
    // Let client-side rendering, fonts and hero animations settle.
    await new Promise((r) => setTimeout(r, 2_500));
    // Cookie / consent banners are not part of the product.
    await win.webContents.executeJavaScript(`for (const el of document.querySelectorAll("body *")) {
      const tag = (el.id + " " + el.className + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
      const fixed = ["fixed", "sticky"].includes(getComputedStyle(el).position);
      if (/cookie|consent|gdpr|onetrust/.test(tag) || (fixed && /cookie|consent/i.test(el.innerText || "") && (el.innerText || "").length < 600)) el.remove();
    }`);
    await new Promise((r) => setTimeout(r, 300));
    const image = await win.webContents.capturePage();
    const d = (await win.webContents.executeJavaScript(EXTRACT)) as Record<string, string[] | string>;
    const list = (v: string[] | string) => (Array.isArray(v) ? v.join(", ") : v) || "—";
    return {
      url,
      title: String(d.title || url),
      description: String(d.description || ""),
      screenshot: `data:image/jpeg;base64,${image.resize({ width: 1440 }).toJPEG(82).toString("base64")}`,
      reference: image.resize({ width: 768 }).toJPEG(70).toString("base64"),
      layout: String(d.layout || ""),
      designSystem: [
        `Page background: ${d.body}; large surfaces: ${list(d.bg)}`,
        `Text colours: ${list(d.text)}`,
        `Button / accent colours: ${list(d.accent)}`,
        `Fonts: ${list(d.fonts)} (not installed for the cards — use the closest system font)`,
        `Corner radii of controls: ${list(d.radius)}`,
        `Navigation: ${list(d.nav)}`,
        `Headings: ${list(d.headings)}`,
        `Buttons: ${list(d.buttons)}`,
      ].join("\n"),
    };
  } finally {
    win.destroy();
  }
}
