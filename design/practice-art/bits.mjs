// Streak flame (3 states), freeze, stars, weekly-goal ring, confetti.
import { mono } from "./glyphs.mjs";
const svg = (vb, defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>`;
const lg = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>`;
export const FLAME = "M32 4C37 15 50 22 50 40C50 53 42 60 32 60C22 60 14 53 14 41C14 32 18 27 23 22C23 29 25 32 29 33C28 22 30 12 32 4Z";
const CORE = "M32 30C36 37 41 40 41 47C41 54 37 58 32 58C27 58 23 54 23 47C23 42 26 39 29 36C30 39 31 40 32 40C31 37 31 34 32 30Z";

export const streak = {
  active: () => svg("0 0 64 64", lg("o", [[0, "#FFC861"], [.55, "#FB923C"], [1, "#FF4D5E"]]) + lg("i", [[0, "#FFF4D1"], [1, "#FDBA74"]]),
    `<path d="${FLAME}" fill="url(#o)"/><path d="${CORE}" fill="url(#i)"/><path d="M22 40c0-5 2-8 4-10" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2.5" stroke-linecap="round"/>`),
  // at risk: a lower, orange-only flame inside a countdown ring (the day running out)
  atRisk: () => svg("0 0 64 64", lg("o", [[0, "#FED7AA"], [1, "#EA580C"]]),
    `<circle cx="32" cy="32" r="28" fill="none" stroke="#FB923C" stroke-opacity=".22" stroke-width="4"/>` +
    `<path d="M32 4A28 28 0 1 1 7.8 46" fill="none" stroke="#C2410C" stroke-width="4" stroke-linecap="round"/>` +
    `<g transform="translate(32 50) rotate(-8) scale(.66) translate(-32 -60)"><path d="${FLAME}" fill="url(#o)"/><path d="${CORE}" fill="#FFF1E0"/></g>`),
  // out: an empty outline with a wisp of smoke
  out: () => svg("0 0 64 64", "",
    `<path d="${FLAME}" transform="translate(32 60) scale(.9) translate(-32 -60)" fill="#7C879C" fill-opacity=".18" stroke="#7C879C" stroke-width="3.5" stroke-linejoin="round"/>` +
    `<path d="M40 14c-4-3 2-6-1-10" fill="none" stroke="#7C879C" stroke-width="3" stroke-linecap="round" opacity=".7"/>`),
};
// streak freeze: a faceted ice crystal with a frozen flame inside
export const freeze = () => {
  const P = (R) => [...Array(6)].map((_, i) => { const a = (Math.PI / 3) * i - Math.PI / 2; return [32 + R * Math.cos(a), 33 + R * Math.sin(a)]; });
  const o = P(28), d = o.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("") + "Z";
  const facets = o.map(([x, y]) => `M32 33L${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  return svg("0 0 64 64", lg("c", [[0, "#F2F7FF"], [.5, "#9CC2FF"], [1, "#3A84FF"]], .4, 1),
    `<path d="${d}" fill="url(#c)" stroke="#2F7BFF" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<path d="${facets}" stroke="#fff" stroke-opacity=".55" stroke-width="1.4"/>` +
    `<path d="${FLAME}" transform="translate(32 47) scale(.42) translate(-32 -60)" fill="#fff" fill-opacity=".9"/>` +
    `<path d="M14 18l6 3M50 18l-6 3" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`);
};
const STAR = (() => { let d = ""; for (let i = 0; i < 10; i++) { const R = i % 2 ? 11 : 24, a = (Math.PI / 5) * i - Math.PI / 2; d += `${i ? "L" : "M"}${(R * Math.cos(a)).toFixed(1)} ${(R * Math.sin(a)).toFixed(1)}`; } return d + "Z"; })();
const star = (x, y, s, on) => on
  ? `<path transform="translate(${x} ${y}) scale(${s})" d="${STAR}" fill="url(#s)" stroke="#C2410C" stroke-width="3.5" stroke-linejoin="round"/><path transform="translate(${x} ${y}) scale(${s})" d="M-9 -4L-3 -5L0 -13" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
  : `<path transform="translate(${x} ${y}) scale(${s})" d="${STAR}" fill="#8B95AA" fill-opacity=".2" stroke="#8B95AA" stroke-opacity=".55" stroke-width="4" stroke-linejoin="round"/>`;
export const starOne = () => svg("0 0 56 56", lg("s", [[0, "#FFC58A"], [1, "#F97316"]]), star(28, 30, .95, true));
export const stars = (n) => svg("0 0 132 64", lg("s", [[0, "#FFC58A"], [1, "#F97316"]]),
  star(22, 40, .74, n >= 1) + star(110, 40, .74, n >= 3) + star(66, 31, 1.02, n >= 2));
// weekly goal: five arcs, one per practice day
export const ring = (done, mode) => {
  const on = mode === "day" ? "#16A34A" : "#3DDC97", track = mode === "day" ? "#E2E8F0" : "#1C212B";
  const R = 38, seg = 72, gap = 14; let s = "";
  for (let i = 0; i < 5; i++) {
    const a0 = (-90 + i * seg + gap / 2) * Math.PI / 180, a1 = (-90 + (i + 1) * seg - gap / 2) * Math.PI / 180;
    const p = (a) => `${(48 + R * Math.cos(a)).toFixed(1)} ${(48 + R * Math.sin(a)).toFixed(1)}`;
    s += `<path d="M${p(a0)}A${R} ${R} 0 0 1 ${p(a1)}" fill="none" stroke="${i < done ? on : track}" stroke-width="10" stroke-linecap="round"/>`;
  }
  if (done >= 5) s += `<circle cx="48" cy="48" r="22" fill="${on}"/><path d="M38 48.5l7 7 13-14" fill="none" stroke="${mode === "day" ? "#fff" : "#07090E"}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<g fill="#9CC2FF"><circle cx="88" cy="12" r="3"/><circle cx="10" cy="20" r="2.4"/><circle cx="90" cy="82" r="2.2"/></g>`;
  return svg("0 0 96 96", "", s);
};
// confetti: brand colours, some musical
export const CONFETTI = {
  quaver: () => svg("0 0 32 32", "", `<ellipse cx="11" cy="23" rx="6.5" ry="5" transform="rotate(-20 11 23)" fill="#5C9BFF"/><path d="M16 21V5c4 1 8 4 8 9" fill="none" stroke="#5C9BFF" stroke-width="3.4" stroke-linecap="round"/>`),
  beamed: () => svg("0 0 32 32", "", `<g fill="#A78BFA"><ellipse cx="8" cy="25" rx="5" ry="3.8" transform="rotate(-20 8 25)"/><ellipse cx="23" cy="22" rx="5" ry="3.8" transform="rotate(-20 23 22)"/></g><path d="M12 24V8L27 5V21" fill="none" stroke="#A78BFA" stroke-width="3" stroke-linejoin="round"/><path d="M12 8L27 5" stroke="#A78BFA" stroke-width="5"/>`),
  sharp: () => svg("0 0 32 32", "", `<path d="M12 4V28M20 3V27M6 13L26 9M6 22L26 18" fill="none" stroke="#FB923C" stroke-width="3.4" stroke-linecap="round"/>`),
  flat: () => svg("0 0 32 32", "", `<path d="M11 3V28C17 26 23 21 23 17C23 13 17 12 11 17" fill="none" stroke="#3DDC97" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`),
  dot: () => svg("0 0 32 32", "", `<circle cx="16" cy="16" r="8" fill="#FF4D5E"/>`),
  ribbon: () => svg("0 0 32 32", "", `<path d="M4 20C8 10 12 10 14 16S20 22 24 12" fill="none" stroke="#9CC2FF" stroke-width="4" stroke-linecap="round"/>`),
  tri: () => svg("0 0 32 32", "", `<path d="M16 6L27 25H5Z" fill="#2F7BFF" stroke="#2F7BFF" stroke-width="3" stroke-linejoin="round"/>`),
  sparkle: () => svg("0 0 32 32", "", `<path d="M16 3C17 11 21 15 29 16C21 17 17 21 16 29C15 21 11 17 3 16C11 15 15 11 16 3Z" fill="#F472B6"/>`),
};
