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
  const texts = (sel, n) => [...document.querySelectorAll(sel)].filter(visible).map((e) => e.innerText.trim().replace(/\\s+/g, " ")).filter(Boolean).slice(0, n);
  return {
    title: document.title,
    description: document.querySelector('meta[name="description"], meta[property="og:description"]')?.content || "",
    body: getComputedStyle(document.body).backgroundColor,
    bg: top(bg, 5), text: top(text, 4), accent: top(accent, 4), fonts: top(fonts, 3), radius: top(radius, 3),
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
    const image = await win.webContents.capturePage();
    const d = (await win.webContents.executeJavaScript(EXTRACT)) as Record<string, string[] | string>;
    const list = (v: string[] | string) => (Array.isArray(v) ? v.join(", ") : v) || "—";
    return {
      url,
      title: String(d.title || url),
      description: String(d.description || ""),
      screenshot: `data:image/jpeg;base64,${image.resize({ width: 1440 }).toJPEG(82).toString("base64")}`,
      reference: image.resize({ width: 768 }).toJPEG(70).toString("base64"),
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
