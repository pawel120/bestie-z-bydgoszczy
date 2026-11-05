// A real browser for research: opens public pages, reads them and takes a screenshot for the board.
// Each session gets a clean context with no cookies or logins, and nothing here can type or submit.

import { chromium } from "playwright-core";

const PAGE_TEXT = 6_000;
const MAX_LINKS = 25;
const LOAD_TIMEOUT = 12_000;
const SETTLE_MS = 800;
const IMAGE_SEARCH = "https://www.bing.com/images/search";
const THUMB_WIDTH = 640;
const VIDEO_SEARCH = "https://www.youtube.com/results";
const VIDEOS_ONLY = "EgIQAQ==";
const BLOCKED = /just a moment|attention required|are you (a )?human|captcha|access denied|robot check/i;

/** Only public web pages: the browser runs on the host machine, so local addresses stay out of reach. */
export function isPublicUrl(raw) {
  try {
    const { protocol, hostname } = new URL(raw);
    if (protocol !== "http:" && protocol !== "https:") return false;
    return !/^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/i.test(hostname);
  } catch {
    return false;
  }
}

export const hostOf = (url) => new URL(url).hostname.replace(/^www\./, "");

// Cookie and consent banners cover the page in screenshots and fill its text.
const CLEAN_PAGE = `(() => {
  for (const el of document.querySelectorAll("body *")) {
    const name = (el.id + " " + el.className + " " + (el.getAttribute("aria-label") || "")).toLowerCase();
    const fixed = ["fixed", "sticky"].includes(getComputedStyle(el).position);
    const text = el.innerText || "";
    if (/cookie|consent|gdpr|onetrust|didomi/.test(name) || (fixed && /cookie|prywatno|consent/i.test(text) && text.length < 1500)) el.remove();
  }
  document.documentElement.style.overflow = "auto";
  document.body.style.overflow = "auto";
})()`;

const READ_PAGE = `(() => ({
  title: document.title,
  text: document.body.innerText,
  links: [...document.querySelectorAll("a[href]")]
    .map((a) => ({ text: a.innerText.trim().replace(/\\s+/g, " ").slice(0, 80), url: a.href }))
    .filter((l) => l.text && l.url.startsWith("http")),
}))()`;

export function createBrowsing() {
  let browser = null;

  async function startSession() {
    browser ??= await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 960, height: 600 }, locale: "pl-PL" });
    // Redirects and subresources must not reach the host's network either.
    await context.route("**/*", (route) => {
      const url = route.request().url();
      const allowed = (isPublicUrl(url) || /^(data|blob):/.test(url)) && !["font", "media"].includes(route.request().resourceType());
      return allowed ? route.continue() : route.abort();
    });
    let links = [];

    async function visit(url) {
      if (!isPublicUrl(url)) throw new Error("Tylko publiczne strony.");
      const page = await context.newPage(); // one per visit, so the model can open several at once
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT });
        await page.waitForTimeout(SETTLE_MS);
        await page.evaluate(CLEAN_PAGE).catch(() => {});
        const read = await page.evaluate(READ_PAGE);
        const blocked = BLOCKED.test(read.title) || read.text.trim().length < 80;
        const seen = new Set();
        links = read.links.filter((l) => isPublicUrl(l.url) && !seen.has(l.url) && seen.add(l.url)).slice(0, MAX_LINKS);
        const image = blocked ? "" : (await page.screenshot({ type: "jpeg", quality: 45 })).toString("base64");
        return { url: page.url(), title: read.title, text: read.text.replace(/\n{3,}/g, "\n\n").slice(0, PAGE_TEXT), links, image, blocked };
      } finally {
        await page.close();
      }
    }

    /** Pictures from a web image search, inlined as JPEG so the board never loads from a stranger's server. */
    async function images(query, limit) {
      const page = await context.newPage();
      try {
        await page.goto(`${IMAGE_SEARCH}?${new URLSearchParams({ q: query, safeSearch: "Strict" })}`, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT });
        await page.waitForSelector("a.iusc", { timeout: LOAD_TIMEOUT });
        const hits = await page.evaluate(() =>
          [...document.querySelectorAll("a.iusc")].map((a) => {
            try {
              return JSON.parse(a.getAttribute("m"));
            } catch {
              return null;
            }
          }),
        );
        const usable = hits.filter((h) => h?.turl && isPublicUrl(h.turl)).slice(0, limit);
        const found = await Promise.all(
          usable.map(async (hit) => {
            const link = `${hit.turl}&w=${THUMB_WIDTH}`;
            const res = await context.request.get(link);
            if (!res.ok() || res.headers()["content-type"] !== "image/jpeg") return null;
            const source = isPublicUrl(hit.purl ?? "") ? hostOf(hit.purl) : "internet";
            return { title: hit.t ?? query, url: `data:image/jpeg;base64,${(await res.body()).toString("base64")}`, link, license: source };
          }),
        );
        return found.filter(Boolean);
      } finally {
        await page.close();
      }
    }

    /** The top result of a YouTube search, read from the data the results page ships with. */
    async function findVideo(query) {
      const page = await context.newPage();
      try {
        await page.goto(`${VIDEO_SEARCH}?${new URLSearchParams({ search_query: query, sp: VIDEOS_ONLY })}`, { waitUntil: "domcontentloaded", timeout: LOAD_TIMEOUT });
        const match = (await page.content()).match(/"videoRenderer":\{"videoId":"([\w-]{11})".*?"title":\{"runs":\[\{"text":"([^"]+)"/);
        return match ? { id: match[1], title: match[2] } : null;
      } finally {
        await page.close();
      }
    }

    return {
      visit,
      images,
      findVideo,
      /** Follows link number `n` of the last opened page. */
      follow(n) {
        const link = links[n - 1];
        if (!link) throw new Error(`Nie ma linku numer ${n}.`);
        return visit(link.url);
      },
      close: () => context.close().catch(() => {}),
    };
  }

  return { startSession };
}
