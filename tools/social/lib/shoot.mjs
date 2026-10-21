// The screenshot: serve web-site/ on 127.0.0.1, open one scene (lib/scenes.mjs) in Chromium with the API mocked
// from the committed demo fixtures, take the viewport, and frame it on the page's own background colour at a
// size X shows uncropped (4:5 for a phone, 16:10 for a desktop). No device chrome.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { SCENES, VIEWPORTS } from "./scenes.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../../..");
export const SITE_DIR = path.join(ROOT, "web-site");
export const MAX_BYTES = 5 * 1024 * 1024;
const API = "http://localhost:5080";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json", ".mp3": "audio/mpeg", ".ogg": "audio/ogg",
  ".woff2": "font/woff2", ".wasm": "application/wasm",
};

/** A static server for the built site, as Vercel serves it: /x/ and /x are /x/index.html. */
export function serveSite(dir = SITE_DIR) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = path.resolve(root, "." + p);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    else if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
    if (!fs.existsSync(file)) { res.writeHead(404, { "Content-Type": "text/plain" }).end("not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` })));
}

// ── Demo data ─────────────────────────────────────────────────────────────────

/** The site's own solfa engine (assets/choir.js), run in Node as web-site/tests do, to label demo notes as the API would. */
function solfaEngine(siteDir) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(siteDir, "assets/choir.js"), "utf8"), { window });
  return window.NfChoir;
}

/** Amazing Grace as its hymn page publishes it (the page's own JSON), shaped as a saved sheet. */
export function graceSheet(siteDir = SITE_DIR) {
  const html = fs.readFileSync(path.join(siteDir, "hymns/amazing-grace/index.html"), "utf8");
  const m = /<script type="application\/json" id="hymn-data">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error("hymns/amazing-grace/index.html has no hymn-data block; build the site first.");
  const d = JSON.parse(m[1]);
  return {
    id: "grace", title: "Amazing Grace", key: d.key, tempoBpm: d.tempo, timeSignature: d.time, overallConfidence: 0.96,
    notes: solfaEngine(siteDir).label(d.notes.map((n) => ({ ...n, conf: 1 })), d.key), musicXml: d.musicXml, lyrics: "",
    parts: null, partsMusicXml: "", createdAtUtc: "2026-10-12T10:00:00Z",
  };
}

export function hundredthResult() {
  return JSON.parse(fs.readFileSync(path.join(HERE, "../fixtures/old-hundredth.json"), "utf8"));
}

function hundredthSheet() {
  const r = hundredthResult();
  return {
    id: "hundredth", title: "Old Hundredth", key: r.key, tempoBpm: r.tempo, timeSignature: r.timeSignature, overallConfidence: r.overallConfidence,
    notes: r.notes, musicXml: r.musicXml, parts: r.parts, partsMusicXml: r.partsMusicXml, lyrics: r.hymnMatch?.lyrics || "",
    createdAtUtc: "2026-10-14T18:30:00Z",
  };
}

const DEMO_USER = { id: "demo", fullName: "NoteFusion Demo", email: "demo@example.com" };
const DEMO_PLAN = {
  isActive: true, isPro: true, planName: "Pro", planCode: "pro_monthly", status: "Active",
  songCreditsRemaining: 20, songCreditsTotal: 20, freeHarmonyAvailable: false, currentPeriodEndUtc: "2026-12-01T00:00:00Z",
};
const IDENTIFY_FOUND = {
  match: { slug: "amazing-grace", title: "Amazing Grace", tune: "NEW BRITAIN", url: "https://notefusion.studio/hymns/amazing-grace", kind: "hymn", confidence: 0.32, firstLine: "Amazing grace! how sweet the sound" },
  notesHeard: 16, tooShort: false, secondsHeard: 15,
};
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };

/** Every call the site makes to the API, answered from the demo data. Unknown reads are 404s. */
export async function mockApi(ctx, siteDir) {
  const grace = graceSheet(siteDir), hundredth = hundredthSheet(), result = hundredthResult();
  const lib = [grace, hundredth].map(({ id, title, key, tempoBpm, timeSignature, createdAtUtc }) => ({ id, title, key, tempoBpm, timeSignature, createdAtUtc, preview: [] }));
  await ctx.route(`${API}/**`, (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    if (p.startsWith("/api/web/events")) return route.fulfill({ status: 204, headers: CORS });
    if (p === "/api/me") return json(DEMO_USER);
    if (p === "/api/billing/my-subscription") return json(DEMO_PLAN);
    if (p === "/api/library") return json(lib);
    if (p === "/api/library/grace") return json(grace);
    if (p === "/api/library/hundredth") return json(hundredth);
    // Without the words: on a phone the words-under-notes grid scrolls sideways and shows one bar a row.
    if (p === "/api/shared/demo-sheet") return json({ ...hundredth, lyrics: "", sharedBy: "NoteFusion Demo" });
    if (p === "/api/transcriptions" && req.method() === "POST") return json({ jobId: "demo-job", status: "Pending", stage: "queued", queuePosition: 0 }, 202);
    // A fresh take has no parts yet (the hymnbook offer is only made then).
    if (p.startsWith("/api/transcriptions/jobs/")) return json({ jobId: "demo-job", status: "done", progress: 1, stage: "transcribing", result: { ...result, parts: null, partsMusicXml: "" } });
    if (p === "/api/hymns/identify") return json(IDENTIFY_FOUND);
    if (req.method() === "GET") return json({ code: "NOT_FOUND", message: "Not found." }, 404);
    return route.fulfill({ status: 204, headers: CORS });
  });
}

/** Ads, third-party analytics and Google sign-in never load: they would put someone else's pixels in the shot. */
const BLOCKED = /googlesyndication|googletagmanager|google-analytics|doubleclick|adservice|accounts\.google\.com|gstatic\.com\/recaptcha/;

const CDN = /^https:\/\/(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//;
async function relay(route) {
  try {
    const res = await fetch(route.request().url(), { headers: { "user-agent": route.request().headers()["user-agent"] || "Mozilla/5.0" } });
    const body = Buffer.from(await res.arrayBuffer());
    await route.fulfill({ status: res.status, headers: { "content-type": res.headers.get("content-type") || "application/octet-stream", "access-control-allow-origin": "*" }, body });
  } catch {
    await route.abort();
  }
}

// ── The shot ──────────────────────────────────────────────────────────────────

/** Loads a page and gives its requests a moment to settle; a page that keeps polling is not waited on forever. */
async function open(page, url) {
  await page.goto(url, { waitUntil: "load", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
}

async function prepare(page, scene, origin) {
  const def = SCENES[scene];
  if (def.job) {
    await open(page, origin + def.path);
    await page.setInputFiles("#file-input", { name: "old-hundredth.wav", mimeType: "audio/wav", buffer: Buffer.from("RIFF") });
    await page.waitForSelector("#result:not(.hidden)");
    await page.waitForSelector("#r-hymnbook:not(.hidden)", { timeout: 15_000 });
  } else if (def.sheet) {
    await open(page, origin + def.path);
    await page.waitForSelector(".recent-item", { state: "attached" });
    await page.evaluate((title) => [...document.querySelectorAll(".recent-item")].find((b) => b.textContent === title).click(), def.sheet === "grace" ? "Amazing Grace" : "Old Hundredth");
    await page.waitForSelector("#result:not(.hidden)");
  } else {
    await open(page, origin + def.path);
  }
  if (def.job || def.sheet) await page.waitForSelector("#sheet svg", { timeout: 30_000 });
  if (def.tab) {
    await page.click(`.result-tabs .tab[data-view="${def.tab}"]`);
    if (def.tab === "parts") await page.waitForSelector("#sheet-parts svg", { timeout: 30_000 });
  }
  if (def.tool) {
    await page.$eval(`.result-actions .act[data-tool="${def.tool}"]`, (b) => b.click());
    await page.waitForSelector("#tool-modal:not(.hidden)");
  }
  if (scene === "identify") {
    await page.waitForFunction(() => !!window.NfHymnIdentify);
    await page.evaluate((a) => window.NfHymnIdentify.render(a), IDENTIFY_FOUND);
    // The answer at the bottom of the screen, as much of the page's heading above it as fits.
    await page.$eval("#identify-result", (el) => { document.documentElement.style.scrollBehavior = "auto"; window.scrollTo(0, Math.max(0, el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 24)); });
  }
  if (scene === "shared-sheet") await page.waitForSelector("#sheet:not(.hidden)");
  if (def.sheet || def.job) {
    // The engraver sizes the staff to its box when it draws; a resize lets it redraw at the settled width.
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await page.waitForTimeout(1500);
    // The sheet, not the sidebar: the result card just under the sticky top bar.
    await page.evaluate(() => {
      document.documentElement.style.scrollBehavior = "auto";
      const r = document.getElementById("result");
      if (!r) return;
      const bars = [...document.querySelectorAll("header, .topbar, .app-topbar")].filter((el) => getComputedStyle(el).position === "sticky" || getComputedStyle(el).position === "fixed");
      const under = bars.reduce((m, el) => Math.max(m, el.getBoundingClientRect().height), 0);
      window.scrollTo(0, r.getBoundingClientRect().top + window.scrollY - under - 8);
    });
    // The sheet's frame scrolls on its own: bring the first staff to its top.
    await page.evaluate((sel) => {
      const svg = document.querySelector(`${sel} svg`);
      const staves = svg ? [...svg.querySelectorAll(".staffline, .vf-stave")] : [];
      if (!staves.length) return;
      const top = Math.min(...staves.map((s) => s.getBoundingClientRect().top));
      let el = svg.parentElement;
      while (el && el !== document.body) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) break;
        el = el.parentElement;
      }
      if (!el || el === document.body) return;
      // Anything pinned at the frame's top (the parts' Hear row) stays over the music: clear it too.
      const pinned = [...el.querySelectorAll("*")].filter((c) => getComputedStyle(c).position === "sticky").reduce((m, c) => Math.max(m, c.getBoundingClientRect().height), 0);
      el.scrollTop += top - el.getBoundingClientRect().top - pinned - 56;
    }, def.tab === "parts" ? "#sheet-parts" : "#sheet");
  }
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(1200);
}

/**
 * Takes the scene's screenshot, framed. Resolves { file, bytes, width, height, type }.
 * @param {{ scene: string, viewport?: "phone"|"desktop", theme?: "light"|"dark", out: string, siteDir?: string,
 *   executablePath?: string, relayCdn?: boolean, chromium?: object }} opts
 *   relayCdn  fetch the CDN files (fonts, the engraver) in Node rather than in the browser: for a sandbox whose
 *             HTTPS proxy the browser cannot use (run Node with NODE_USE_ENV_PROXY=1 there). Off on a runner.
 */
export async function shoot({ scene, viewport = "phone", theme = "dark", out, siteDir = SITE_DIR, executablePath, relayCdn = false, chromium }) {
  if (!SCENES[scene]) throw new Error(`Unknown scene "${scene}".`);
  const vp = VIEWPORTS[viewport];
  if (!chromium) ({ chromium } = await import("playwright-core"));
  const { server, origin } = await serveSite(siteDir);
  const browser = await chromium.launch({ executablePath: executablePath || undefined });
  try {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch,
      colorScheme: theme, reducedMotion: "reduce", locale: "en-GB", timezoneId: "Europe/London",
    });
    await ctx.route(BLOCKED, (r) => r.abort());
    if (relayCdn) await ctx.route(CDN, relay);
    await mockApi(ctx, siteDir);
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("nf.web.theme", t);
        localStorage.setItem("nf.web.onboarded", "1");
        localStorage.setItem("nf.web.source", "upload");
        localStorage.setItem("nf.web.tokens", JSON.stringify({ accessToken: "demo", refreshToken: "demo", expiresAt: "2099-01-01T00:00:00Z" }));
        localStorage.setItem("nf.web.notify.asked", "1");
      } catch { /* private mode */ }
    }, theme);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await prepare(page, scene, origin);
    const raw = await page.screenshot({ type: "png" });
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor || "#111");
    if (errors.length) console.warn(`[shoot] page errors on ${scene}: ${errors.join("; ").slice(0, 400)}`);

    // The frame: the screenshot on its own background, rounded, at a size X shows whole.
    const frame = await browser.newPage({ viewport: vp.frame, deviceScaleFactor: 1 });
    const pad = viewport === "phone" ? 56 : 48;
    await frame.setContent(`<!doctype html><html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:${bg}">
      <img src="data:image/png;base64,${raw.toString("base64")}" style="max-width:calc(100vw - ${pad * 2}px);max-height:calc(100vh - ${pad * 2}px);border-radius:${viewport === "phone" ? 36 : 18}px;box-shadow:0 0 0 1px rgba(127,127,127,.28),0 24px 64px rgba(0,0,0,.35)">
      </body></html>`);
    await frame.waitForFunction(() => document.images[0].complete);
    let bytes = await frame.screenshot({ type: "png" });
    let file = out, type = "image/png";
    if (bytes.length > MAX_BYTES) {
      bytes = await frame.screenshot({ type: "jpeg", quality: 85 });
      file = out.replace(/\.png$/i, ".jpg");
      type = "image/jpeg";
    }
    if (bytes.length > MAX_BYTES) throw new Error(`The screenshot is ${bytes.length} bytes, over X's 5 MB.`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    return { file, bytes: bytes.length, width: vp.frame.width, height: vp.frame.height, type };
  } finally {
    await browser.close();
    server.close();
  }
}
