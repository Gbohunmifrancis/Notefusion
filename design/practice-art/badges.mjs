import { mono } from "./glyphs.mjs";
import { rpoly } from "./emblems.mjs";
import { capDefs, capShapes } from "./season.mjs";
const f = (n) => Math.round(n * 10) / 10;
const C = 60;
// sticker outlines (fill-less, so one shape draws the shadow, the die-cut border and the body)
const SH = {
  circle: `<circle cx="60" cy="58" r="44"/>`,
  square: `<rect x="18" y="16" width="84" height="84" rx="24"/>`,
  hex: `<path d="${rpoly(60, 58, 50, 6, 14, -90)}"/>`,
  shield: `<path d="M60 12C72 18 86 20 98 20C99 58 90 84 60 104C30 84 21 58 22 20C34 20 48 18 60 12Z"/>`,
  rosette: (() => { let d = ""; const n = 12; for (let i = 0; i <= n; i++) { const a = (Math.PI * 2 * i) / n - Math.PI / 2; const x = 60 + 44 * Math.cos(a), y = 58 + 44 * Math.sin(a); if (!i) d += `M${f(x)} ${f(y)}`; else { const m = a - Math.PI / n; d += `Q${f(60 + 52 * Math.cos(m))} ${f(58 + 52 * Math.sin(m))} ${f(x)} ${f(y)}`; } } return `<path d="${d}Z"/>`; })(),
  diamond: `<rect x="24" y="22" width="72" height="72" rx="20" transform="rotate(45 60 58)"/>`,
  medal: `<path d="M44 74L32 110L46 104L54 116L62 84Z M76 74L88 110L74 104L66 116L58 84Z"/>` + `<path d="${rpoly(60, 50, 42, 10, 6, -90)}"/>`,
  // five sides for the five days of the weekly goal
  pentagon: `<path d="${rpoly(60, 60, 50, 5, 14, -90)}"/>`,
};
// the weekly goal's ring: five arcs, one per practice day, all done (as the app draws a met week)
const fiveArcs = (cx, cy, R, sw, c) => {
  let d = "";
  for (let i = 0; i < 5; i++) {
    const a0 = (-90 + i * 72 + 9) * Math.PI / 180, a1 = (-90 + (i + 1) * 72 - 9) * Math.PI / 180;
    d += `M${f(cx + R * Math.cos(a0))} ${f(cy + R * Math.sin(a0))}A${R} ${R} 0 0 1 ${f(cx + R * Math.cos(a1))} ${f(cy + R * Math.sin(a1))}`;
  }
  return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>`;
};
const grad = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
const quaver = (x, y, s, c) => `<g transform="translate(${x} ${y}) scale(${s})"><ellipse cx="0" cy="0" rx="11" ry="8.5" transform="rotate(-20)" fill="${c}"/><path d="M8.5 -3V-40C16 -37 23 -31 24 -20" fill="none" stroke="${c}" stroke-width="6" stroke-linecap="round"/></g>`;
const spark = (x, y, s, c) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -10C1 -3 3 -1 10 0C3 1 1 3 0 10C-1 3 -3 1 -10 0C-3 -1 -1 -3 0 -10Z" fill="${c}"/>`;
const FLAME = "M0 -26C4 -16 16 -10 16 6C16 18 9 26 0 26C-9 26 -16 18 -16 7C-16 -1 -12 -6 -8 -10C-8 -4 -6 -1 -3 0C-4 -10 -2 -20 0 -26Z";

export const BADGES = [
  { id: "first-drill", name: "First drill", shape: "circle", g: ["#7DB3FF", "#2F7BFF"],
    icon: quaver(54, 72, 1.05, "#fff") + spark(84, 34, 1, "#fff") },
  { id: "three-in-a-row", name: "Three in a row", shape: "square", g: ["#FFB25C", "#F97316"],
    icon: `<path transform="translate(60 56) scale(1.45)" d="${FLAME}" fill="#fff"/>` + mono("3", { cx: 60, cy: 72, h: 24, sw: 13, color: "#F97316" }) },
  { id: "spot-on", name: "Spot on", shape: "circle", g: ["#5FE8AE", "#16A34A"],
    icon: `<path d="M30 64A30 30 0 0 1 90 64" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="7" stroke-linecap="round"/>` +
      `<path d="M52 36.8A30 30 0 0 1 68 36.8" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/>` +
      `<path d="M60 64V40" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="60" cy="64" r="6" fill="#fff"/>` +
      mono("100", { cx: 60, cy: 86, h: 14, sw: 13, color: "#fff", gap: 22 }) },
  { id: "ten-drills", name: "Ten drills", shape: "hex", g: ["#38BDF8", "#0369A1"],
    icon: mono("10", { cx: 60, cy: 60, h: 40, sw: 12, color: "#fff", gap: 16 }) + spark(88, 30, .7, "#fff") },
  { id: "first-part", name: "First part", shape: "rosette", g: ["#A78BFA", "#6D28D9"],
    icon: [[36, 26], [50, 44], [64, 34], [78, 20]].map(([x, h], i) => `<rect x="${x}" y="${58 - h / 2}" width="8" height="${h}" rx="4" fill="#fff" ${i === 1 ? "" : 'opacity=".42"'}/>`).join("") },
  // The weekly goal met: five days in one Monday-Sunday week, the ring's five arcs all closed.
  { id: "week-goal", name: "A week of practice", shape: "pentagon", g: ["#A5B4FC", "#4F46E5"],
    icon: fiveArcs(60, 62, 25, 8, "#fff") + `<circle cx="60" cy="62" r="12" fill="#3DDC97"/><path d="M54.5 62.5l4 4 7.5-8" fill="none" stroke="#064E3B" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>` },
  // Seven days running: the streak flame again, as Three in a row has it, a step hotter.
  { id: "seven-in-a-row", name: "Seven in a row", shape: "shield", g: ["#FB7185", "#E11D48"],
    icon: `<path transform="translate(60 57) scale(1.4)" d="${FLAME}" fill="#fff"/>` + mono("7", { cx: 60, cy: 73, h: 24, sw: 13, color: "#E11D48" }) },
  { id: "part-learned", name: "Part learned", shape: "diamond", g: ["#2DD4BF", "#0F766E"],
    icon: `<rect x="38" y="36" width="40" height="46" rx="6" fill="#fff"/><path d="M44 48H72M44 55H72M44 62H72" stroke="#0F766E" stroke-opacity=".35" stroke-width="2"/>` +
      `<ellipse cx="54" cy="62" rx="4.5" ry="3.5" transform="rotate(-20 54 62)" fill="#0F766E"/><path d="M57.6 61V46" stroke="#0F766E" stroke-width="2.6" stroke-linecap="round"/>` +
      `<circle cx="78" cy="78" r="12" fill="#3DDC97" stroke="#fff" stroke-width="3"/><path d="M72.5 78l4 4 7-8" fill="none" stroke="#064E3B" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` },
  // The Christmas season's sticker (board d-christmas/03): all six carols sung. Pine, two beamed quavers wearing the
  // season's cap, and a little snow; earned only while the season is on, kept for good.
  { id: "carol-singer", name: "Carol singer", shape: "circle", g: ["#3FA27A", "#1B5C44"], defs: capDefs(),
    icon: `<ellipse cx="44" cy="34" rx="16" ry="7" transform="rotate(-30 44 34)" fill="#fff" opacity=".16"/>` +
      `<g fill="#fff"><rect x="47" y="40" width="6.5" height="34" rx="3"/><rect x="73" y="35" width="6.5" height="34" rx="3"/>` +
      `<path d="M47 40L79.5 34.5V43L47 48.5Z"/><ellipse cx="44" cy="75" rx="10" ry="8" transform="rotate(-18 44 75)"/>` +
      `<ellipse cx="70" cy="70" rx="10" ry="8" transform="rotate(-18 70 70)"/></g>` +
      `<g transform="translate(58 33) rotate(-14) scale(.23)">${capShapes()}</g>` +
      `<g fill="#fff" opacity=".75"><circle cx="86" cy="80" r="2.6"/><circle cx="92" cy="66" r="1.8"/><circle cx="30" cy="56" r="2"/></g>` },
  // A rose-pink medal on brand-blue ribbons: gold is Pro's alone.
  { id: "month", name: "A month of practice", shape: "medal", g: ["#F9A8D4", "#DB2777"], ribbon: "#2F7BFF",
    icon: `<path d="${rpoly(60, 50, 31, 10, 4, -90)}" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="2"/>` + mono("30", { cx: 60, cy: 51, h: 28, sw: 13, color: "#fff", gap: 14 }) },
];

const SHADOW = "#0A0D14";
export function sticker(b, locked = false) {
  const shape = SH[b.shape];
  let defs = grad("g", ...b.g) + (b.defs || "");
  let body = `<g fill="url(#g)">${shape}</g>`;
  if (b.ribbon) { // the medal's ribbons in brand blue, under the gold rosette
    defs += grad("r", "#5C9BFF", "#1B5FE0");
    body = `<path d="M44 74L32 110L46 104L54 116L62 84Z M76 74L88 110L74 104L66 116L58 84Z" fill="url(#r)"/><path d="${rpoly(60, 50, 42, 10, 6, -90)}" fill="url(#g)"/>`;
  }
  const base = `<g transform="translate(0 3)" fill="${SHADOW}" stroke="${SHADOW}" stroke-width="10" stroke-linejoin="round" opacity=".18">${shape}</g>` +
    `<g fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round">${shape}</g>` + body +
    `<g fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="2">${shape}</g>`;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 124"><defs>${defs}</defs>${base}${b.icon}</svg>`;
  if (locked) svg = lockify(svg);
  return svg;
}
// Locked: every colour folded onto one cool slate ramp, the icon faded, and a padlock tab.
const hex2 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (a) => "#" + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
function lockify(svg) {
  svg = svg.replace(/#[0-9A-Fa-f]{6}\b/g, (h) => {
    if (/^#(FFFFFF|fff)$/i.test(h) || h === SHADOW) return h;
    const [r, g, b] = hex2(h);
    const L = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
    const v = 138 + L * 70;
    return toHex([v - 8, v - 3, v + 8]);
  });
  const lock = `<g><circle cx="94" cy="96" r="14" fill="#5A6478" stroke="#fff" stroke-width="3.5"/><path d="M89.5 95v-3.5a4.5 4.5 0 0 1 9 0V95" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><rect x="87" y="94" width="14" height="10" rx="2.4" fill="#fff"/></g>`;
  svg = svg.replace(/(<\/defs>)/, '$1<g opacity=".72">');
  return svg.replace("</svg>", "</g>" + lock + "</svg>");
}
