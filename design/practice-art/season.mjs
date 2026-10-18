// The Christmas season's art (board d-christmas): the cap the brand mark and Doh wear while the season is on, and
// the snowflake the Carol singer's burst throws beside the quavers. The cap is the one place holly red appears, so it
// never reads as an error; the Carol singer sticker itself is drawn with the others (badges.mjs).
//
// The cap is drawn round its brim's middle (0, 0) and ships in a 200 × 150 box with that point at (100, 125), so a
// surface lays it over a mark by placing that point: the clients' placements (on the mark's 331 × 438 box, on Doh's
// 200 × 200) are in mobile/src/lib/season.ts and web-site/assets/season.js.
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
