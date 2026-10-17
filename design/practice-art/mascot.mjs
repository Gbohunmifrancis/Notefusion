// "Doh", the doh bird. 200x200 viewBox, feet on y≈188. Every colour is a brand token.
import { mono } from "./glyphs.mjs";
export const M = {
  hi: "#6AA8FF", blue: "#2F7BFF", deep: "#1B5FE0", wing: "#1B5FE0", wingDeep: "#1546C0",
  belly: "#E3EEFF", eye: "#0A0D14", beak: "#F5B544", beakDeep: "#D99A2B", cheek: "#FF8A80",
  ice: "#9CC2FF", mint: "#3DDC97", red: "#FF4D5E", flame: "#FB923C", spark: "#C4B5FD",
};
const BODY = "M100 56C141 56 166 86 166 121C166 156 139 180 100 180C61 180 34 156 34 121C34 86 59 56 100 56Z";
const WING = "M0 0C-13 5 -19 22 -15 38C-14 44 -10 47 -7 44C-6 48 -1 50 3 45C9 35 11 16 7 2C5 -1 3 -1 0 0Z";

export function birdDefs(p = "") {
  return `<linearGradient id="${p}b" x1=".25" y1="0" x2=".75" y2="1"><stop offset="0" stop-color="${M.hi}"/><stop offset=".55" stop-color="${M.blue}"/><stop offset="1" stop-color="${M.deep}"/></linearGradient>` +
    `<linearGradient id="${p}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${M.blue}"/><stop offset="1" stop-color="${M.wingDeep}"/></linearGradient>` +
    `<clipPath id="${p}c"><path d="${BODY}"/></clipPath>`;
}
const wing = (a, p, side) => {
  const g = `<path transform="rotate(${a} 44 114) translate(44 114)" d="${WING}" fill="url(#${p}w)"/>`;
  return side === "r" ? `<g transform="matrix(-1 0 0 1 200 0)">${g}</g>` : g;
};
const EYES = {
  open: (dx = 0) => `<g fill="${M.eye}"><ellipse cx="${78 + dx}" cy="97" rx="9" ry="11"/><ellipse cx="${122 + dx}" cy="97" rx="9" ry="11"/></g><g fill="#fff"><circle cx="${81 + dx}" cy="92.5" r="3.2"/><circle cx="${125 + dx}" cy="92.5" r="3.2"/></g>`,
  happy: (dx = 0) => `<path d="M${69 + dx} 100Q${78 + dx} 88 ${87 + dx} 100M${113 + dx} 100Q${122 + dx} 88 ${131 + dx} 100" fill="none" stroke="${M.eye}" stroke-width="5.5" stroke-linecap="round"/>`,
  closed: (dx = 0) => `<path d="M${69 + dx} 97Q${78 + dx} 104 ${87 + dx} 97M${113 + dx} 97Q${122 + dx} 104 ${131 + dx} 97" fill="none" stroke="${M.eye}" stroke-width="5" stroke-linecap="round"/>`,
  worried: () => `${EYES.open()}<path d="M66 82L86 77M134 82L114 77" fill="none" stroke="${M.eye}" stroke-width="4.5" stroke-linecap="round"/>`,
  keen: () => `${EYES.open()}<path d="M68 79Q78 73 88 78M112 78Q122 73 132 79" fill="none" stroke="${M.eye}" stroke-width="4.5" stroke-linecap="round"/>`,
};
const BEAK = {
  closed: (dx = 0) => `<path d="M${89 + dx} 108C${93 + dx} 105 ${107 + dx} 105 ${111 + dx} 108C${109 + dx} 116 ${104 + dx} 122 ${100 + dx} 123C${96 + dx} 122 ${91 + dx} 116 ${89 + dx} 108Z" fill="${M.beak}"/><path d="M${93 + dx} 115Q${100 + dx} 118 ${107 + dx} 115" fill="none" stroke="${M.beakDeep}" stroke-width="2" stroke-linecap="round"/>`,
  open: (dx = 0) => `<path d="M${91 + dx} 113C${95 + dx} 116 ${105 + dx} 116 ${109 + dx} 113C${108 + dx} 122 ${104 + dx} 128 ${100 + dx} 128C${96 + dx} 128 ${92 + dx} 122 ${91 + dx} 113Z" fill="${M.beakDeep}"/><path d="M${88 + dx} 106C${93 + dx} 102 ${107 + dx} 102 ${112 + dx} 106C${110 + dx} 112 ${105 + dx} 114 ${100 + dx} 114C${95 + dx} 114 ${90 + dx} 112 ${88 + dx} 106Z" fill="${M.beak}"/>`,
  small: (dx = 0) => `<path d="M${92 + dx} 109C${95 + dx} 107 ${105 + dx} 107 ${108 + dx} 109C${106 + dx} 115 ${103 + dx} 119 ${100 + dx} 119C${97 + dx} 119 ${94 + dx} 115 ${92 + dx} 109Z" fill="${M.beak}"/>`,
};
const CREST = {
  up: "M100 62C99 50 100 41 105 36C113 29 125 29 135 25",
  droop: "M100 62C99 51 102 44 110 42C119 40 127 44 131 51",
};
const NOTE = (x, y, s, c) => `<g transform="translate(${x} ${y}) scale(${s})" fill="${c}"><ellipse cx="0" cy="0" rx="7" ry="5.4" transform="rotate(-20)"/><path d="M5 -2V-26C10 -24 15 -20 16 -13" fill="none" stroke="${c}" stroke-width="3.6" stroke-linecap="round"/></g>`;
export const note = NOTE;

/** opts: eyes, beak, wings [l, r] angles, crest, dx (gaze), lift, extras {back, front} */
export function bird(o = {}, p = "") {
  const { eyes = "open", beak = "closed", wings = [12, 12], crest = "up", dx = 0, lift = 0, cheeks = true, front = "", back = "", tilt = 0 } = o;
  const body = `<path d="${BODY}" fill="url(#${p}b)"/>` +
    `<ellipse cx="100" cy="160" rx="45" ry="46" fill="${M.belly}" clip-path="url(#${p}c)"/>` +
    `<ellipse cx="73" cy="80" rx="20" ry="10" transform="rotate(-32 73 80)" fill="#fff" opacity=".22"/>`;
  const end = crest === "up" ? [136, 24.5] : [131.5, 52];
  const crestEl = `<path d="${CREST[crest]}" fill="none" stroke="${M.hi}" stroke-width="11" stroke-linecap="round"/><circle cx="${end[0]}" cy="${end[1]}" r="7.5" fill="${M.hi}"/>`;
  const feet = `<path d="M88 178v8M112 178v8M81 189l7-3 7 3M105 189l7-3 7 3" fill="none" stroke="${M.beakDeep}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const shadow = `<ellipse cx="100" cy="192" rx="${40 - lift}" ry="4.5" fill="#0A0D14" opacity=".16"/>`;
  const face = EYES[eyes](dx) + (cheeks ? `<g fill="${M.cheek}" opacity=".5"><ellipse cx="${63 + dx}" cy="114" rx="9" ry="5.5"/><ellipse cx="${137 + dx}" cy="114" rx="9" ry="5.5"/></g>` : "") + BEAK[beak](dx);
  const w = (wings[0] != null ? wing(wings[0], p, "l") : "") + (wings[1] != null ? wing(wings[1], p, "r") : "");
  return `${shadow}<g transform="translate(0 ${-lift})${tilt ? ` rotate(${tilt} 100 180)` : ""}">${back}${crestEl}${feet}${body}${face}${w}${front}</g>`;
}

const motion = (d, c = M.ice) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" opacity=".9"/>`;
const sparkle = (x, y, s, c) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -10C1 -3 3 -1 10 0C3 1 1 3 0 10C-1 3 -3 1 -10 0C-3 -1 -1 -3 0 -10Z" fill="${c}"/>`;
export { sparkle };
const flame = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 -26C4 -16 16 -10 16 6C16 18 9 26 0 26C-9 26 -16 18 -16 7C-16 -1 -12 -6 -8 -10C-8 -4 -6 -1 -3 0C-4 -10 -2 -20 0 -26Z" fill="${M.flame}"/><path d="M0 0C3 6 8 9 8 15C8 21 4 24 0 24C-4 24 -8 21 -8 15C-8 10 -5 7 -3 4C-2 7 -1 8 0 8C-1 5 -1 3 0 0Z" fill="#FFF1E0"/></g>`;

export const POSES = {
  wave: () => bird({ wings: [12, 148], eyes: "open", beak: "closed",
    front: motion("M178 58q8 10 4 22") + motion("M186 50q12 14 6 32", "#5C9BFF") }),
  sing: () => bird({ wings: [32, 32], eyes: "happy", beak: "open",
    back: NOTE(160, 70, 1, M.ice) + NOTE(178, 34, .75, "#5C9BFF") + NOTE(36, 52, .7, M.ice) }),
  cheer: () => bird({ wings: [150, 150], eyes: "happy", beak: "open", lift: 8,
    back: sparkle(30, 40, 1, M.ice) + sparkle(172, 34, .8, M.spark) + `<circle cx="162" cy="84" r="4" fill="${M.mint}"/><circle cx="40" cy="86" r="3.5" fill="${M.red}"/><rect x="150" y="12" width="8" height="8" rx="2" transform="rotate(20 154 16)" fill="${M.ice}"/>` }),
  encourage: () => bird({ wings: [12, 128], eyes: "keen", beak: "closed",
    front: sparkle(180, 44, .8, M.mint) + sparkle(166, 26, .5, M.ice) }),
  worried: () => bird({ wings: [-48, -48], eyes: "worried", beak: "small", crest: "droop", cheeks: false,
    front: flame(100, 150, .62) + `<path d="M158 82c0 6-4 10-8 10s-8-4-8-10c0-5 8-14 8-14s8 9 8 14z" fill="${M.ice}" stroke="#fff" stroke-width="2"/>` }),
  sleepy: () => bird({ wings: [8, 8], eyes: "closed", beak: "small", crest: "droop", tilt: -3,
    back: mono("z", { cx: 152, cy: 48, h: 26, sw: 13, color: M.ice }) + mono("z", { cx: 174, cy: 24, h: 18, sw: 14, color: "#5C9BFF" }) }),
  handoff: () => bird({ wings: [12, null], eyes: "happy", beak: "closed", dx: 6,
    front: `<g transform="rotate(-12 172 140)"><rect x="150" y="124" width="42" height="32" rx="7" fill="#fff" stroke="${M.ice}" stroke-width="2.5"/>` + sparkle(171, 140, .95, "#5C9BFF") + `</g>` + wing(-58, "", "r") + sparkle(188, 104, .55, M.mint) }),
};
export function birdSvg(pose, { vb = "0 0 200 200" } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><defs>${birdDefs()}</defs>${POSES[pose]()}</svg>`;
}
