// Draws film.html frame by frame in headless Chromium and encodes it with the score.
//
//   node render.cjs --stills        # build/stills: the key moments, and build/contact.jpg, one sheet of them
//   node render.cjs                 # build/one-more-stop.mp4 (1080x1920, 30 fps, H.264 + AAC)
//
// Run `python3 score.py` first: the film's sound is build/score.wav.
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { chromium } = require("playwright");

const HERE = __dirname;
const ROOT = path.resolve(HERE, "../../..");
const BUILD = path.join(HERE, "build");
const T = JSON.parse(fs.readFileSync(path.join(HERE, "timeline.json"), "utf8"));
const TYPES = { ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".png": "image/png", ".woff2": "font/woff2", ".js": "text/javascript" };

/** The repo, served read-only on localhost: the film reads the site's own art from /web-site/assets. */
function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    const file = path.normalize(path.join(ROOT, url));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/** The moments a contact sheet shows: the first and last frames, every hand-off and either side of it. */
function keyMoments() {
  const m = [0, 1.6, T.tap - 0.05, T.tap + 0.25, T.chips[2] + 0.1, T.stars + 0.2, T.cardBack + 0.2, T.stops[1] + 0.1,
    T.chest + 0.15, T.stops[7] - 0.2, T.build + 0.8, T.collapse - 0.05, T.drop + 0.05, T.drop + 0.35, T.drop + 1.2,
    T.streak + 0.9, T.markFlip + 0.2, T.markFlip + 0.5, T.markFlip + 1.6, T.duration - 1 / T.fps];
  return m.map((t) => Math.round(t * T.fps) / T.fps);
}

(async () => {
  const stills = process.argv.includes("--stills");
  fs.mkdirSync(BUILD, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => errors.push("failed: " + r.url()));
  await page.goto(`http://127.0.0.1:${server.address().port}/design/motion/one-more-stop/film.html`);
  await page.waitForFunction(() => window.READY === true, null, { timeout: 30000 });
  const stage = await page.$("#stage");
  const shot = async (t, file) => {
    await page.evaluate((x) => window.render(x), t);
    return stage.screenshot(file ? { path: file, type: "jpeg", quality: 92 } : { type: "jpeg", quality: 95 });
  };

  if (stills) {
    const dir = path.join(BUILD, "stills");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const moments = keyMoments();
    for (let i = 0; i < moments.length; i++) await shot(moments[i], path.join(dir, String(i).padStart(2, "0") + ".jpg"));
    // One sheet, 5 x 4, each still labelled with its time.
    execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", "1", "-i", path.join(dir, "%02d.jpg"),
      "-vf", "scale=270:480,tile=10x2:padding=6:margin=6:color=0x202020", "-frames:v", "1", path.join(BUILD, "contact.jpg")]);
    fs.writeFileSync(path.join(dir, "times.txt"), moments.map((t, i) => `${String(i).padStart(2, "0")} ${t.toFixed(2)}s`).join("\n") + "\n");
    console.log("stills:", moments.length, "contact:", path.join(BUILD, "contact.jpg"));
  } else {
    const frames = Math.round(T.duration * T.fps);
    const out = path.join(BUILD, "one-more-stop.mp4");
    const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(T.fps), "-c:v", "mjpeg", "-i", "-",
      "-i", path.join(BUILD, "score.wav"), "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-pix_fmt", "yuv420p",
      "-profile:v", "high", "-movflags", "+faststart",
      // AAC's encode lifts the true peak about 2 dB: limited here so the file measures -14 LUFS, <= -1 dBTP.
      "-af", "alimiter=limit=0.70:level=false:attack=1:release=40", "-c:a", "aac", "-b:a", "192k", "-shortest", out], { stdio: ["pipe", "inherit", "inherit"] });
    for (let f = 0; f < frames; f++) {
      const buf = await shot(f / T.fps);
      if (!ff.stdin.write(buf)) await new Promise((ok) => ff.stdin.once("drain", ok));
      if (f % 60 === 0) process.stderr.write(`frame ${f}/${frames}\n`);
    }
    ff.stdin.end();
    await new Promise((ok, no) => ff.on("close", (c) => (c === 0 ? ok() : no(new Error("ffmpeg " + c)))));
    console.log("film:", out);
  }
  if (errors.length) console.error("page problems:\n" + errors.join("\n"));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
