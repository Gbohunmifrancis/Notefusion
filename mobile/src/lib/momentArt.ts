/**
 * The reward moments' drawings: the mirror of the web's `web-site/assets/moment-art.js` (keep the two in step), drawn
 * through `lib/svgCanvas.ts` and played by `components/practice/Moments.tsx`. Six small scenes, each on its own Night
 * card: stars (Playful's 1-3 landing), streak (the flame catching, the day count rolling on), goal (the week's ring
 * closing on a mint tick), combo (a run in tune and its ×N), musicbox (a unit or grade finished) and doh (Doh leaping
 * for joy, from the Practice art's own poses).
 *
 * Each piece is { width, height (its card, at full size), ms (how long it plays), draw(c, t, values) }: draw paints the
 * frame at t seconds in the card's own coordinates. Pure: tested in `momentArt.test.ts`.
 */

import type { MomentPiece, MomentValues } from "./practiceMoments";
import type { MomentCtx, Paint } from "./svgCanvas";

let TAU = Math.PI * 2;
let FONT = ' Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// ── Shapes: each starts a new path on the context, centred on the origin ──
function circle(c: MomentCtx, r: number) { c.beginPath(); c.arc(0, 0, Math.max(0, r), 0, TAU); }
function ellipse(c: MomentCtx, rx: number, ry: number) { c.beginPath(); c.ellipse(0, 0, Math.max(0, rx), Math.max(0, ry), 0, 0, TAU); }
function rrect(c: MomentCtx, w: number, h: number, rad: number) {
  let x0 = -w / 2, y0 = -h / 2, x1 = w / 2, y1 = h / 2, k = rad * 0.4477;
  c.beginPath();
  c.moveTo(x0 + rad, y0); c.lineTo(x1 - rad, y0);
  c.bezierCurveTo(x1 - k, y0, x1, y0 + k, x1, y0 + rad); c.lineTo(x1, y1 - rad);
  c.bezierCurveTo(x1, y1 - k, x1 - k, y1, x1 - rad, y1); c.lineTo(x0 + rad, y1);
  c.bezierCurveTo(x0 + k, y1, x0, y1 - k, x0, y1 - rad); c.lineTo(x0, y0 + rad);
  c.bezierCurveTo(x0, y0 + k, x0 + k, y0, x0 + rad, y0);
  c.closePath();
}
/** A four-point twinkle. */
function sparkle(c: MomentCtx, r: number) {
  let k = 0.15;
  c.beginPath();
  c.moveTo(0, -r);
  c.bezierCurveTo(0, -r * k, r * k, 0, r, 0);
  c.bezierCurveTo(r * k, 0, 0, r * k, 0, r);
  c.bezierCurveTo(0, r * k, -r * k, 0, -r, 0);
  c.bezierCurveTo(-r * k, 0, 0, -r * k, 0, -r);
  c.closePath();
}
/** A quaver, its head on the origin, k its scale. */
function quaver(c: MomentCtx, k: number) {
  let rx = 9 * k, ry = 6.5 * k, sx = 7.2 * k;
  c.beginPath();
  c.ellipse(0, 0, rx, ry, -0.35, 0, TAU);
  c.moveTo(sx - 2.6 * k, -2 * k); c.lineTo(sx - 2.6 * k, -34 * k); c.lineTo(sx, -34 * k); c.lineTo(sx, -2 * k); c.closePath();
  c.moveTo(sx - 2.6 * k, -34 * k);
  c.bezierCurveTo(sx + 2 * k, -26 * k, sx + 14 * k, -22 * k, sx + 10 * k, -10 * k);
  c.bezierCurveTo(sx + 12 * k, -20 * k, sx + 4 * k, -24 * k, sx, -26 * k);
  c.closePath();
}

// ── Paint ──
function rgba(r: number, g: number, b: number, a?: number) { return "rgba(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(b) + "," + (a === undefined ? 1 : a / 255) + ")"; }
function fill(c: MomentCtx, style: Paint) { c.fillStyle = style; c.fill(); }
function stroke(c: MomentCtx, style: Paint, width: number) { c.strokeStyle = style; c.lineWidth = width; c.lineCap = "round"; c.lineJoin = "round"; c.stroke(); }
/** A vertical gradient from y0 to y1; stops are [position, r, g, b, a?]. */
function vgrad(c: MomentCtx, y0: number, y1: number, stops: number[][]) {
  let g = c.createLinearGradient(0, y0, 0, y1);
  stops.forEach(function (s) { g.addColorStop(s[0], rgba(s[1], s[2], s[3], s[4])); });
  return g;
}
/** A soft round glow of radius r that fades to nothing at its edge, laid on as light. */
function glow(c: MomentCtx, r: number, red: number, green: number, blue: number, alpha: number) {
  let g = c.createRadialGradient(0, 0, 0, 0, 0, Math.max(0.01, r));
  g.addColorStop(0, rgba(red, green, blue, alpha)); g.addColorStop(1, rgba(red, green, blue, 0));
  c.save(); c.globalCompositeOperation = "screen"; circle(c, r); fill(c, g); c.restore();
}
/** A ring laid on as light. */
function ring(c: MomentCtx, r: number, width: number, color: string) {
  c.save(); c.globalCompositeOperation = "lighter"; circle(c, r); stroke(c, color, width); c.restore();
}

// ── Transforms, time and chance ──
function tf(c: MomentCtx, x: number, y: number, s: number, r: number) { let cs = Math.cos(r) * s, sn = Math.sin(r) * s; c.transform(cs, sn, -sn, cs, x, y); }
function tfs(c: MomentCtx, x: number, y: number, sx: number, sy: number, r: number) { let cs = Math.cos(r), sn = Math.sin(r); c.transform(cs * sx, sn * sx, -sn * sy, cs * sy, x, y); }
function fade(c: MomentCtx, o: number) { c.globalAlpha *= Math.max(0, Math.min(1, o)); }
function clamp(x: number, a: number, b: number) { return Math.max(a, Math.min(b, x)); }
function easeOut(t: number) { let u = 1 - clamp(t, 0, 1); return 1 - u * u * u; }
function easeInOut(t: number) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
/** 0 before t = 0, then a spring up to 1 that overshoots and settles. */
function spring(t: number, damp?: number, freq?: number) { return t <= 0 ? 0 : 1 - Math.exp(-(damp || 7) * t) * Math.cos((freq || 15) * t); }
/** 1 at rest, a jolt that rings out from t = 0: a bump on something already there. */
function bump(t: number, size: number) { return t <= 0 ? 1 : 1 + size * Math.exp(-8 * t) * Math.cos(18 * t); }
function rand(seed: number) { let x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }
/** The fade out over a moment's last 0.35 s. */
function fadeOut(t: number, period: number) { return t > period - 0.35 ? Math.max(0, (period - t) / 0.35) : 1; }
function num(values: MomentValues, name: string, dflt: number): number { const v = Number(values[name]); return values[name] !== undefined && values[name] !== "" && isFinite(v) ? v : dflt; }

/** Words centred on (x, y) in the moment's heavy Geist. */
function say(c: MomentCtx, text: string, size: number, color: string, x: number, y: number, scale?: number) {
  c.save();
  c.translate(x, y); if (scale !== undefined) c.scale(scale, scale);
  c.font = "800 " + size + "px" + FONT; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillStyle = color; c.fillText(text, 0, 0);
  c.restore();
}
/** The moment's own card: the app's Night surface with a hairline, so its white type reads on either theme. */
function panel(c: MomentCtx, w: number, h: number) {
  c.save(); c.translate(w / 2, h / 2);
  rrect(c, w - 2, h - 2, 28); fill(c, rgba(14, 19, 32, 246)); stroke(c, rgba(232, 237, 247, 22), 1.5);
  c.restore();
}

// ── stars: the take's stars land one after another; the slots of those not earned stay empty ──
let STAR = [[0, -24], [6.5, -8.9], [22.8, -7.4], [10.5, 3.4], [14.1, 19.4], [0, 11], [-14.1, 19.4], [-10.5, 3.4], [-22.8, -7.4], [-6.5, -8.9]];
function star(c: MomentCtx, k: number) {
  c.beginPath();
  STAR.forEach(function (v, i) { if (i === 0) c.moveTo(v[0] * k, v[1] * k); else c.lineTo(v[0] * k, v[1] * k); });
  c.closePath();
}
let STARS_LAND = [0.3, 0.7, 1.1], STARS_POS = [[-128, 22, 0.78], [0, -6, 1], [128, 22, 0.78]];
function drawStars(c: MomentCtx, t: number, values: MomentValues) {
  let P = 3.0, W = 440, H = 240, earned = clamp(Math.round(num(values, "stars", 3)), 1, 3);
  c.save(); fade(c, fadeOut(t, P));
  panel(c, W, H);
  c.translate(W / 2, H / 2 + 6);
  for (let i = 0; i < 3; i++) {
    let x = STARS_POS[i][0], y = STARS_POS[i][1], sc = STARS_POS[i][2], k = sc * 2.3, since = t - STARS_LAND[i];
    c.save(); c.translate(x, y); star(c, k); fill(c, rgba(255, 255, 255, 18)); stroke(c, rgba(255, 255, 255, 40), 6); c.restore();
    if (i >= earned || since <= 0) continue;
    // A warm glow under the star, brightest as it lands.
    c.save(); c.translate(x, y); c.scale(sc, sc); fade(c, 0.5 + 0.5 * Math.exp(-3 * since)); glow(c, 70, 251, 146, 60, 150); c.restore();
    // The ring and sparkles thrown off as it lands.
    if (since < 0.6) {
      let q = since / 0.6;
      c.save(); c.translate(x, y); fade(c, 1 - q); ring(c, (30 + 70 * easeOut(q)) * sc, 7 * (1 - q) + 0.5, rgba(255, 214, 170)); c.restore();
      for (let sp = 0; sp < 6; sp++) {
        let th = sp / 6 * TAU + i + 1, d = (40 + 70 * q) * sc;
        c.save(); tf(c, x + Math.cos(th) * d, y + Math.sin(th) * d, 1, q * 2); fade(c, 1 - q);
        sparkle(c, 15 * (1 - q * q) * sc + 1); fill(c, rgba(255, 241, 224)); c.restore();
      }
    }
    c.save(); tf(c, x, y, spring(since), -0.5 * Math.exp(-6 * since) * Math.cos(10 * since));
    star(c, k);
    let g = c.createLinearGradient(0, -60, 0, 50); g.addColorStop(0, rgba(255, 197, 138)); g.addColorStop(1, rgba(249, 115, 22));
    fill(c, g); stroke(c, rgba(194, 65, 12), 8);
    // The shine, as the 2D art draws it.
    c.beginPath(); c.moveTo(-9 * k, -4 * k); c.lineTo(-3 * k, -5 * k); c.lineTo(0, -13 * k); stroke(c, rgba(255, 255, 255, 180), 6);
    c.restore();
  }
  c.restore();
}

// ── streak: the grey flame catches, bursts and settles burning, embers rise, the day count rolls on ──
// The 2D flame (flame-active.svg, 64x64), base at the origin; points above the waist sway with wob.
let FLAME_OUTER = [[0, 32, 4], [1, 37, 15, 50, 22, 50, 40], [1, 50, 53, 42, 60, 32, 60], [1, 22, 60, 14, 53, 14, 41], [1, 14, 32, 18, 27, 23, 22], [1, 23, 29, 25, 32, 29, 33], [1, 28, 22, 30, 12, 32, 4]];
let FLAME_INNER = [[0, 32, 30], [1, 36, 37, 41, 40, 41, 47], [1, 41, 54, 37, 58, 32, 58], [1, 27, 58, 23, 54, 23, 47], [1, 23, 42, 26, 39, 29, 36], [1, 30, 39, 31, 40, 32, 40], [1, 31, 37, 31, 34, 32, 30]];
function flame(c: MomentCtx, cmds: number[][], wob: number, lean: number) {
  function px(x: number, y: number) { let up = Math.max(0, 36 - y) / 32; return x - 32 + wob * up * 4 + lean * up * up * 6; }
  c.beginPath();
  cmds.forEach(function (m) {
    if (m[0] === 0) c.moveTo(px(m[1], m[2]), m[2] - 60);
    else c.bezierCurveTo(px(m[1], m[2]), m[2] - 60, px(m[3], m[4]), m[4] - 60, px(m[5], m[6]), m[6] - 60);
  });
  c.closePath();
}
function drawStreak(c: MomentCtx, t: number, values: MomentValues) {
  let P = 3.6, W = 360, H = 360, IGNITE = 0.8, ROLL = 1.0, cx = W / 2, base = 212;
  let lit = easeOut((t - IGNITE) / 0.3), since = t - IGNITE, days = Math.max(1, Math.round(num(values, "days", 7)));
  c.save(); fade(c, fadeOut(t, P));
  panel(c, W, H);
  // The glow, a flash as it catches and a warm breath after.
  let flash = since > 0 ? Math.exp(-4 * since) : 0;
  c.save(); c.translate(cx, base - 70); fade(c, lit * (0.45 + 0.55 * flash + 0.06 * Math.sin(t * 6))); glow(c, 150, 251, 146, 60, 170); c.restore();
  // The ring thrown off as it catches.
  if (since > 0 && since < 0.5) {
    let q = since / 0.5;
    c.save(); c.translate(cx, base - 70); fade(c, 1 - q); ring(c, 60 + 110 * easeOut(q), 6 * (1 - q) + 0.5, rgba(255, 214, 160)); c.restore();
  }
  // The flame: grey while the day is unsung, alight once sung; a spring as it catches, a flicker while it burns.
  let wob = Math.sin(t * 7.3) * 0.6 + Math.sin(t * 11.1) * 0.4, lean = Math.sin(t * 2.1) * 0.5;
  let s = since <= 0 ? 0.82 * 2.7 : (0.82 + 0.18 * spring(since, 6, 13)) * 2.7 * (1 + 0.03 * Math.sin(t * 9) * lit);
  c.save(); c.translate(cx, base); c.scale(s * (1 - 0.02 * Math.sin(t * 9) * lit), s);
  if (lit < 1) {
    c.save(); fade(c, 1 - lit);
    flame(c, FLAME_OUTER, wob * lit, lean * lit); fill(c, vgrad(c, -56, 0, [[0, 176, 184, 200], [1, 120, 130, 150]]));
    flame(c, FLAME_INNER, wob * lit * 0.7, lean * lit); fill(c, vgrad(c, -30, 0, [[0, 214, 220, 230], [1, 160, 168, 184]]));
    c.restore();
  }
  if (lit > 0) {
    c.save(); fade(c, lit);
    flame(c, FLAME_OUTER, wob * lit, lean * lit); fill(c, vgrad(c, -56, 0, [[0, 255, 200, 97], [0.6, 251, 146, 60], [1, 255, 77, 94]]));
    flame(c, FLAME_INNER, wob * lit * 0.7, lean * lit); fill(c, vgrad(c, -30, 0, [[0, 255, 244, 209], [1, 253, 186, 116]]));
    c.restore();
  }
  c.beginPath(); c.moveTo(-10, -20); c.bezierCurveTo(-10, -25, -8, -28, -6, -30); stroke(c, rgba(255, 255, 255, 140), 2.5);
  c.restore();
  // Embers, rising and swaying, while it burns.
  if (since > 0) {
    for (let i = 1; i <= 16; i++) {
      let life = 1.3 + rand(i) * 0.8, age = since - rand(i * 7) * life;
      if (age <= 0) continue;
      age = age % life;
      let k = age / life;
      c.save();
      c.translate(cx + (rand(i * 3) - 0.5) * 90 + Math.sin(age * 4 + i) * 12, base - 30 - k * (150 + rand(i * 5) * 60));
      fade(c, (1 - k) * lit); circle(c, (1 - k) * (2.5 + rand(i * 11) * 3.5)); fill(c, rgba(255, 190 + Math.floor(rand(i) * 50), 110));
      c.restore();
    }
  }
  // The count rolls inside its own window, like an odometer: the old day up and away, the new one springing in.
  c.save(); c.beginPath(); c.rect(0, 218, W, 88); c.clip();
  let roll = clamp((t - ROLL) / 0.28, 0, 1), ink = rgba(255, 255, 255);
  if (roll < 1 && days > 1) { c.save(); fade(c, 1 - roll); say(c, String(days - 1), 92, ink, cx, 262 - 80 * easeOut(roll)); c.restore(); }
  if (t > ROLL) {
    c.save(); fade(c, clamp((t - ROLL) / 0.12, 0, 1));
    say(c, String(days), 92, ink, cx, 262 + 80 * (1 - spring(t - ROLL, 7, 14)), 1 + 0.12 * Math.exp(-5 * (t - ROLL)));
    c.restore();
  }
  c.restore();
  say(c, days === 1 ? "day streak begun" : "day streak", 26, rgba(253, 186, 116), cx, 324);
  c.restore();
}

// ── goal: today's day pours into the week's ring; when it closes, a flash and a mint tick ──
function drawGoal(c: MomentCtx, t: number, values: MomentValues) {
  let P = 3.6, W = 360, H = 380, FILL0 = 0.5, FILL1 = 1.4, DONE = 1.45;
  let target = Math.max(1, Math.round(num(values, "target", 5)));
  let done = clamp(Math.round(num(values, "done", target)), 1, target), met = done >= target;
  let cx = W / 2, cy = H / 2 - 6, R = 104, q = easeInOut((t - FILL0) / (FILL1 - FILL0));
  let p = (done - 1 + q) / target, since = met ? t - DONE : -1, i, a;
  c.save(); fade(c, fadeOut(t, P));
  panel(c, W, H);
  c.save(); c.translate(cx, cy); c.scale(bump(since, 0.07), bump(since, 0.07));
  // The ring: a quiet track with a tick a day, the week's days in blue, a flash as it closes.
  if (since > 0) { c.save(); fade(c, 0.6 * Math.exp(-2.5 * since) + 0.25); glow(c, R + 40, 47, 123, 255, 120); c.restore(); }
  circle(c, R); stroke(c, rgba(255, 255, 255, 22), 24);
  for (i = 1; i < target; i++) {
    a = -Math.PI / 2 + TAU * i / target;
    c.save(); c.translate(Math.cos(a) * R, Math.sin(a) * R); circle(c, 2.5); fill(c, rgba(255, 255, 255, 60)); c.restore();
  }
  if (p > 0.001) {
    let band = c.createLinearGradient(-R, -R, R, R); band.addColorStop(0, rgba(125, 179, 255)); band.addColorStop(1, rgba(47, 123, 255));
    c.beginPath(); c.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, p)); stroke(c, band, 24);
  }
  // The tip catches the light while it moves.
  if (t > FILL0 && t < FILL1 + 0.1) {
    a = -Math.PI / 2 + TAU * p;
    c.save(); c.translate(Math.cos(a) * R, Math.sin(a) * R); glow(c, 30, 200, 225, 255, 200); c.restore();
  }
  if (since > 0 && since < 0.3) {
    c.save(); fade(c, 0.55 * (1 - since / 0.3)); ring(c, R, 24, rgba(255, 255, 255)); c.restore();
  }
  // The middle: the days so far, stepping on as the ring fills; the mint tick once it closes.
  let shown = t >= (FILL0 + FILL1) / 2 ? done : done - 1, out = met ? clamp(since / 0.15, 0, 1) : 0;
  if (out < 1) {
    c.save(); fade(c, 1 - out);
    say(c, String(shown), 64, rgba(255, 255, 255), 0, -10, (1 - 0.4 * out) * bump(t - (FILL0 + FILL1) / 2, 0.18));
    say(c, "of " + target + (target === 1 ? " day" : " days"), 20, rgba(156, 194, 255), 0, 36, 1 - 0.4 * out);
    c.restore();
  }
  if (met && since > 0.05) {
    let s = spring(since - 0.05, 6, 14), drawn = clamp((since - 0.08) / 0.22, 0, 1);
    c.save(); c.scale(s, s);
    circle(c, 56); fill(c, vgrad(c, -56, 56, [[0, 110, 236, 180], [1, 61, 220, 151]]));
    if (drawn > 0) {
      c.beginPath(); c.moveTo(-24, 2);
      if (drawn <= 0.4) c.lineTo(-24 + 17 * drawn / 0.4, 2 + 17 * drawn / 0.4);
      else { let e = (drawn - 0.4) / 0.6; c.lineTo(-7, 19); c.lineTo(-7 + 33 * e, 19 - 35 * e); }
      stroke(c, rgba(255, 255, 255), 11);
    }
    c.restore();
  }
  // Sparkles thrown out round the ring as it closes.
  if (since > 0 && since < 0.9) {
    let k = since / 0.9;
    for (i = 0; i < 12; i++) {
      a = i / 12 * TAU + 0.2;
      let d = R + 18 + 50 * easeOut(k);
      c.save(); tf(c, Math.cos(a) * d, Math.sin(a) * d, 1, k * 3); fade(c, 1 - k); sparkle(c, 12 * (1 - k * k) + 2); fill(c, rgba(255, 255, 255)); c.restore();
    }
  }
  c.restore();
  // Today's day as it arrives: a chip that pops in over the ring and is drawn down into it as it fills.
  if (t > 0.15 && t < FILL1) {
    let cs = spring(t - 0.15) * (1 - easeInOut((q - 0.55) / 0.45));
    c.save(); c.translate(cx, cy - R - 4 + 40 * q); c.scale(cs, cs);
    rrect(c, 100, 40, 20); fill(c, rgba(47, 123, 255)); stroke(c, rgba(14, 19, 32), 4);
    say(c, "+1 day", 20, rgba(255, 255, 255), 0, 0);
    c.restore();
  }
  // What it means, under the ring.
  if (met) { c.save(); fade(c, clamp((since - 0.2) / 0.3, 0, 1)); say(c, "Week goal met!", 24, rgba(140, 245, 200), cx, H - 34); c.restore(); }
  else say(c, "This week", 20, rgba(156, 194, 255), cx, H - 34);
  c.restore();
}

// ── combo: the run's marks land mint one after another; the ×N badge bumps with each and runs hot from ×5 ──
function drawCombo(c: MomentCtx, t: number, values: MomentValues) {
  let P = 3.8, W = 460, H = 230, FIRST = 0.3, SPAN = 2.0, MAX_DOTS = 10;
  let run = Math.max(1, Math.round(num(values, "run", 8))), perfect = num(values, "perfect", 1) >= 0.5;
  let dots = Math.min(run, MAX_DOTS), step = Math.min(0.28, SPAN / dots), gap = Math.min(38, 290 / dots);
  let rad = Math.min(13, gap * 0.36), x0 = 30 + (290 - gap * (dots - 1)) / 2 - 10, y = 140, lit = 0, i, d, q, s;
  c.save(); fade(c, fadeOut(t, P));
  panel(c, W, H);
  for (i = 1; i <= dots; i++) {
    d = t - (FIRST + (i - 1) * step);
    if (d > 0) lit = i;
    c.save(); c.translate(x0 + (i - 1) * gap, y);
    circle(c, rad); stroke(c, rgba(255, 255, 255, 50), 3);
    if (d > 0) {
      if (d < 0.5) { q = d / 0.5; c.save(); fade(c, 1 - q); ring(c, rad + 22 * easeOut(q), 4 * (1 - q) + 0.5, rgba(140, 245, 200)); c.restore(); }
      s = spring(d, 7, 16);
      c.save(); c.scale(s, s);
      glow(c, rad * 1.6, 61, 220, 151, 120);
      circle(c, rad); fill(c, vgrad(c, -rad, rad, [[0, 130, 240, 190], [1, 61, 220, 151]]));
      c.beginPath(); c.moveTo(-rad * 0.46, -rad * 0.38); c.bezierCurveTo(-rad * 0.38, -rad * 0.6, -rad * 0.15, -rad * 0.7, rad * 0.08, -rad * 0.7);
      stroke(c, rgba(255, 255, 255, 170), 2.5);
      c.restore();
    }
    c.restore();
  }
  // The badge: ×n, a bump on every mark, blue up to ×4 and hot orange from ×5.
  if (lit > 0) {
    let n = lit === dots ? run : Math.round(run * lit / dots), hot = n >= 5, bx = 384;
    d = t - (FIRST + (lit - 1) * step);
    s = spring(t - FIRST, 6, 14) * bump(d, 0.22);
    c.save(); c.translate(bx, y); c.scale(s, s);
    if (hot) { glow(c, 58, 251, 146, 60, 150); circle(c, 38); fill(c, vgrad(c, -38, 38, [[0, 255, 200, 97], [0.6, 251, 146, 60], [1, 249, 115, 22]])); }
    else { circle(c, 38); fill(c, vgrad(c, -38, 38, [[0, 125, 179, 255], [1, 47, 123, 255]])); }
    circle(c, 38); stroke(c, rgba(255, 255, 255, 60), 3);
    say(c, "×" + n, n >= 10 ? 25 : 30, rgba(255, 255, 255), 0, -2);
    c.restore();
    say(c, "in tune", 15, rgba(156, 194, 255), bx, y + 56);
  }
  // The headline once every mark has landed: a clean take, or a good run in one.
  let landed = t - (FIRST + (dots - 1) * step) - 0.15;
  if (landed > 0) {
    s = spring(landed, 6, 13);
    c.save(); c.translate(186, 62); c.scale(s, s); c.rotate(-0.04);
    say(c, perfect ? "Perfect run!" : "On a roll!", 34, rgba(140, 245, 200), 0, 0);
    c.restore();
    if (landed < 0.9) {
      q = landed / 0.9;
      for (i = 0; i < 10; i++) {
        let a = i / 10 * TAU;
        c.save(); tf(c, 186 + Math.cos(a) * (110 + 50 * q), 62 + Math.sin(a) * (26 + 22 * q), 1, q * 3); fade(c, 1 - q);
        sparkle(c, 10 * (1 - q * q) + 2); fill(c, rgba(255, 255, 255)); c.restore();
      }
    }
  }
  c.restore();
}

// ── musicbox: a unit or grade finished; the box bobs, shakes three times and bursts open, notes fly out ──
let BOX_SHAKES = [0.45, 0.8, 1.15];
// Where each note lands (from the box's top), its colour, size and delay.
let BOX_NOTES = [
  { x: -120, y: -150, c: [125, 179, 255], k: 1.15, delay: 0 },
  { x: -55, y: -205, c: [255, 227, 179], k: 1.3, delay: 0.05 },
  { x: 15, y: -232, c: [61, 220, 151], k: 1.45, delay: 0.02 },
  { x: 85, y: -196, c: [253, 186, 116], k: 1.25, delay: 0.08 },
  { x: 140, y: -140, c: [255, 255, 255], k: 1.05, delay: 0.11 }
];
function drawMusicbox(c: MomentCtx, t: number, values: MomentValues) {
  let P = 4.0, W = 400, H = 440, OPEN = 1.5, cx = W / 2, base = 404, since = t - OPEN, i;
  c.save(); fade(c, fadeOut(t, P));
  panel(c, W, H);
  // The light fanning up from inside once it is open.
  if (since > 0) {
    let o = easeOut(since / 0.4);
    c.save(); c.translate(cx, base - 118); fade(c, o);
    glow(c, 190, 255, 236, 200, 110);
    let rays = c.createRadialGradient(0, 0, 0, 0, 0, 260); rays.addColorStop(0, rgba(255, 240, 210, 120)); rays.addColorStop(1, rgba(255, 240, 210, 0));
    c.globalCompositeOperation = "screen";
    for (i = 0; i < 9; i++) {
      let a = -Math.PI / 2 + (i - 4) * 0.27 + Math.sin(t * 0.8) * 0.05;
      c.beginPath(); c.moveTo(0, 0);
      c.lineTo(Math.cos(a - 0.06) * 260 * o, Math.sin(a - 0.06) * 260 * o); c.lineTo(Math.cos(a + 0.06) * 260 * o, Math.sin(a + 0.06) * 260 * o);
      c.closePath(); fill(c, rays);
    }
    c.restore();
  }
  // The box: a bob at rest, three shakes that grow, a squash as it opens.
  let rot = 0, sx = 1, sy = 1, lift = Math.sin(t * 3) * 3;
  BOX_SHAKES.forEach(function (at, k) {
    let d = t - at;
    if (d > 0 && d < 0.3) {
      let env = Math.sin(d / 0.3 * Math.PI);
      rot += Math.sin(d * 55) * 0.05 * env * (0.9 + 0.3 * k);
      lift -= 10 * env * (0.9 + 0.3 * k);
    }
  });
  if (since > 0) { let sq = Math.exp(-6 * since) * Math.cos(14 * since); sx = 1 + 0.12 * sq; sy = 1 - 0.12 * sq; lift = 0; }
  else if (t > OPEN - 0.15) { let pre = (t - (OPEN - 0.15)) / 0.15; sx = 1 + 0.08 * pre; sy = 1 - 0.1 * pre; }
  c.save(); c.translate(cx, base + 4); c.scale(1 + lift / 200, 1); ellipse(c, 118, 14); fill(c, rgba(0, 0, 0, 90)); c.restore();
  let open = since > 0 ? spring(since, 5, 11) : 0;
  c.save(); c.translate(cx, base + lift); tfs(c, 0, 0, sx, sy, rot); c.translate(0, -64);
  // The body, its middle at the origin.
  rrect(c, 220, 128, 22); fill(c, vgrad(c, -64, 64, [[0, 79, 145, 255], [1, 30, 79, 208]])); stroke(c, rgba(23, 54, 150), 6);
  // Inside, seen once the lid is up: dark, lit from within.
  if (open > 0) {
    c.save(); c.translate(0, -60); fade(c, open);
    rrect(c, 206, 26, 12); fill(c, rgba(12, 26, 70));
    c.save(); rrect(c, 206, 26, 12); c.clip(); glow(c, 110, 255, 236, 200, 150); c.restore();
    c.restore();
  }
  // The front plate, a quaver on it, and the band where the lid sits.
  rrect(c, 112, 68, 14); fill(c, rgba(227, 238, 255));
  c.save(); c.translate(-6, 14); quaver(c, 1.05); fill(c, rgba(47, 123, 255)); c.restore();
  rrect(c, 232, 16, 8); fill(c, rgba(23, 54, 150));
  // The lid: closed it sits on the top; opening, it flips back on its hinge, so it rises and shows less of itself.
  c.save(); c.translate(0, -92 - 46 * open); c.scale(1 - 0.06 * open, Math.max(0.01, 1 - 0.62 * open)); c.rotate(-0.06 * open);
  rrect(c, 236, 60, 22); fill(c, vgrad(c, -30, 30, [[0, 125, 179, 255], [1, 47, 123, 255]])); stroke(c, rgba(23, 54, 150), 6);
  c.beginPath(); c.moveTo(-92, -14); c.lineTo(60, -14); stroke(c, rgba(255, 255, 255, 110), 6);
  c.restore();
  c.restore();
  // The notes, out in arcs, turning as they fly.
  BOX_NOTES.forEach(function (n, j) {
    let d = since - n.delay;
    if (d <= 0) return;
    let q = easeOut(d / 0.65), idx = j + 1;
    let x = cx + n.x * q, y = base - 120 + n.y * 0.68 * q - 60 * Math.sin(q * Math.PI) * 0.3 + Math.sin(t * 2 + idx) * 4 * q;
    c.save(); tf(c, x, y, spring(d, 6, 12) * n.k, (1 - q) * (idx % 2 === 0 ? 1.6 : -1.6) + Math.sin(t * 3 + idx) * 0.08);
    glow(c, 40, n.c[0], n.c[1], n.c[2], 140);
    quaver(c, 1.6); fill(c, rgba(n.c[0], n.c[1], n.c[2]));
    c.restore();
  });
  // What was finished, popping up above it.
  if (since > 0.35) {
    let s = spring(since - 0.35, 6, 13);
    c.save(); c.translate(cx, 50); c.scale(s, s);
    say(c, String((values && values.label) || "Unit done!"), 40, rgba(255, 255, 255), 0, 0);
    c.restore();
  }
  c.restore();
}

// ── doh: a wave at rest, a crouch, a leap with stretch, a squash on landing and a second hop; notes and confetti ──
let DOH_NOTES = [[156, 194, 255], [255, 227, 179], [61, 220, 151], [253, 186, 116]];
let DOH_CONFETTI = [[125, 179, 255], [255, 227, 179], [61, 220, 151], [253, 186, 116], [255, 255, 255]];
function drawDoh(c: MomentCtx, t: number) {
  let P = 3.6, W = 380, H = 420, CROUCH = 0.55, JUMP = 0.78, LAND = 1.28, HOP0 = 1.85, HOP1 = 2.2;
  let cx = W / 2, base = 392, lift = 0, sx = 1, sy = 1, q, i;
  if (t < CROUCH) { sy = 1 + 0.015 * Math.sin(t * 6); sx = 2 - sy; }
  else if (t < JUMP) { q = easeInOut((t - CROUCH) / (JUMP - CROUCH)); sx = 1 + 0.1 * q; sy = 1 - 0.14 * q; }
  else if (t < LAND) { q = (t - JUMP) / (LAND - JUMP); lift = 96 * Math.sin(q * Math.PI); let st = 0.12 * Math.cos(q * Math.PI); sx = 1 - st * 0.6; sy = 1 + st; }
  else {
    let dl = t - LAND, sq = 0.14 * Math.exp(-7 * dl) * Math.cos(16 * dl);
    sx = 1 + sq; sy = 1 - sq;
    if (t > HOP0 && t < HOP1) lift = 34 * Math.sin((t - HOP0) / (HOP1 - HOP0) * Math.PI);
  }
  c.save(); fade(c, fadeOut(t, P));
  panel(c, W, H);
  // The shadow shrinks and fades as Doh rises.
  c.save(); c.translate(cx, base - 4); c.scale(1 - lift / 260, 1); fade(c, 1 - lift / 200); ellipse(c, 76, 12); fill(c, rgba(0, 0, 0, 110)); c.restore();
  // Doh: waving at rest, cheering from the leap on; scaled about the feet.
  c.save(); c.translate(cx, base - lift); c.scale(sx, sy); c.drawImage(t < JUMP ? "doh-wave" : "doh-cheer", -125, -250 * 0.94, 250, 250); c.restore();
  // Notes up from the top of the leap, swaying as they rise.
  for (i = 1; i <= 4; i++) {
    let d = t - (JUMP + 0.2 + i * 0.07);
    if (d <= 0 || d >= 1.6) continue;
    q = d / 1.6;
    let side = i % 2 === 0 ? 1 : -1, col = DOH_NOTES[i - 1];
    c.save();
    tf(c, cx + side * (70 + 15 * i) * easeOut(q * 1.5) + Math.sin(d * 5 + i) * 8, base - 250 - 90 * q, spring(d, 6, 12) * 0.95, side * 0.2 + Math.sin(d * 4 + i) * 0.15);
    fade(c, 1 - clamp((q - 0.6) / 0.4, 0, 1)); quaver(c, 1); fill(c, rgba(col[0], col[1], col[2]));
    c.restore();
  }
  // Confetti thrown up and falling.
  let dc = t - (JUMP + 0.22);
  if (dc > 0 && dc < 1.8) {
    for (i = 1; i <= 22; i++) {
      let a = -Math.PI / 2 + (rand(i) - 0.5) * 2.8, v = 200 + rand(i * 3) * 140, cc = DOH_CONFETTI[(i % DOH_CONFETTI.length)];
      c.save();
      tfs(c, cx + Math.cos(a) * v * dc, base - 230 + Math.sin(a) * v * dc + 300 * dc * dc, 1, Math.abs(Math.cos(dc * 9 + i)) + 0.15, dc * (4 + rand(i * 5) * 6));
      fade(c, 1 - clamp((dc - 1.2) / 0.6, 0, 1));
      if (i % 3 === 0) sparkle(c, 7); else rrect(c, 12, 7, 2);
      fill(c, rgba(cc[0], cc[1], cc[2]));
      c.restore();
    }
  }
  c.restore();
}

export interface MomentArtPiece {
  width: number;
  height: number;
  ms: number;
  draw(c: MomentCtx, t: number, values: MomentValues): void;
}

export const MOMENT_ART: Record<MomentPiece, MomentArtPiece> = {
  stars: { width: 440, height: 240, ms: 3000, draw: drawStars },
  streak: { width: 360, height: 360, ms: 3600, draw: drawStreak },
  goal: { width: 360, height: 380, ms: 3600, draw: drawGoal },
  combo: { width: 460, height: 230, ms: 3800, draw: drawCombo },
  musicbox: { width: 400, height: 440, ms: 4000, draw: drawMusicbox },
  doh: { width: 380, height: 420, ms: 3600, draw: (c, t) => drawDoh(c, t) },
};
