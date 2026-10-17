// Track-picker illustrations, empty states, the avatar and the mascot concepts.
import { bird, birdDefs, POSES, note, sparkle, M } from "./mascot.mjs";
import { mono } from "./glyphs.mjs";
import { BADGES, sticker } from "./badges.mjs";
const svg = (vb, defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><defs>${defs}</defs>${body}</svg>`;
const lg = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>`;
// a scene card: everything clipped to its rounded corners, so nothing pokes past them at any size
const CARD = `<clipPath id="card"><rect width="320" height="200" rx="24"/></clipPath>`;
const card = (body) => `<g clip-path="url(#card)">${body}</g>`;
const place = (x, y, s, inner) => `<g transform="translate(${x} ${y}) scale(${s})">${inner}</g>`;
const STAR = (() => { let d = ""; for (let i = 0; i < 10; i++) { const R = i % 2 ? 11 : 24, a = (Math.PI / 5) * i - Math.PI / 2; d += `${i ? "L" : "M"}${(R * Math.cos(a)).toFixed(1)} ${(R * Math.sin(a)).toFixed(1)}`; } return d + "Z"; })();
const star = (x, y, s, r = 0) => `<path transform="translate(${x} ${y}) rotate(${r}) scale(${s})" d="${STAR}" fill="#FFF1E0" stroke="#C2410C" stroke-width="3.5" stroke-linejoin="round"/>`;
// a mini sticker: white die-cut disc with a glyph
const mini = (x, y, r, rot, fill, inner) => `<g transform="translate(${x} ${y}) rotate(${rot})"><circle r="${r + 4}" fill="#fff"/><circle r="${r}" fill="${fill}"/>${inner}</g>`;

export const playful = () => svg("0 0 320 200",
  lg("bg", [[0, "#FFB27A"], [1, "#F97316"]], .6, 1) + birdDefs() + CARD,
  card(`<rect width="320" height="200" fill="url(#bg)"/>` +
  // sunburst
  `<g fill="#fff" opacity=".16">${[...Array(12)].map((_, i) => `<path transform="rotate(${i * 30} 150 130)" d="M150 130L138 -40H162Z"/>`).join("")}</g>` +
  `<circle cx="150" cy="130" r="70" fill="#fff" opacity=".18"/>` +
  place(80, 34, .8, bird({ wings: [150, 150], eyes: "happy", beak: "open", lift: 6 })) +
  mini(46, 52, 18, -12, "#2F7BFF", note(-3, 7, .9, "#fff")) +
  mini(270, 58, 18, 10, "#FF4D5E", `<path transform="translate(0 2) scale(.42)" d="M0 -26C4 -16 16 -10 16 6C16 18 9 26 0 26C-9 26 -16 18 -16 7C-16 -1 -12 -6 -8 -10C-8 -4 -6 -1 -3 0C-4 -10 -2 -20 0 -26Z" fill="#fff"/>`) +
  mini(262, 148, 16, -8, "#16A34A", `<path d="M-7 0l5 5 9-10" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`) +
  star(52, 140, .9, -12) + star(232, 26, .55, 14) + star(28, 104, .45, 8) +
  note(244, 116, 1.1, "#fff") + `<g fill="#fff"><circle cx="300" cy="104" r="4"/><circle cx="110" cy="18" r="3"/></g>` +
  `<rect x="200" y="176" width="9" height="9" rx="2" transform="rotate(25 204 180)" fill="#2F7BFF"/><circle cx="30" cy="180" r="4" fill="#FF4D5E"/>`));

export const focused = () => {
  const lad = ["d'", "t", "l", "s", "f", "m", "r", "d"];
  let ladder = "";
  lad.forEach((g, i) => {
    const y = 24 + i * 20.5, on = g === "s";
    if (on) ladder += `<rect x="22" y="${y - 9}" width="44" height="18" rx="9" fill="#2F7BFF"/>`;
    ladder += mono(g, { cx: 44, cy: y, h: 12, sw: 12, color: on ? "#fff" : "#9CC2FF", tall: true });
  });
  // tuner: an arc of ticks, needle dead centre
  let ticks = "";
  for (let k = -6; k <= 6; k++) {
    const a = (-90 + k * 10) * Math.PI / 180, R1 = 66, R2 = k % 3 ? 58 : 52;
    ticks += `M${(204 + R1 * Math.cos(a)).toFixed(1)} ${(116 + R1 * Math.sin(a)).toFixed(1)}L${(204 + R2 * Math.cos(a)).toFixed(1)} ${(116 + R2 * Math.sin(a)).toFixed(1)}`;
  }
  return svg("0 0 320 200", lg("bg", [[0, "#13235A"], [1, "#0A1230"]], .5, 1) + CARD,
    card(`<rect width="320" height="200" fill="url(#bg)"/>` +
    `<g stroke="#9CC2FF" stroke-opacity=".08">${[...Array(9)].map((_, i) => `<path d="M${88 + i * 26} 0V200"/>`).join("")}${[...Array(7)].map((_, i) => `<path d="M80 ${14 + i * 28}H320"/>`).join("")}</g>` +
    `<rect x="14" y="10" width="60" height="180" rx="14" fill="#fff" fill-opacity=".05" stroke="#9CC2FF" stroke-opacity=".18"/>` + ladder +
    `<path d="M144 116A60 60 0 0 1 264 116" fill="none" stroke="#9CC2FF" stroke-opacity=".14" stroke-width="16"/>` +
    `<path d="M196 54A62 62 0 0 1 212 54" fill="none" stroke="#3DDC97" stroke-width="16" opacity=".35"/>` +
    `<path d="${ticks}" stroke="#9CC2FF" stroke-width="2.4" stroke-linecap="round" opacity=".75"/>` +
    `<path d="M204 116V46" stroke="#3DDC97" stroke-width="4" stroke-linecap="round"/><circle cx="204" cy="116" r="9" fill="#3DDC97"/><circle cx="204" cy="116" r="3.5" fill="#0A1230"/>` +
    // staff with the line just sung, each note marked
    `<g stroke="#9CC2FF" stroke-opacity=".35" stroke-width="1.2">${[0, 1, 2, 3, 4].map((i) => `<path d="M104 ${172 + i * 4.5 - 9}H300"/>`).join("")}</g>` +
    [[122, 178.5], [150, 174], [178, 169.5], [206, 174], [234, 165], [262, 169.5], [290, 174]].map(([x, y], i) => `<ellipse cx="${x}" cy="${y - 6}" rx="4.6" ry="3.6" transform="rotate(-20 ${x} ${y - 6})" fill="${i === 4 ? "#F5B544" : "#3DDC97"}"/>`).join("")));
};

// empty states (260x200)
export const noDrill = () => svg("0 0 260 200", birdDefs(),
  // music stand with a blank sheet: three empty note slots waiting
  `<path d="M176 186V120M156 190L176 180L196 190" fill="none" stroke="#8B95AA" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<g transform="rotate(-4 176 76)"><rect x="124" y="30" width="104" height="90" rx="10" fill="#EAF2FF" stroke="#9CC2FF" stroke-width="3"/>` +
  `<g stroke="#9CC2FF" stroke-width="2">${[0, 1, 2, 3, 4].map((i) => `<path d="M138 ${56 + i * 10}H214"/>`).join("")}</g>` +
  `<g fill="#fff" stroke="#5C9BFF" stroke-width="2.6" stroke-dasharray="4 3.5">${[[152, 91], [176, 81], [200, 71]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="9" ry="7" transform="rotate(-20 ${x} ${y})"/>`).join("")}</g></g>` +
  place(2, 50, .74, bird({ wings: [8, 8], eyes: "closed", beak: "small", crest: "droop", tilt: 4,
    back: mono("z", { cx: 28, cy: 56, h: 24, sw: 13, color: M.ice }) + mono("z", { cx: 12, cy: 28, h: 16, sw: 14, color: "#5C9BFF" }) })));

export const offline = () => svg("0 0 260 200", birdDefs(),
  // a cut wire; the bird perched on one end, looking at the gap
  `<path d="M4 168Q60 178 112 170" fill="none" stroke="#8B95AA" stroke-width="4" stroke-linecap="round"/><path d="M160 166Q210 156 256 162" fill="none" stroke="#8B95AA" stroke-width="4" stroke-linecap="round"/>` +
  `<path d="M120 164l6-6M122 174l7 3M152 162l-6-6M150 172l-7 4" stroke="#FB923C" stroke-width="3" stroke-linecap="round"/>` +
  // cloud with a slash
  `<g transform="translate(176 30)"><path d="M14 40H58C67 40 74 33 74 25C74 17 68 11 60 11C58 4 51 -1 43 -1C33 -1 26 6 25 14C18 14 6 19 6 28C6 35 9 40 14 40Z" fill="#EAF2FF" stroke="#9CC2FF" stroke-width="2.5"/><path d="M18 -2L64 46" stroke="#FF4D5E" stroke-width="5" stroke-linecap="round"/></g>` +
  place(-2, 40, .68, bird({ wings: [14, -40], eyes: "worried", beak: "small", dx: 6, cheeks: false })));

export const avatar = () => svg("0 0 96 96", birdDefs() + `<clipPath id="ac"><circle cx="48" cy="48" r="48"/></clipPath>`,
  `<circle cx="48" cy="48" r="48" fill="#DCE9FF"/><g clip-path="url(#ac)">${place(-12, -4, .6, bird({ wings: [12, 12], eyes: "open", beak: "closed" }).replace(/<ellipse cx="100" cy="192"[^>]*\/>/, ""))}</g>`);

// ── concepts (for the comparison sheet only) ──
export const conceptQuaver = () => svg("0 0 200 200",
  lg("q", [[0, "#6AA8FF"], [1, "#1B5FE0"]], .6, 1),
  `<ellipse cx="100" cy="192" rx="40" ry="4.5" fill="#0A0D14" opacity=".16"/>` +
  `<path d="M140 120V24C160 30 176 44 178 64" fill="none" stroke="#2F7BFF" stroke-width="13" stroke-linecap="round"/>` +
  `<ellipse cx="96" cy="132" rx="56" ry="44" transform="rotate(-20 96 132)" fill="url(#q)"/>` +
  `<path d="M50 140q-18 10-14 26M144 132q16 8 16 24" fill="none" stroke="#1B5FE0" stroke-width="9" stroke-linecap="round"/>` +
  `<g fill="#0A0D14"><ellipse cx="80" cy="126" rx="7.5" ry="9.5"/><ellipse cx="114" cy="120" rx="7.5" ry="9.5"/></g><g fill="#fff"><circle cx="82.5" cy="122" r="2.7"/><circle cx="116.5" cy="116" r="2.7"/></g>` +
  `<path d="M88 144q11 9 22-2" fill="none" stroke="#0A0D14" stroke-width="4.5" stroke-linecap="round"/>` +
  `<path d="M84 176v10M110 172v12" stroke="#1B5FE0" stroke-width="7" stroke-linecap="round"/>`);
export const conceptFork = () => svg("0 0 200 200",
  lg("k", [[0, "#E3EEFF"], [1, "#9CC2FF"]], .5, 1),
  `<ellipse cx="100" cy="192" rx="34" ry="4.5" fill="#0A0D14" opacity=".16"/>` +
  `<path d="M62 22V96C62 122 78 140 100 140C122 140 138 122 138 96V22" fill="none" stroke="url(#k)" stroke-width="26" stroke-linecap="round"/>` +
  `<path d="M100 140V186" stroke="#9CC2FF" stroke-width="16" stroke-linecap="round"/>` +
  `<g fill="#0A0D14"><ellipse cx="84" cy="106" rx="6.5" ry="8.5"/><ellipse cx="116" cy="106" rx="6.5" ry="8.5"/></g><g fill="#fff"><circle cx="86" cy="102.5" r="2.4"/><circle cx="118" cy="102.5" r="2.4"/></g>` +
  `<path d="M90 122q10 8 20 0" fill="none" stroke="#0A0D14" stroke-width="4.5" stroke-linecap="round"/>` +
  `<path d="M34 30q-8 12 0 24M24 22q-14 20 0 40M166 30q8 12 0 24M176 22q14 20 0 40" fill="none" stroke="#5C9BFF" stroke-width="4" stroke-linecap="round"/>`);
