// The Christmas season's art (board d-christmas): the cap the brand mark and Doh wear while the season is on, and
// the snowflake the Carol singer's burst throws beside the quavers. The cap is the one place holly red appears, so it
// never reads as an error; the Carol singer sticker itself is drawn with the others (badges.mjs).
//
// The cap is drawn round its brim's middle (0, 0) and ships in a 200 × 150 box with that point at (100, 125), so a
// surface lays it over a mark by placing that point: the clients' placements (on the mark's 331 × 438 box, on Doh's
// 200 × 200) are in mobile/src/lib/season.ts and web-site/assets/season.js.
//
// Halloween's art follows below, drawn the same way.
import { M, note } from "./mascot.mjs";

const svg = (vb, defs, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${defs ? `<defs>${defs}</defs>` : ""}${body}</svg>`;

/** Holly: the cap's red, a little lighter where the light catches it. */
export const HOLLY = ["#D84A5B", "#A82E3E"];
/** The cap's fur, warm white. */
export const FUR = ["#FFFDF8", "#E6DED0"];

/** The cap's shapes round its brim's middle, with `p` prefixed to its gradient ids. */
export function capShapes(p = "") {
  return `<path d="M52 -8C50 -50 22 -86 -14 -96C-40 -103 -66 -92 -80 -70L-68 -60C-58 -74 -46 -80 -34 -77C-46 -54 -52 -30 -52 -8Z" fill="url(#${p}hr)"/>` +
    `<path d="M30 -14C26 -46 8 -72 -18 -84" fill="none" stroke="#7E1F2D" stroke-opacity=".35" stroke-width="7" stroke-linecap="round"/>` +
    `<rect x="-62" y="-17" width="124" height="32" rx="16" fill="url(#${p}fur)"/>` +
    `<rect x="-62" y="-1" width="124" height="16" rx="8" fill="#000" opacity=".06"/>` +
    `<circle cx="-76" cy="-62" r="16" fill="url(#${p}fur)"/>`;
}

export function capDefs(p = "") {
  return `<linearGradient id="${p}hr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${HOLLY[0]}"/><stop offset="1" stop-color="${HOLLY[1]}"/></linearGradient>` +
    `<radialGradient id="${p}fur" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="${FUR[0]}"/><stop offset="1" stop-color="${FUR[1]}"/></radialGradient>`;
}

/** The cap on its own, its brim's middle at (100, 125) of a 200 × 150 box. */
export const cap = () => svg("0 0 200 150", capDefs(), `<g transform="translate(100 125)">${capShapes()}</g>`);

/** A six-armed snowflake for the Carol singer's burst, in the season's pale ice. */
export const snowflake = () => {
  const arm = `<path d="M16 3V29M12 6.5L16 10L20 6.5M12 25.5L16 22L20 25.5"/>`;
  return svg("0 0 32 32", "",
    `<g fill="none" stroke="#CFE0FF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">` +
    [0, 60, 120].map((d) => `<g transform="rotate(${d} 16 16)">${arm}</g>`).join("") + `</g>`);
};

// ── Halloween (board j-halloween): All Hallows' Eve, spooky-cute and never scary ────────────────────────────────────
// The witch hat the brand mark and Doh wear while the season is on, Boo (the small sheet ghost who sings beside Doh on
// the Midnight path), the bat the clients flit across the top third, and the bat the Night Singer's burst throws
// beside the quavers; the Night Singer sticker itself is drawn with the others (badges.mjs). No teeth, chains, blood or
// hollow eyes; no gold (Pro's alone).
//
// The hat is drawn round its brim's middle (0, 0) and ships in the cap's 200 × 150 box with that point at (100, 125),
// so a surface lays it over the mark (331 × 438) or Doh (200 × 200) exactly as it lays the cap; the clients' placements
// sit beside the cap's in mobile/src/lib/season.ts and web-site/assets/season.js.

/** The hat's charcoal, lighter where the moonlight catches the cone; the brim a step darker. */
export const CHARCOAL = ["#5E6578", "#3A404E", "#262A34"];
export const BRIM = ["#4C5263", "#20242C"];
/** Hat purple: the hat's band, and nowhere else in the app. */
export const HAT_PURPLE = "#5B3A9E";
/** Moon cream: the buckle, the hat's faint rim (so a charcoal hat still reads on the Night canvas) and the moon. */
export const MOON = "#EDE6CF";

const CONE = "M-40 -2C-37 -30 -31 -56 -24 -74C-31 -85 -46 -95 -68 -104C-47 -105 -24 -100 -9 -87C7 -63 27 -32 42 -2Z";
const RIM = `stroke="${MOON}" stroke-opacity=".38" stroke-width="2.6"`;

/** The hat's shapes round its brim's middle, with `p` prefixed to its gradient and clip ids. */
export function hatShapes(p = "") {
  return `<ellipse cy="2" rx="80" ry="15" fill="url(#${p}hb)" ${RIM}/>` + // the brim, its back edge under the cone
    `<path d="${CONE}" fill="url(#${p}hc)" ${RIM} stroke-linejoin="round"/>` + // the cone, its tip flopping back left
    `<path d="M-24 -70C-20 -50 -16 -28 -14 -6" fill="none" stroke="#fff" stroke-opacity=".1" stroke-width="7" stroke-linecap="round"/>` +
    `<g clip-path="url(#${p}hk)"><rect x="-60" y="-23" width="120" height="17" fill="${HAT_PURPLE}"/><rect x="-60" y="-23" width="120" height="3.5" fill="#fff" opacity=".12"/></g>` +
    `<rect x="-12" y="-22.5" width="17" height="15" rx="2.6" fill="none" stroke="${MOON}" stroke-width="3.4"/>` + // the buckle
    `<path d="M-80 2C-62 12 -30 17 0 17C30 17 62 12 80 2" fill="none" ${RIM}/>` + // the brim's front edge over the cone's foot
    `<path d="M-70 4C-50 11 -24 13.5 0 13.5C24 13.5 50 11 70 4" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="5"/>`;
}

export function hatDefs(p = "") {
  return `<linearGradient id="${p}hc" x1="0" y1="0" x2="1" y2=".4"><stop offset="0" stop-color="${CHARCOAL[0]}"/><stop offset=".55" stop-color="${CHARCOAL[1]}"/><stop offset="1" stop-color="${CHARCOAL[2]}"/></linearGradient>` +
    `<linearGradient id="${p}hb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BRIM[0]}"/><stop offset="1" stop-color="${BRIM[1]}"/></linearGradient>` +
    `<clipPath id="${p}hk"><path d="${CONE}"/></clipPath>`;
}

/** The hat on its own, its brim's middle at (100, 125) of a 200 × 150 box (the cap's box and anchor). */
export const hat = () => svg("0 0 200 150", hatDefs(), `<g transform="translate(100 125)">${hatShapes()}</g>`);

// Boo: a 200 × 200 box like Doh's, floating over its shadow at y 190. Doh's round eyes with a white glint and Doh's
// blush; a soft scalloped hem; little arms that turn at the shoulder as Doh's wings do.
const SHEET = "M100 34C140 34 160 64 160 104V160C160 168 154 172 147 167C141 162 135 162 130 168C124 175 116 175 110 168C105 162 96 162 90 168C84 175 76 175 70 168C65 162 59 162 53 167C46 172 40 168 40 160V104C40 64 60 34 100 34Z";
const ARM = "M-1 -3C-13 1 -19 9 -17 17C-9 15 -3 9 1 3Z";
const SHEET_EDGE = "#BCC7DC";
const booArm = (a, side) => {
  const g = `<path transform="translate(43 115) rotate(${a})" d="${ARM}" fill="#E6ECF7" stroke="${SHEET_EDGE}" stroke-width="2" stroke-linejoin="round"/>`;
  return side === "r" ? `<g transform="matrix(-1 0 0 1 200 0)">${g}</g>` : g;
};
const BOO_EYES = {
  open: (c) => `<g fill="${c}"><ellipse cx="80" cy="92" rx="10" ry="12"/><ellipse cx="120" cy="92" rx="10" ry="12"/></g><g fill="#fff"><circle cx="83.5" cy="87" r="3.6"/><circle cx="123.5" cy="87" r="3.6"/></g>`,
  closed: (c) => `<path d="M70 93Q80 100 90 93M110 93Q120 100 130 93" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>`,
};
const BOO_MOUTH = {
  smile: (c) => `<path d="M93 114Q100 120 107 114" fill="none" stroke="${c}" stroke-width="4.5" stroke-linecap="round"/>`,
  oo: (c) => `<ellipse cx="100" cy="118" rx="7.5" ry="9" fill="${c}"/><ellipse cx="100" cy="121" rx="4.2" ry="3.6" fill="${M.cheek}" opacity=".75"/>`,
};

export function booDefs(p = "") {
  return `<linearGradient id="${p}sh" x1=".25" y1="0" x2=".75" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".6" stop-color="#EEF2FA"/><stop offset="1" stop-color="#CFD8EA"/></linearGradient>`;
}

/** opts: eyes, mouth, arms [l, r] angles (null for none), edge (the sheet's outline), shadow, cheeks, eye (colour), back */
export function boo(o = {}, p = "") {
  const { eyes = "open", mouth = "smile", arms = [0, 0], edge = true, shadow = true, cheeks = true, eye = M.eye, back = "" } = o;
  const arm = (arms[0] != null ? booArm(arms[0], "l") : "") + (arms[1] != null ? booArm(arms[1], "r") : "");
  return (shadow ? `<ellipse cx="100" cy="190" rx="34" ry="4.5" fill="#0A0D14" opacity=".14"/>` : "") + back +
    `<path d="${SHEET}" fill="url(#${p}sh)"${edge ? ` stroke="${SHEET_EDGE}" stroke-width="2"` : ""}/>` +
    `<ellipse cx="74" cy="62" rx="18" ry="9" transform="rotate(-32 74 62)" fill="#fff" opacity=".7"/>` + arm +
    BOO_EYES[eyes](eye) +
    (cheeks ? `<g fill="${M.cheek}" opacity=".5"><ellipse cx="66" cy="110" rx="8" ry="5"/><ellipse cx="134" cy="110" rx="8" ry="5"/></g>` : "") +
    BOO_MOUTH[mouth](eye);
}

// Each pose is Boo's options, so the blink twin is the same options with the eyes shut (as Doh's are).
const BOO_POSE_OPTS = {
  idle: { arms: [0, 0], mouth: "smile" },
  // singing "oo", arms lifted a little, one small quaver drifting up beside
  sing: { arms: [-22, -22], mouth: "oo", back: note(162, 56, .85, M.ice) },
};
export const BOO_POSES = Object.keys(BOO_POSE_OPTS);
export const booSvg = (pose) => svg("0 0 200 200", booDefs(), boo(BOO_POSE_OPTS[pose]));
/** The idle Boo with the eyes shut, shown for a moment now and then, as Doh's blink twins are. */
export const booBlinkSvg = () => svg("0 0 200 200", booDefs(), boo({ ...BOO_POSE_OPTS.idle, eyes: "closed" }));

/** Moves an absolute-only path (M L C Z) by (dx, dy). */
const moved = (d, dx, dy) => { let i = 0; return d.replace(/-?\d*\.?\d+/g, (n) => String(Math.round((Number(n) + (i++ % 2 ? dy : dx)) * 10) / 10)); };
/** One bat round its middle: scalloped wings, two small ears; 37 wide. */
const BAT = "M0 -3.2L-1.6 -6.4L-2.6 -2.6C-5.5 -6.8 -11.5 -8 -18.5 -4C-15.4 -3 -14.2 -.4 -14.4 2.6C-12.4 .8 -10.2 .8 -9 2.8C-7.4 .8 -5.2 .9 -4.2 3.8C-3 2 -1.4 2.2 0 4.4C1.4 2.2 3 2 4.2 3.8C5.2 .9 7.4 .8 9 2.8C10.2 .8 12.4 .8 14.4 2.6C14.2 -.4 15.4 -3 18.5 -4C11.5 -8 5.5 -6.8 2.6 -2.6L1.6 -6.4Z";
/**
 * The clients' flitting bat: one path in currentColor, its middle at (20, 10) of a 40 × 20 box (so a wing flap is a
 * scale(1, .55) round the middle). The client gives the colour, pale #C9D1E0 on Night and slate #475569 on Day (board
 * j-halloween): SvgXml's color prop on the phone; CSS color on an inlined copy, or a CSS mask, on the web. It has no
 * colour of its own, so a bare <img> of it would draw black.
 */
export const bat = () => svg("0 0 40 20", "", `<path fill="currentColor" d="${moved(BAT, 20, 11.2)}"/>`);

/** The burst's bat: a mid moonlit slate, so it shows on the Night sheet and the Day one alike. */
export const BAT_CONFETTI = "#A9B4CB";
/** A bat for the Night Singer's burst, beside the quavers: the same bat, tipped, in a 32 × 32 piece. */
export const batConfetti = () => svg("0 0 32 32", "",
  `<path transform="translate(16 16.5) rotate(-12) scale(.8)" d="${BAT}" fill="${BAT_CONFETTI}"/>`);
