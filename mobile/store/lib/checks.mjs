/**
 * The layout check both renderers run.
 *
 * It lives here because both would otherwise carry a copy, and the copies would
 * drift the first time one of them learned something — which is exactly how the
 * SVG rule at the bottom of this comment was found.
 *
 * Everything is measured in the page, where 1 CSS px is 1 dp:
 *
 *   contentBottom  where the last child of `.content` ends.
 *   contentEnd     the same plus `.content`'s own 24dp padding-bottom, which no
 *                  child's box includes — the real end of the scrollable content,
 *                  and so the furthest a frame may pan.
 *   below          leaf elements whose bottom edge falls past the window. On a
 *                  screen with no ScrollView that is a clip; on one with a
 *                  ScrollView it is just the fold.
 *   lines          each `.solfaLine`'s height against its line-height and its
 *                  scroll width against its client width. A wrapped solfa line is
 *                  the one failure the eye slides straight past.
 *   subject        the box of `selector`, for the frames that pan onto something.
 *
 * `below` looks at leaf boxes, plus each outermost `<svg>` as a box of its own —
 * and nothing inside one. An outermost `<svg>` clips its own overflow, the same as
 * RN clips a `Svg`'s, so a path hanging past the viewBox is painted correctly and
 * only its geometry reads as off-screen; the brand ribbon on the splash and the
 * outro does exactly that. Where the `<svg>` itself lands still counts.
 */
export function inspect(page, selector = null) {
  return page.evaluate((sel) => {
    const label = (el) =>
      `${el.getAttribute("class") || el.tagName}@${Math.round(el.getBoundingClientRect().bottom)}`;

    const bottoms = [...document.querySelectorAll(".content > *")].map(
      (el) => el.getBoundingClientRect().bottom,
    );
    const contentBottom = bottoms.length === 0 ? 0 : Math.ceil(Math.max(...bottoms));

    const below = [...document.querySelectorAll(".safe *")]
      .filter((el) => {
        const parent = el.parentElement;
        if (parent !== null && parent.closest("svg") !== null) return false;
        return el.tagName.toLowerCase() === "svg" || el.querySelector("*") === null;
      })
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.bottom > window.innerHeight + 0.5;
      })
      .map(label);

    const lines = [...document.querySelectorAll(".solfaLine")].map((el) => ({
      h: el.offsetHeight,
      lh: parseFloat(getComputedStyle(el).lineHeight),
      w: el.scrollWidth,
      cw: el.clientWidth,
    }));

    const target = sel === null ? null : document.querySelector(sel);
    const box = target === null ? null : target.getBoundingClientRect();

    return {
      view: window.innerHeight,
      contentBottom,
      contentEnd: contentBottom === 0 ? 0 : contentBottom + 24,
      below,
      lines,
      subject:
        box === null
          ? null
          : {
              top: Math.round(box.top),
              bottom: Math.round(box.bottom),
              height: Math.round(box.height),
            },
    };
  }, selector);
}

/** The solfa-line failures, as messages. Shared because both sets show the card. */
export function solfaProblems(name, lines) {
  const out = [];
  for (const [i, l] of lines.entries()) {
    if (l.h > l.lh + 1) out.push(`${name}: solfa line ${i + 1} wrapped (${l.h}px / ${l.lh}px)`);
    if (l.w > l.cw + 1) out.push(`${name}: solfa line ${i + 1} overflows (${l.w} > ${l.cw})`);
  }
  return out;
}
