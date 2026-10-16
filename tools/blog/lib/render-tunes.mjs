// Tune pages (/hymns/tunes/<slug>): a hymn tune on its own, without words — the tunes the Christian
// Classics Ethereal Hymnary (CCEH) gives us. The engine's solfa grid, the same as plain text, the staff
// (MusicXML drawn by OSMD in the browser), the piano, the tune's metre with the hymns on this site that
// fit it, and the credits. A tune page is a tune file with "draft": false (lib/content.mjs loadTunes).
import { ORIGIN, OSMD, ASSET_VERSION } from "./site.mjs";
import { escapeHtml, jsonForScript } from "./util.mjs";
import { page, breadcrumbs, breadcrumbLd, ctaBox } from "./layout.mjs";
import { engineGrid, toLines, pitchLabel } from "./solfa.mjs";
import { gridHtml, textLinesHtml } from "./grid-html.mjs";
import { melodyToMusicXml } from "./musicxml.mjs";
import { PD_DIED_BEFORE, PD_PUBLISHED_BEFORE } from "./content.mjs";

export const CCEH = { name: "Christian Classics Ethereal Hymnary", short: "CCEH", url: "https://www.ccel.org/cceh/index.htm", terms: "https://www.ccel.org/cceh/cceh_cpr.htm" };

const DIATONIC = ["d", "r", "m", "f", "s", "l", "t"];
const SPAN_WORDS = { 12: "an octave", 11: "a seventh", 10: "a seventh", 9: "a sixth", 8: "a sixth", 7: "a fifth", 13: "a ninth", 14: "a ninth", 15: "a tenth", 16: "a tenth" };
/** Common names of hymn metres, as hymn books print them. */
const METRE_NAMES = { "8 6 8 6": "Common Metre (C.M.)", "8 8 8 8": "Long Metre (L.M.)", "6 6 8 6": "Short Metre (S.M.)", "8 6 8 6 8 6 8 6": "Common Metre Double (D.C.M.)", "8 8 8 8 8 8 8 8": "Long Metre Double (D.L.M.)", "6 6 8 6 6 6 8 6": "Short Metre Double (D.S.M.)" };

function years(p) { return p.traditional || !p.died ? "" : p.lived ? ` (${p.lived})` : p.born ? ` (${p.born}–${p.died})` : ` (died ${p.died})`; }
function peopleText(people) {
  const ps = people.map((p) => `${p.name}${years(p)}`);
  return ps.length > 1 ? `${ps.slice(0, -1).join(", ")} and ${ps[ps.length - 1]}` : ps[0] || "";
}
/** The people who gave the tune itself (not an arrangement or a harmony of it). */
const tuneMakers = (t) => t.music.filter((p) => !/^(Arranged|Harmony)/.test(p.role));
/** The page's name for the tune: the source's own spelling ("Lobe den Herren"), else the tune name in title case. */
export const tuneTitle = (t) => t.title || t.name.toLowerCase().replace(/(^|[\s(-])(\p{L})/gu, (m, a, c) => a + c.toUpperCase());
export const metreLabel = (m) => (m ? `${m.replace(/ (?=\d)/g, ".").replace(/\. \+ \./g, " + ")}${METRE_NAMES[m] ? ` — ${METRE_NAMES[m]}` : ""}` : null);

/** The credit line under the tune's name: where the melody came from (and its licence), then who wrote it. Text and HTML. */
export function tuneCreditLine(t) {
  const makers = tuneMakers(t);
  const by = makers.some((p) => !p.traditional) ? `by ${peopleText(makers.filter((p) => !p.traditional))}` : `(${makers.map((p) => p.name.replace(/^Traditional /, "traditional ")).join(", ") || "anonymous"})`;
  const rest = `tune ${t.name} ${by}.`;
  if (t.source !== CCEH.short) return { text: rest.replace(/^./, (c) => c.toUpperCase()), html: escapeHtml(rest.replace(/^./, (c) => c.toUpperCase())) };
  return {
    text: `Melody from the ${CCEH.name} (CCEH, public domain); ${rest}`,
    html: `Melody from the <a href="${escapeHtml(t.sourceUrl || CCEH.url)}" rel="noopener">${CCEH.name}</a> (CCEH, public domain); ${escapeHtml(rest)}`,
  };
}

/** Everything a tune page computes from its data: the grid, the score, facts. */
export function prepareTune(t) {
  const g = engineGrid(t.parsed, { key: t.key, underlay: "" });
  const lines = toLines(g.bars, { lineBars: t.lineBars || 4, pickup: t.pickup || 0 });
  const lab = g.labelled;
  const sorted = lab.slice().sort((a, b) => a.pitchMidi - b.pitchMidi);
  const lo = sorted[0], hi = sorted[sorted.length - 1], first = lab[0];
  const name = (n) => n.solfa + n.octaveMark;
  const used = [...new Set(lab.map((n) => n.solfa))];
  const title = tuneTitle(t);
  t.view = {
    title,
    header: g.header, doh: g.header.replace(/^Doh is /, ""), lines, key: t.key, time: t.time, tempo: t.tempo,
    first: { solfa: name(first), letter: pitchLabel(first.pitchMidi, t.key) },
    low: { solfa: name(lo), letter: pitchLabel(lo.pitchMidi, t.key) },
    high: { solfa: name(hi), letter: pitchLabel(hi.pitchMidi, t.key) },
    span: hi.pitchMidi - lo.pitchMidi,
    usedOrdered: DIATONIC.filter((s) => used.includes(s)), chromatic: used.filter((s) => !DIATONIC.includes(s)),
    musicXml: melodyToMusicXml(t.parsed, { key: t.key, title }),
    notes: g.notes.map((n) => ({ pitchMidi: n.pitchMidi, startBeat: n.startBeat, durBeats: n.durBeats })),
    quarters: g.bars.some((bar) => bar.some((c) => c.parts)),
    credit: tuneCreditLine(t),
    url: `/hymns/tunes/${t.slug}`,
  };
  return t;
}

export function tuneDescription(t) {
  const v = t.view, makers = tuneMakers(t).filter((p) => !p.traditional).map((p) => p.name);
  const options = [
    `${v.title}, the hymn tune${makers.length ? ` by ${makers.join(" and ")}` : ""}, in Tonic Solfa (doh is ${v.doh}): the solfa line by line, staff notation and a piano to sing along with.`,
    `${v.title}, the hymn tune, in Tonic Solfa (doh is ${v.doh}): the solfa, staff notation and a piano to sing along with.`,
    `${v.title}, the hymn tune, in Tonic Solfa with staff notation.`,
  ];
  return options.find((d) => d.length <= 155) || options[options.length - 1].slice(0, 155);
}

function faqFor(t, fits) {
  const v = t.view;
  const pd = t.music.filter((p) => !p.traditional);
  const out = [
    { q: `What is the doh of ${v.title}?`, a: `In this version, in ${v.key}, doh is ${v.doh}. If your choir sings it in another key, doh moves to the new key note and every solfa syllable stays the same — that is what movable doh means.` },
    { q: `What note does ${v.title} start on?`, a: `It starts on ${v.first.solfa} (${v.first.letter} in ${v.key})${t.pickup ? ", a pickup before the first full bar" : ""}. Find doh first, then sing up or down to ${v.first.solfa}.` },
  ];
  if (t.metre && t.metre !== "Irregular") out.push({ q: `What words can be sung to ${v.title}?`, a: `${v.title} is in the metre ${metreLabel(t.metre)}: lines of ${t.metre.replace(/ \+ /g, ", then ").replace(/ /g, ", ")} syllables. Words written in the same metre fit it${fits.length ? `, such as ${fits.slice(0, 3).map((h) => h.title).join(", ")}` : ""}; check where the stresses fall before you sing them together.` });
  out.push({ q: `Is ${v.title} in the public domain?`, a: `Yes. ${pd.length ? `${pd.map((p) => (p.lived ? `${p.name} lived in the ${p.lived}` : `${p.name} died in ${p.died}`)).join(", ")}; ` : ""}the tune was first published in ${t.musicPublished}. Everyone named died before ${PD_DIED_BEFORE} and it was published before ${PD_PUBLISHED_BEFORE}, so the tune is out of copyright in Nigeria, the UK, the EU and the United States. Modern arrangements of it can still be under copyright.` });
  return out;
}

/** Published hymns whose words are in the tune's metre (the same syllable counts), best known first. */
export function hymnsInMetre(t, hymns) {
  if (!t.metre || t.metre === "Irregular") return [];
  return hymns.filter((h) => h.metre && h.metre.trim() === t.metre).sort((a, b) => Number(!!a.importedFrom) - Number(!!b.importedFrom) || a.title.localeCompare(b.title));
}

export function renderTune(t, { hymns, posts }) {
  const v = t.view;
  const path = v.url;
  const crumbs = [["/", "Home"], ["/hymns", "Hymns"], [path, v.title]];
  const fits = hymnsInMetre(t, hymns);
  const faq = faqFor(t, fits);
  const description = tuneDescription(t);
  const makers = tuneMakers(t);
  const facts = [
    ["Key", v.key], ["Doh", v.doh], ["Time", v.time], ["Starts on", `${v.first.solfa} (${v.first.letter})`],
    ["Range", `${v.low.solfa} to ${v.high.solfa} (${v.low.letter} to ${v.high.letter}${SPAN_WORDS[v.span] ? `, ${SPAN_WORDS[v.span]}` : ""})`],
    ...(t.metre ? [["Metre", metreLabel(t.metre)]] : []),
    ["Music", makers.map((p) => p.name).join(", ") || "Anonymous"],
    ...(t.alsoKnownAs && t.alsoKnownAs.length ? [["Also called", t.alsoKnownAs.join(", ")]] : []),
  ];
  const credits = t.music.map((p) => `<li>${escapeHtml(p.role)}: ${escapeHtml(p.name)}${years(p)}</li>`);
  const fromCceh = t.source === CCEH.short;
  // Beginner guides that are live (posts come from the API at deploy time; an unpublished one is left out).
  const guides = [["how-to-read-tonic-solfa", "how to read Tonic Solfa"], ["how-to-find-the-doh-of-a-song", "how to find the doh of a song"]].filter(([slug]) => posts.some((p) => p.slug === slug));

  const body = `${breadcrumbs(crumbs)}
<article class="hymn-page tune-page">
<header class="post-header">
  <p class="kicker"><a href="/hymns">Hymn tunes in Tonic Solfa</a></p>
  <h1>${escapeHtml(v.title)}: hymn tune in Tonic Solfa</h1>
  <p class="post-lede">${escapeHtml(description)}</p>
</header>

<dl class="facts">
${facts.map(([k, val]) => `  <div><dt>${k}</dt><dd>${escapeHtml(val)}</dd></div>`).join("\n")}
</dl>
<p class="credit-line">${v.credit.html} <a href="/hymns/credits">Sources and licences</a>.</p>

<section aria-labelledby="solfa-title" class="card">
  <h2 id="solfa-title">The solfa</h2>
  <div class="solfa-head"><span class="doh">${escapeHtml(v.header)}</span><span class="time">${escapeHtml(v.time)}</span></div>
  <div class="hymn-grid" id="hymn-grid">
${gridHtml(v.lines, { beats: true, words: false })}
  </div>
  <div class="player" id="player" hidden>
    <button type="button" class="play-btn" id="play" data-track="Tune: play">Play</button>
    <label>Speed <select id="rate"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option></select></label>
    <span class="player-note">Piano, ${escapeHtml(String(v.tempo))} beats a minute. The note being played lights up.</span>
  </div>
</section>

<section aria-labelledby="lines-title">
  <h2 id="lines-title">The solfa line by line</h2>
  <p>The same solfa as plain text, easy to copy into your own notes or a WhatsApp message to the choir.</p>
  <div class="solfa-text">
<p class="doh">${escapeHtml(v.header)} · ${escapeHtml(v.time)}</p>
${textLinesHtml(v.lines, { words: false })}
  </div>
</section>

<section aria-labelledby="staff-title">
  <h2 id="staff-title">Staff notation</h2>
  <p>The melody on the treble staff in ${escapeHtml(v.key)}.</p>
  <div class="staff" id="staff" role="img" aria-label="${escapeHtml(v.title)}: the melody in staff notation"><p class="staff-wait">The staff is drawn here when you scroll to it.</p><noscript><p>Turn on JavaScript to see the staff. The solfa above does not need it.</p></noscript></div>
</section>

<section aria-labelledby="about-title">
  <h2 id="about-title">About the tune</h2>
  <ul class="credits">
${credits.join("\n")}
  </ul>
${t.metre ? `  <p>Metre: ${escapeHtml(metreLabel(t.metre))}.${fits.length ? ` Hymns on this site in the same metre: ${fits.slice(0, 8).map((h) => `<a href="/hymns/${h.slug}">${escapeHtml(h.title)}</a>`).join(", ")}.` : ""}</p>` : ""}
${fromCceh ? `  <p class="source-note">${v.credit.html} The CCEH gives its tunes as four-part scores; this page has the melody only, read from its MIDI file and checked against its incipit, and NoteFusion's engine wrote the solfa from the notes. It has not yet been checked against a printed hymn book.${t.music.some((p) => /^(Arranged|Harmony)/.test(p.role)) ? " The arranger named above set CCEH's harmony, which is not shown here." : ""}</p>` : ""}
${guides.length ? `  <p>New to solfa? Read ${guides.map(([slug, text]) => `<a href="/blog/${slug}">${text}</a>`).join(" and ")}.</p>` : ""}
</section>

<section class="faq" aria-labelledby="faq-title">
  <h2 id="faq-title">Questions about ${escapeHtml(v.title)}</h2>
${faq.map((f) => `  <h3>${escapeHtml(f.q)}</h3>\n  <p>${escapeHtml(f.a)}</p>`).join("\n")}
</section>

${ctaBox("tune")}
</article>
<p class="back-link"><a href="/hymns">← All hymns and tunes in Tonic Solfa</a></p>
<script type="application/json" id="hymn-data">${jsonForScript({ key: v.key, time: v.time, tempo: v.tempo, notes: v.notes, musicXml: v.musicXml, osmd: OSMD })}</script>`;

  const composers = makers.filter((p) => !p.traditional).map((p) => ({ "@type": "Person", name: p.name, ...(p.born && !p.lived ? { birthDate: String(p.born) } : {}), ...(p.lived ? {} : { deathDate: String(p.died) }) }));
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "MusicComposition",
      name: v.title,
      alternateName: [t.name, ...(t.alsoKnownAs || [])],
      url: ORIGIN + path,
      description,
      musicalKey: v.key,
      ...(composers.length ? { composer: composers } : {}),
      license: "https://creativecommons.org/publicdomain/mark/1.0/",
      ...(fromCceh ? {
        isBasedOn: { "@type": "CreativeWork", name: `${v.title} (${CCEH.name})`, url: t.sourceUrl || CCEH.url, publisher: { "@type": "Organization", name: CCEH.name, url: CCEH.url }, license: "https://creativecommons.org/publicdomain/mark/1.0/" },
        creditText: v.credit.text,
      } : {}),
    },
    breadcrumbLd(crumbs),
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ];
  const scripts = `<script src="/assets/choir.js?v=${ASSET_VERSION.choirJs}" defer></script>
<script src="/assets/hymn.js?v=${ASSET_VERSION.hymnJs}" defer></script>`;
  const titleTag = `${v.title} (hymn tune) — Tonic Solfa & Sheet Music (${v.header})`;
  return page({ path, title: titleTag.length <= 70 ? titleTag : `${v.title} hymn tune in Tonic Solfa (${v.header})`, description, jsonLd: ld, body, active: "/hymns", scripts });
}

/** What the hymn index's filter box matches for a tune page: its names, composers, metre and doh. */
export function tuneSearchText(t) {
  return [t.view.title, t.name, ...(t.alsoKnownAs || []), ...t.music.map((p) => p.name), t.metre || "", metreLabel(t.metre) || "", t.view.header, "tune"]
    .join(" ").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** A tune page as a list item on /hymns (compact: the index carries every tune). */
export function tuneIndexItem(t) {
  const makers = tuneMakers(t).map((p) => p.name).join(", ");
  return `    <li class="hymn-item" data-kind="tune" data-search="${escapeHtml(tuneSearchText(t))}">
      <h3><a href="${t.view.url}">${escapeHtml(t.view.title)}</a></h3>
      <p class="first-line">Hymn tune${t.metre ? ` · ${escapeHtml(metreLabel(t.metre).replace(/ — .*$/, ""))}` : ""}${makers ? ` · ${escapeHtml(makers)}` : ""}</p>
      <p class="story-meta"><span>${escapeHtml(t.view.header)}</span><span>${escapeHtml(t.view.time)}</span></p>
    </li>`;
}

/**
 * A published tune page as an entry for the worker's hymn matcher (the same shape as a published hymn's
 * "score" entry, with no words): the matcher may offer its notes, credited, and link to its page.
 */
export function tuneMatcherEntry(t) {
  const round = (x) => Math.round(x * 1000) / 1000;
  return {
    kind: "score",
    slug: `tune-${t.slug}`,
    title: t.view.title,
    tune: t.name,
    url: ORIGIN + t.view.url,
    source: t.source === CCEH.short ? CCEH.name : t.source || "NoteFusion",
    licence: t.licence || "Public domain.",
    credit: t.view.credit.text,
    checked: !!t.reviewed,
    key: t.key,
    time: String(t.time),
    pickup: t.pickup || 0,
    tempo: t.tempo,
    notes: t.parsed.notes.map((n) => [n.pitchMidi, round(n.startBeat), round(n.durBeats)]),
    lyrics: "",
  };
}
