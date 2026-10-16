// HTML for the engine's solfa grid: the same table.hymn / .cell markup the shared-sheet page
// (web-site/assets/sheet.js) builds in the browser, here written out as static, crawlable text.
import { escapeHtml } from "./util.mjs";
import YAML from "yaml";
import { engineGrid, toLines, scaleMelody, transposeInterval, loadEngine } from "./solfa.mjs";

/** Lines of bars as tables. With `beats`, each syllable carries its beat for the page's player. */
export function gridHtml(lines, { beats = false, words = true } = {}) {
  return lines.map((line) => {
    const tds = line.map((bar) => "<td>" + bar.map((c) => {
      const b = beats ? ` data-beat="${c.beat}"` : "";
      const lyric = words ? `<i>${escapeHtml(c.lyric || "")}</i>` : "";
      // A held or silent half beat with no word under it is drawn narrow, so a line of four bars fits a page.
      const hold = (c.solfa === "-" || c.solfa === "_") && !c.lyric ? " hold" : "";
      return `<span class="cell${hold}"><b${b}>${escapeHtml(c.solfa)}</b>${lyric}</span>`;
    }).join("") + "</td>").join("");
    return `<table class="hymn"><tr>${tds}</tr></table>`;
  }).join("\n");
}

/** The words sung in one bar; a word that runs on into the next bar keeps its hyphen ("A-"). */
function barWords(bar) {
  let out = "";
  for (const c of bar) {
    const s = c.lyric;
    if (!s || s === "_") continue;
    if (out && !out.endsWith("-")) out += " ";
    out += s;
  }
  return out.replace(/-(?=\S)/g, "");
}

/**
 * Plain-text solfa, line by line, as bars: each bar is one unit (its solfa, then the words sung in it), so
 * on a narrow screen a line wraps at a bar line and never inside a bar. Read in order, the solfa is the
 * line's text exactly (lineText): "| s, - | d - - - m d | … |".
 */
export function textLinesHtml(lines, { words = true } = {}) {
  return lines.map((line) => {
    const bars = line.map((bar, i) => {
      const text = "| " + bar.map((c) => c.solfa).join(" ") + (i === line.length - 1 ? " |" : " ");
      const w = words ? barWords(bar) : "";
      return `<span class="solfa-bar"><code>${escapeHtml(text)}</code>${words ? `<span class="solfa-words">${escapeHtml(w)}</span>` : ""}</span>`;
    }).join("");
    return `<div class="solfa-line">${bars}</div>`;
  }).join("\n");
}

/**
 * A ```solfa block in a post, rendered by the engine. The block is YAML:
 *   hymn: amazing-grace      # a hymn from content/hymns
 *   bars: 1-5                # optional; grid bars, the pickup bar counts as bar 1
 *   key: F major             # optional; the same tune moved to another key
 *   words: false             # optional; leave the words out
 * or
 *   scale: G major           # the scale, letter names under the solfa
 *   harmonic: true           # optional, minor keys: the raised seventh
 * Returns { html, hymn } (the hymn slug it used, if any). Throws with a readable message.
 */
export function renderSolfaBlock(source, { hymnsBySlug }) {
  let spec;
  try { spec = YAML.parse(source) ?? {}; } catch (e) { throw new Error(`solfa block: ${e.message}`); }
  if (typeof spec !== "object") throw new Error("solfa block: write fields like `hymn: amazing-grace`");
  const known = new Set(["hymn", "bars", "key", "words", "scale", "harmonic", "caption"]);
  for (const k of Object.keys(spec)) if (!known.has(k)) throw new Error(`solfa block: unknown field "${k}"`);

  if (spec.scale) {
    const { melody, words } = scaleMelody(String(spec.scale), { harmonic: !!spec.harmonic });
    const g = engineGrid(melody, { key: String(spec.scale), underlay: words });
    const label = `${spec.scale}${spec.harmonic ? " (harmonic minor)" : ""} scale`;
    const caption = spec.caption || `The ${label}: solfa above, letter names below.`;
    return {
      hymn: null,
      html: figure(g.header, "4/4", gridHtml([g.bars], { words: true }), caption, label),
    };
  }
  if (!spec.hymn) throw new Error("solfa block: give a `hymn:` or a `scale:`");
  const hymn = hymnsBySlug.get(String(spec.hymn));
  if (!hymn) throw new Error(`solfa block: no published hymn "${spec.hymn}"`);
  const tune = hymn.tuneData;
  const key = spec.key ? String(spec.key) : tune.key;
  const transpose = spec.key ? transposeInterval(tune.key, key) : 0;
  const g = engineGrid(tune.parsed, { key, underlay: hymn.underlay, transpose });
  let bars = g.bars, first = 1;
  if (spec.bars != null) {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(spec.bars));
    if (!m) throw new Error(`solfa block: bars must look like 1-4`);
    first = Number(m[1]);
    const last = Number(m[2]);
    if (first < 1 || last < first || last > bars.length) throw new Error(`solfa block: ${hymn.title} has bars 1-${bars.length}`);
    bars = bars.slice(first - 1, last);
  }
  const pickup = first === 1 ? tune.pickup || 0 : 0;
  // Four bars a line, or two when a bar has eight or more half-beat cells (4/4), to fit the column.
  const lineBars = loadEngine().beatsPerBar(tune.time) * 2 >= 8 ? 2 : 4;
  const lines = toLines(bars, { lineBars, pickup });
  const words = spec.words !== false;
  const where = spec.bars ? `, bars ${spec.bars}` : "";
  const caption = spec.caption || `${hymn.shortTitle || hymn.title}${where}, in ${key}.`;
  return {
    hymn: hymn.slug,
    html: figure(g.header, tune.time, gridHtml(lines, { words }), caption, `${hymn.title} in Tonic Solfa`, `/hymns/${hymn.slug}`),
  };
}

function figure(header, time, grid, caption, label, link) {
  const more = link ? ` <a href="${link}">See the whole hymn</a>.` : "";
  return `<figure class="solfa-example" aria-label="${escapeHtml(label)}">
<div class="solfa-head"><span class="doh">${escapeHtml(header)}</span><span class="time">${escapeHtml(time)}</span></div>
<div class="hymn-grid">
${grid}
</div>
<figcaption>${escapeHtml(caption)}${more} <span class="by-engine">Solfa written by NoteFusion’s engine.</span></figcaption>
</figure>`;
}
