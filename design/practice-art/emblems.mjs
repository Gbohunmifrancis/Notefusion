// The eight level emblems: one hexagon climbing the scale, Doh to Te in deepening blues, Choir-ready (d') in violet.
import { mono } from "./glyphs.mjs";
const f = (n) => Math.round(n * 10) / 10;
export function rpoly(cx, cy, R, n, r, rot = -90) {
  const pts = [...Array(n)].map((_, i) => { const a = (Math.PI / 180) * (rot + (360 / n) * i); return [cx + R * Math.cos(a), cy + R * Math.sin(a)]; });
  const tw = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy); return [p[0] + (dx / L) * r, p[1] + (dy / L) * r]; };
  let d = "";
  pts.forEach((p, i) => { const a = tw(p, pts[(i + n - 1) % n]), b = tw(p, pts[(i + 1) % n]); d += `${i ? "L" : "M"}${f(a[0])} ${f(a[1])}Q${f(p[0])} ${f(p[1])} ${f(b[0])} ${f(b[1])}`; });
  return d + "Z";
}
export const LEVELS = [
  { name: "Doh", g: "d", top: "#7DB3FF", bot: "#3A84FF" },
  { name: "Ray", g: "r", top: "#6AA8FF", bot: "#2F7BFF" },
  { name: "Me", g: "m", top: "#5C9BFF", bot: "#2A70F2" },
  { name: "Fah", g: "f", top: "#4E92FF", bot: "#2563EB" },
  { name: "Soh", g: "s", top: "#3A84FF", bot: "#1F5CE3" },
  { name: "Lah", g: "l", top: "#2F7BFF", bot: "#1B4FD6" },
  { name: "Te", g: "t", top: "#2563EB", bot: "#183FB4" },
  { name: "Choir-ready", g: "d'", top: "#5B21B6", bot: "#2E1065" },
];
/**
 * Choir-ready's violet: the note colour of C (#8B5CF6), never gold, which is Pro's alone across the app. Its outline
 * (frame, wings, crown) keeps to #8B5CF6..#7C3AED, which holds 3:1 and more against both Night's and Day's surfaces.
 */
export const VIOLET = { lit: "#EDE9FE", hi: "#DDD6FE", edge: "#8B5CF6", deep: "#7C3AED", ink: "#2E1065" };
const CX = 70, CY = 72;
export function emblem(i) {
  const L = LEVELS[i], lvl = i + 1, top = lvl === 8, V = VIOLET;
  const tier = lvl <= 3 ? 1 : lvl <= 6 ? 2 : 3;
  const lit = top ? V.lit : "#fff";
  let defs = `<linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.top}"/><stop offset="1" stop-color="${L.bot}"/></linearGradient>`;
  defs += top
    ? `<linearGradient id="fr" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="${V.edge}"/><stop offset="1" stop-color="${V.deep}"/></linearGradient>`
    : `<linearGradient id="fr" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="#E3EEFF"/><stop offset="1" stop-color="#9CC2FF"/></linearGradient>`;
  let s = "";
  // wings: the logo's sound bars, from Te up
  if (tier === 3) {
    const c = top ? "url(#fr)" : "#9CC2FF";
    const bars = [[16, 22], [8, 34], [0, 22]].map(([x, h]) => `<rect x="${x + 2}" y="${CY - h / 2}" width="7" height="${h}" rx="3.5"/>`).join("");
    s += `<g fill="${c}">${bars}</g><g fill="${c}" transform="matrix(-1 0 0 1 140 0)">${bars}</g>`;
  }
  if (tier >= 2) s += `<path d="${rpoly(CX, CY, 56, 6, 14)}" fill="url(#fr)"/>`;
  if (top) s += `<path d="${rpoly(CX, CY, 53, 6, 13)}" fill="none" stroke="${V.hi}" stroke-opacity=".5" stroke-width="1.4"/>`;
  s += `<path d="${rpoly(CX, CY, tier >= 2 ? 47 : 52, 6, 12)}" fill="url(#p)"/>`;
  s += `<path d="${rpoly(CX, CY, tier >= 2 ? 41 : 45, 6, 10)}" fill="none" stroke="${top ? V.hi : "#fff"}" stroke-opacity="${top ? 0.55 : 0.28}" stroke-width="1.6"/>`;
  // sheen
  s += `<path d="M${CX - 30} ${CY - 14}Q${CX} ${CY - 36} ${CX + 30} ${CY - 14}L${CX + 34} ${CY - 22}L${CX} ${CY - 42}L${CX - 34} ${CY - 22}Z" fill="#fff" opacity=".1"/>`;
  s += mono(L.g, { cx: CX, cy: CY - 5, h: 40, sw: 11, color: lit, tall: true });
  // seven pips on a rising arc: the scale climbed so far
  for (let k = 0; k < 7; k++) {
    const a = (Math.PI / 180) * (140 - k * 16.7), R = 31;
    const on = top || k < lvl;
    s += `<circle cx="${f(CX + R * Math.cos(a))}" cy="${f(CY + 4 + R * Math.sin(a))}" r="2.7" fill="${on ? lit : "#fff"}" ${on ? "" : 'opacity=".28"'}/>`;
  }
  if (top) {
    // crown over the top vertex: three points, each tipped with a note head
    s += `<path d="M50 22L46 6L60 14L70 2L80 14L94 6L90 22Z" fill="url(#fr)" stroke="${V.ink}" stroke-width="2" stroke-linejoin="round"/>`;
    s += `<g fill="${V.hi}" stroke="${V.ink}" stroke-width="1.6">${[[46, 6], [70, 2], [94, 6]].map(([x, y]) => `<ellipse cx="${x}" cy="${y + 1}" rx="4.6" ry="3.6" transform="rotate(-20 ${x} ${y + 1})"/>`).join("")}</g>`;
    s += `<path d="M120 22c.7 4 2 5.3 6 6-4 .7-5.3 2-6 6-.7-4-2-5.3-6-6 4-.7 5.3-2 6-6z M20 112c.5 3 1.5 4 4.5 4.5-3 .5-4 1.5-4.5 4.5-.5-3-1.5-4-4.5-4.5 3-.5 4-1.5 4.5-4.5z" fill="${V.edge}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140"><defs>${defs}</defs>${s}</svg>`;
}
