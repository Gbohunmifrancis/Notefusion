// Monoline solfa letterforms drawn for NoteFusion: round caps, one stroke weight, the same
// rounded line as the logo's note. Grid: baseline y=0, x-height 52, ascender 80.
export const G = {
  d: { w: 46, p: "M46 -80V0M46 -26C46 -41 36 -52 23 -52C10 -52 0 -41 0 -26C0 -11 10 0 23 0C36 0 46 -11 46 -26Z" },
  r: { w: 38, p: "M0 -52V0M0 -27C0 -43 11 -52 25 -52C30 -52 34 -51 38 -49" },
  m: { w: 60, p: "M0 -52V0M0 -37C0 -47 7 -52 15 -52C24 -52 30 -47 30 -37V0M30 -37C30 -47 36 -52 45 -52C54 -52 60 -47 60 -37V0" },
  f: { w: 38, p: "M38 -77C35 -79 31 -80 27 -80C17 -80 12 -74 12 -63V0M0 -50H34" },
  s: { w: 42, p: "M40 -45C36 -50 30 -52 21 -52C10 -52 3 -46 3 -38C3 -30 11 -28 21 -26C32 -24 41 -21 41 -13C41 -4 33 0 21 0C12 0 5 -2 1 -7" },
  l: { w: 32, p: "M0 -80H14V-16C14 -5 20 0 32 0" },
  t: { w: 32, p: "M14 -70V-16C14 -5 20 0 32 0M0 -52H32" },
  "'": { w: 8, p: "M10 -86L6 -66" },
  ",": { w: 6, p: "M5 6L1 22" },
  "0": { w: 40, p: "M20 -78C31 -78 40 -62 40 -39C40 -16 31 0 20 0C9 0 0 -16 0 -39C0 -62 9 -78 20 -78Z" },
  "1": { w: 18, p: "M0 -62L18 -78V0" },
  "3": { w: 40, p: "M2 -70C7 -76 13 -78 20 -78C31 -78 38 -71 38 -60C38 -49 30 -42 17 -42C32 -42 40 -34 40 -22C40 -8 31 0 20 0C11 0 5 -3 0 -8" },
  "7": { w: 38, p: "M0 -78H38L13 0" },
  z: { w: 34, p: "M0 -52H34L0 0H34" },
};
const r = (n) => Math.round(n * 100) / 100;
/** Monoline text centred on (cx, cy). h = px height of an ascender (80 units). */
export function mono(str, { cx, cy, h, sw = 12, color = "#fff", gap = 13, tall } = {}) {
  const k = h / 80;
  const chars = [...str];
  let w = 0;
  chars.forEach((c, i) => { w += G[c].w + (i ? gap : 0); });
  const asc = tall ?? chars.some((c) => "dflt'0137".includes(c));
  const top = asc ? -80 : -52;
  const ox = cx - (w * k) / 2, oy = cy - ((top + 0) / 2) * k;
  let x = 0, out = "";
  chars.forEach((c, i) => {
    if (i) x += gap;
    out += `<path transform="translate(${r(x)})" d="${G[c].p}"/>`;
    x += G[c].w;
  });
  return `<g transform="translate(${r(ox)} ${r(oy)}) scale(${r(k * 1000) / 1000})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${out}</g>`;
}
