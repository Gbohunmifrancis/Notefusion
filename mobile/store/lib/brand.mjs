/**
 * `BrandMark.tsx` and `StaffRibbon.tsx` as HTML/SVG.
 *
 * Both take **raw colours**, not the `var()` references in `C`: the ribbon and the
 * mark's flanking bars are SVG presentation attributes (`fill=`, `stroke=`), and
 * `var()` is not substituted there. Callers pass a literal (`"#FFFFFF"` on the
 * splash) or a value out of `paletteFor(mode)`.
 */

import { MARK_PNG, MARK_ASPECT } from "./tokens.mjs";

/**
 * The five-bar waveform flanking the mark. Symmetric about the middle, so
 * `mirrored` just reverses the order for the right-hand copy.
 */
function sideWave(size, color, mirrored) {
  const w = size * 0.36;
  const bars = [0.32, 0.58, 0.86, 0.5, 0.24];
  const ordered = mirrored ? [...bars].reverse() : bars;
  const rects = ordered
    .map((h, i) => {
      const barH = h * 74;
      return `<rect x="${i * 7.4}" y="${50 - barH / 2}" width="4" height="${barH}" rx="2" fill="${color}" opacity="${(0.35 + h * 0.45).toFixed(3)}"/>`;
    })
    .join("");
  return `<svg width="${w}" height="${size}" viewBox="0 0 36 100">${rects}</svg>`;
}

/**
 * The NoteFusion mark. The app recolours a white silhouette with `tintColor`;
 * here the same PNG is recoloured with a CSS mask, which is the closest thing
 * the browser has and gives identical edges.
 */
export function brandMark({ size = 96, color = "#2563EB", waveColor, showWaves = false } = {}) {
  const wave = waveColor ?? color;
  const markWidth = size * MARK_ASPECT;
  const waveWidth = size * 0.36;
  const totalWidth = showWaves ? markWidth + waveWidth * 2 : markWidth;

  const mark = `<div style="width:${markWidth}px;height:${size}px;background:${color};
    -webkit-mask-image:url('${MARK_PNG}');-webkit-mask-size:contain;
    -webkit-mask-repeat:no-repeat;-webkit-mask-position:center"></div>`;

  return `<div style="flex-direction:row;align-items:center;justify-content:center;width:${totalWidth}px;height:${size}px">
    ${showWaves ? sideWave(size, wave, false) : ""}
    ${mark}
    ${showWaves ? sideWave(size, wave, true) : ""}
  </div>`;
}

// ─── StaffRibbon ─────────────────────────────────────────────────────────────

/** Vertical gap between the five staff lines, in viewBox units. */
const GAP = 11;

const staffLine = (y) =>
  `<path d="M0 ${y} C 60 ${y - 14}, 120 ${y + 14}, 200 ${y} S 340 ${y - 14}, 400 ${y - 4}" stroke-width="1.4" fill="none"/>`;

/** A quaver. `up` puts the stem right of the head; `flag` adds the eighth's tail. */
function note(x, y, { up = true, flag = false } = {}) {
  const stemX = up ? x + 5.4 : x - 5.4;
  const stemEnd = up ? y - 26 : y + 26;
  return `<g>
    <ellipse cx="${x}" cy="${y}" rx="6.2" ry="4.6" transform="rotate(-20 ${x} ${y})"/>
    <line x1="${stemX}" y1="${y}" x2="${stemX}" y2="${stemEnd}" stroke-width="1.8"/>
    ${flag ? `<path d="M${stemX} ${stemEnd} c 7 3, 9 9, 5 15" stroke-width="1.8" fill="none"/>` : ""}
  </g>`;
}

/** Two quavers under a beam — the pair shape that reads instantly as music. */
function beamedPair(x, y) {
  const x2 = x + 17;
  return `<g>
    <ellipse cx="${x}" cy="${y}" rx="6.2" ry="4.6" transform="rotate(-20 ${x} ${y})"/>
    <ellipse cx="${x2}" cy="${y - 5}" rx="6.2" ry="4.6" transform="rotate(-20 ${x2} ${y - 5})"/>
    <line x1="${x + 5.4}" y1="${y}" x2="${x + 5.4}" y2="${y - 27}" stroke-width="1.8"/>
    <line x1="${x2 + 5.4}" y1="${y - 5}" x2="${x2 + 5.4}" y2="${y - 32}" stroke-width="1.8"/>
    <rect x="${x + 5.4}" y="${y - 32}" width="17" height="3.4" transform="rotate(-8 ${x + 5.4} ${y - 32})"/>
  </g>`;
}

/** The wavy stave along the bottom of splash, login and onboarding. */
export function staffRibbon({ width, height = 130, color, opacity = 0.28 } = {}) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 400 90" preserveAspectRatio="none" opacity="${opacity}">
  <g stroke="${color}" fill="none">${[0, 1, 2, 3, 4].map((i) => staffLine(20 + i * GAP)).join("")}</g>
  <g stroke="${color}" stroke-width="2.6" fill="none" stroke-linecap="round">
    <path d="M24 74 c -9 -3 -11 -14 -3 -19 c 9 -6 19 2 19 12 c 0 14 -14 22 -20 30"/>
    <path d="M20 97 c 9 -14 21 -22 21 -40 c 0 -16 -6 -30 -13 -30 c -6 0 -9 8 -8 17 c 1 12 8 22 14 30"/>
  </g>
  <g fill="${color}" stroke="${color}">
    ${beamedPair(112, 54)}
    ${note(86, 62, { flag: true })}
    ${note(168, 50)}
    ${note(205, 58, { flag: true })}
    ${beamedPair(248, 44)}
    ${note(306, 52, { flag: true })}
    ${note(344, 40)}
    ${note(378, 48)}
  </g>
</svg>`;
}
