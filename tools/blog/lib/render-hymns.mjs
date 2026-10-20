// Hymn pages: the engine's solfa grid with the first verse, the same as plain text line by line,
// the staff (MusicXML drawn by OSMD in the browser), every verse, and facts read off the melody.
import { ORIGIN, OSMD, ASSET_VERSION } from "./site.mjs";
import { escapeHtml, jsonForScript } from "./util.mjs";
import { page, breadcrumbs, breadcrumbLd, ctaBox } from "./layout.mjs";
import { engineGrid, toLines, pitchLabel } from "./solfa.mjs";
import { gridHtml, textLinesHtml } from "./grid-html.mjs";
import { melodyToMusicXml } from "./musicxml.mjs";
import { PD_DIED_BEFORE, PD_PUBLISHED_BEFORE } from "./content.mjs";
import { CCEH, tuneIndexItem } from "./render-tunes.mjs";
import { identifyCallout, IDENTIFY_PATH } from "./render-identify.mjs";
import { personKey } from "./collections.mjs";
import { moreLinks, occasionLinks, browseLinks, personLink, pdfButton, pdfAlternate } from "./render-collections.mjs";
import { pdfPath } from "./render-pdf.mjs";

const DIATONIC = ["d", "r", "m", "f", "s", "l", "t"];
const TIME_WORDS = { "2/4": "two crotchet beats", "3/4": "three crotchet beats", "4/4": "four crotchet beats", "6/8": "two dotted-crotchet beats (six quavers)", "3/2": "three minim beats", "9/8": "three dotted-crotchet beats (nine quavers)", "12/8": "four dotted-crotchet beats (twelve quavers)", "2/2": "two minim beats", "6/4": "six crotchet beats (two dotted minims)", "8/4": "eight crotchet beats", "9/4": "nine crotchet beats (three dotted minims)" };

/** A person's dates as the source gives them: "(1725–1807)", "(died 1604)", "(5th century)", "(fl. c. 1400)". */
function years(p) { return p.traditional ? "" : p.lived ? ` (${p.lived})` : p.born ? ` (${p.born}–${p.died})` : ` (died ${p.died})`; }
/** "died in 1807", or for a writer the source dates only roughly, "lived in the 5th century". */
function diedPhrase(p) { return p.lived ? (/^fl\./.test(p.lived) ? `${p.name} lived around ${p.lived.replace(/^fl\.\s*c\.\s*/, "")}` : `${p.name} lived in the ${p.lived}`) : `${p.name} died in ${p.died}`; }

export const OHP = { name: "Open Hymnal Project", url: "http://openhymnal.org/", copying: "http://openhymnal.org/copying.html", editor: "Brian J. Dumont" };

/** "Joseph Mohr (1792–1848)" for each person, joined with "and". */
function peopleText(people) {
  const ps = people.map((p) => `${p.name}${years(p)}`);
  return ps.length > 1 ? `${ps.slice(0, -1).join(", ")} and ${ps[ps.length - 1]}` : ps[0] || "";
}

/**
 * The credit line under a hymn's title: where the melody and words came from (and their licence),
 * then the tune and its composer, the words and their writers. Plain text, and HTML with the source linked.
 */
export function creditLine(h) {
  const t = h.tuneData;
  const authors = h.text.filter((p) => !/^Translated/.test(p.role)), translators = h.text.filter((p) => /^Translated/.test(p.role));
  const parts = [];
  const tuneCredit = `tune ${t.name} ${t.music.some((p) => !p.traditional) ? `by ${peopleText(t.music.filter((p) => !p.traditional))}` : `(${t.music.map((p) => p.name.replace(/^Traditional /, "traditional ")).join(", ")})`}`;
  parts.push(tuneCredit);
  parts.push(`words by ${peopleText(authors)}`);
  if (translators.length) parts.push(`translated by ${peopleText(translators)}`);
  let lead = "", leadHtml = "";
  const what = h.source === OHP.name ? "Melody and words" : t.source === OHP.name ? "Melody" : null;
  if (what) {
    lead = `${what} from the ${OHP.name} (public domain), edited by ${OHP.editor}; `;
    const url = (h.source === OHP.name ? h.sourceUrl : t.sourceUrl) || OHP.url;
    leadHtml = `${what} from the <a href="${escapeHtml(url)}" rel="noopener">${OHP.name}</a> (public domain), edited by ${OHP.editor}; `;
  }
  const rest = parts.join("; ") + ".";
  const text = (lead + rest).replace(/^./, (c) => c.toUpperCase());
  const html = (leadHtml + escapeHtml(rest)).replace(/^./, (c) => c.toUpperCase());
  return { text, html };
}
function names(people) { return people.filter((p) => !p.traditional).map((p) => p.name); }

/** Everything about a hymn that is computed from its data: the grid, the score, facts for the page. */
export function prepareHymn(h) {
  const t = h.tuneData;
  const g = engineGrid(t.parsed, { key: t.key, underlay: h.underlay });
  const lines = toLines(g.bars, { lineBars: t.lineBars || 4, pickup: t.pickup || 0 });
  const lab = g.labelled;
  const sorted = lab.slice().sort((a, b) => a.pitchMidi - b.pitchMidi);
  const lo = sorted[0], hi = sorted[sorted.length - 1], first = lab[0];
  const name = (n) => n.solfa + n.octaveMark;
  const used = [...new Set(lab.map((n) => n.solfa))];
  const usedOrdered = DIATONIC.filter((s) => used.includes(s));
  const chromatic = used.filter((s) => !DIATONIC.includes(s));
  const firstWords = h.verses[0].lines[0].replace(/[,;:.!?]+$/, "");
  const doh = g.header.replace(/^Doh is /, "");
  h.view = {
    header: g.header, doh, lines, key: t.key, time: t.time, tempo: t.tempo,
    first: { solfa: name(first), letter: pitchLabel(first.pitchMidi, t.key) },
    low: { solfa: name(lo), letter: pitchLabel(lo.pitchMidi, t.key) },
    high: { solfa: name(hi), letter: pitchLabel(hi.pitchMidi, t.key) },
    span: hi.pitchMidi - lo.pitchMidi,
    usedOrdered, chromatic, firstWords,
    pickupWord: t.pickup ? pickupWords(h.underlay) : null,
    musicXml: melodyToMusicXml(t.parsed, { key: t.key, title: h.title, underlay: h.underlay }),
    notes: g.notes.map((n) => ({ pitchMidi: n.pitchMidi, startBeat: n.startBeat, durBeats: n.durBeats })),
    quarters: g.bars.some((bar) => bar.some((c) => c.parts)),
    credit: creditLine(h),
  };
  return h;
}

/** How to name the pickup: "the word “That”" or "the first syllable of “Amazing”". */
function pickupWords(underlay) {
  const tok = underlay.trim().split(/\s+/)[0];
  const word = tok.replace(/[_-]/g, "").replace(/[,;:.!?]+$/, "");
  return tok.includes("-") ? `the first syllable of “${word}”` : `the word “${word}”`;
}

const SPAN_WORDS = { 12: "an octave", 11: "a seventh", 10: "a seventh", 9: "a sixth", 8: "a sixth", 7: "a fifth", 13: "a ninth", 14: "a ninth", 15: "a tenth", 16: "a tenth" };

export function hymnName(h) { return h.shortTitle || h.title; }

export function hymnPageTitle(h) {
  const base = `${hymnName(h)} — Tonic Solfa & Sheet Music (${h.view.header})`;
  return base.length <= 70 ? base : `${hymnName(h)} in Tonic Solfa (${h.view.header})`;
}

function faqFor(h) {
  const v = h.view, n = hymnName(h);
  const pdPeople = [...h.text, ...h.tuneData.music].filter((p) => !p.traditional);
  return [
    { q: `What is the doh of ${n}?`, a: `In this version, in ${v.key}, doh is ${v.doh}. If your choir sings it in another key, doh moves to the new key note and every solfa syllable stays the same — that is what movable doh means.` },
    { q: `What note does ${n} start on?`, a: `It starts on ${v.first.solfa} (${v.first.letter} in ${v.key})${v.pickupWord ? `, a pickup on ${v.pickupWord} before the first full bar` : ""}. Find doh first, then sing up or down to ${v.first.solfa}.` },
    { q: `Is ${n} in the public domain?`, a: `Yes. ${pdPeople.length ? `${pdPeople.map(diedPhrase).join(", ")}; ` : ""}the words were first published in ${h.textPublished} and the music in ${h.tuneData.musicPublished}. Everyone named died before ${PD_DIED_BEFORE} and both were published before ${PD_PUBLISHED_BEFORE}, so the hymn is out of copyright in Nigeria, the UK, the EU and the United States. Modern arrangements and translations can still be under copyright.` },
  ];
}

export function renderHymn(h, { hymns, posts, occasions = [], personByKey = new Map() }) {
  const v = h.view, t = h.tuneData, n = hymnName(h);
  const path = `/hymns/${h.slug}`;
  const pdf = pdfPath(path);
  const link = (p) => personLink(p, personByKey);
  // "More Christmas hymns", then "More by …" for the writers (words first) and composers with a page.
  const myPeople = [...h.text, ...t.music].map((p) => !p.traditional && personByKey.get(personKey(p))).filter((p, i, all) => p && all.indexOf(p) === i);
  const more = moreLinks({ item: h, occasions: occasions.filter((o) => o.hymns.includes(h)), people: myPeople });
  const crumbs = [["/", "Home"], ["/hymns", "Hymns"], [path, n]];
  const tuneKey = (x) => x.tuneData.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const sameTune = hymns.filter((o) => o !== h && (o.tune === h.tune || (tuneKey(o) === tuneKey(h) && o.tuneData.melody === h.tuneData.melody)));
  const usedIn = posts.filter((p) => p.hymnsUsed.includes(h.slug));
  const faq = faqFor(h);
  const verse1 = h.verses[0].lines.join("\n");

  const facts = [
    ["Key", v.key], ["Doh", v.doh], ["Time", v.time], ["Starts on", `${v.first.solfa} (${v.first.letter})`],
    ["Range", `${v.low.solfa} to ${v.high.solfa} (${v.low.letter} to ${v.high.letter}${SPAN_WORDS[v.span] ? `, ${SPAN_WORDS[v.span]}` : ""})`],
    ["Tune", t.name], ["Words", h.text.map(link).join(", "), true], ["Music", t.music.map(link).join(", "), true],
  ];
  const tips = [
    `<li><strong>Find doh first.</strong> Play or hum ${escapeHtml(v.doh)} and sing <em>d r m f s</em> up from it, so the whole choir has the key in their ears before you start.</li>`,
    `<li><strong>Pitch the first note.</strong> The tune starts on <strong>${escapeHtml(v.first.solfa)}</strong> (${escapeHtml(v.first.letter)})${v.pickupWord ? `, on ${escapeHtml(v.pickupWord)}, as a pickup before the first full bar` : ""}.</li>`,
    `<li><strong>Count the time.</strong> ${escapeHtml(v.time)} means ${TIME_WORDS[v.time] || `${escapeHtml(v.time)} time`} in each bar. In the grid every cell is half a crotchet: a dash (–) holds the note before it, and _ is a rest.${v.quarters ? " A cell split by a comma holds two quarter beats: <em>d -,r</em> is a dotted quaver and a semiquaver, <em>d,r</em> two semiquavers. That comma sits between two syllables; an octave mark sits small and low against its own letter (s,)." : ""}</li>`,
    `<li><strong>Know the notes.</strong> The tune uses ${v.usedOrdered.map((s) => `<em>${s}</em>`).join(" ")}${v.chromatic.length ? ` and the chromatic ${v.chromatic.map((s) => `<em>${s}</em>`).join(" ")}` : ""}${v.usedOrdered.length <= 5 && !v.chromatic.length ? ` — only ${v.usedOrdered.length} different notes, so it is a good one for a choir new to solfa` : ""}. A comma after a note (s,) is the octave below; an apostrophe (d') is the octave above.</li>`,
  ];
  const verses = h.verses.map((vv, i) => `<div class="verse">${vv.label ? `<p class="verse-label">${escapeHtml(vv.label)}</p>` : ""}<p>${vv.lines.map(escapeHtml).join("<br>")}</p>${vv.note ? `<p class="verse-note">${escapeHtml(vv.note)}</p>` : ""}</div>`);
  const credits = [...h.text, ...t.music].map((p) => `<li>${escapeHtml(p.role)}: ${link(p)}${years(p)}</li>`);

  const body = `${breadcrumbs(crumbs)}
<article class="hymn-page">
<header class="post-header">
  <h1>${escapeHtml(h.title)} in Tonic Solfa</h1>
  <p class="post-lede">${escapeHtml(h.description)}</p>
</header>

<section aria-labelledby="solfa-title" class="card">
  <h2 id="solfa-title">The solfa with the words</h2>
  <div class="solfa-head"><span class="doh">${escapeHtml(v.header)}</span><span class="time">${escapeHtml(v.time)}</span></div>
  <div class="hymn-grid" id="hymn-grid">
${gridHtml(v.lines, { beats: true })}
  </div>
  <div class="player" id="player" hidden>
    <button type="button" class="play-btn" id="play" data-track="Hymn: play">Play</button>
    <label>Speed <select id="rate"><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option></select></label>
    <span class="player-note">Piano, ${escapeHtml(String(v.tempo))} beats a minute. The note being played lights up.</span>
  </div>
</section>
<!-- The solfa first, then the way into the app beside it, then the PDF and the facts (board l-ux-high/06b): on a phone
     the solfa used to start some 1,100px down, and the only way into the app was at the very end. -->
<p class="inline-cta"><a href="/app?utm_source=hymn-inline" data-track="Hymn: inline cta">Got your choir's recording? Get it in solfa →</a></p>
${pdfButton(path, "Hymn: download PDF")}

<dl class="facts">
${facts.map(([k, val, html]) => `  <div><dt>${k}</dt><dd>${html ? val : escapeHtml(val)}</dd></div>`).join("\n")}
</dl>
<p class="credit-line">${v.credit.html} <a href="/hymns/credits">Sources and licences</a>.</p>

<section aria-labelledby="lines-title">
  <h2 id="lines-title">The solfa line by line</h2>
  <p>The same solfa as plain text, a line of the hymn at a time, with the words of the first verse under it — easy to copy into your own notes or a WhatsApp message to the choir. To print it, <a href="${pdf}" type="application/pdf" data-track="Hymn: download PDF (text)">download the solfa as a PDF</a>.</p>
  <div class="solfa-text">
<p class="doh">${escapeHtml(v.header)} · ${escapeHtml(v.time)}</p>
${textLinesHtml(v.lines)}
  </div>
</section>

<section aria-labelledby="staff-title">
  <h2 id="staff-title">Staff notation</h2>
  <p>The melody on the treble staff in ${escapeHtml(v.key)}, with the first verse under the notes.</p>
  <div class="staff" id="staff" role="img" aria-label="${escapeHtml(n)}: the melody in staff notation"><p class="staff-wait">The staff is drawn here when you scroll to it.</p><noscript><p>Turn on JavaScript to see the staff. The solfa above does not need it.</p></noscript></div>
</section>

<section aria-labelledby="words-title">
  <h2 id="words-title">The words</h2>
  <div class="verses">
${verses.join("\n")}
  </div>
</section>

<section aria-labelledby="sing-title">
  <h2 id="sing-title">How to sing it from the solfa</h2>
  <ul class="tips">
${tips.join("\n")}
  </ul>
${guideLine(posts)}
</section>

<section aria-labelledby="about-title">
  <h2 id="about-title">About the hymn</h2>
${(h.about || []).map((p) => `  <p>${escapeHtml(p)}</p>`).join("\n")}
  <ul class="credits">
${credits.join("\n")}
  </ul>
${h.source || t.source ? `  <p class="source-note">${v.credit.html} ${h.source === OHP.name || t.source === OHP.name ? `The Open Hymnal Project publishes ${h.source === OHP.name ? "this hymn" : "this tune"} as public domain; NoteFusion's engine wrote the solfa from its notes. The melody has not yet been checked against a printed hymn book.` : ""}</p>` : ""}
${sameTune.length ? `  <p>Sung to the same tune: ${sameTune.map((o) => `<a href="/hymns/${o.slug}">${escapeHtml(o.title)}</a>`).join(", ")}.</p>` : ""}
</section>

<section class="faq" aria-labelledby="faq-title">
  <h2 id="faq-title">Questions about ${escapeHtml(n)}</h2>
${faq.map((f) => `  <h3>${escapeHtml(f.q)}</h3>\n  <p>${escapeHtml(f.a)}</p>`).join("\n")}
</section>

${ctaBox("hymn")}
</article>
${more}
${usedIn.length ? `<section class="side-list" aria-labelledby="posts-title"><h2 id="posts-title">On the blog</h2><ul>${usedIn.map((p) => `<li><a href="${p.url}">${escapeHtml(p.title)}</a></li>`).join("")}</ul></section>` : ""}
<p class="back-link"><a href="/hymns">← All hymns in Tonic Solfa</a></p>
<script type="application/json" id="hymn-data">${jsonForScript({ key: v.key, time: v.time, tempo: v.tempo, notes: v.notes, musicXml: v.musicXml, osmd: OSMD })}</script>`;

  const personLd = (p) => {
    const page = personByKey.get(personKey(p));
    return { "@type": "Person", name: p.name, ...(p.born && !p.lived ? { birthDate: String(p.born) } : {}), ...(p.lived ? {} : { deathDate: String(p.died) }), ...(page ? { url: ORIGIN + page.url } : {}) };
  };
  const composers = t.music.filter((p) => !p.traditional).map(personLd);
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "MusicComposition",
      name: h.title,
      url: ORIGIN + path,
      description: h.description,
      inLanguage: "en",
      musicalKey: v.key,
      ...(composers.length ? { composer: composers } : {}),
      lyricist: h.text.filter((p) => !p.traditional).map(personLd),
      lyrics: { "@type": "CreativeWork", text: verse1 },
      license: "https://creativecommons.org/publicdomain/mark/1.0/",
      associatedMedia: { "@type": "MediaObject", name: `${n} in Tonic Solfa (PDF)`, encodingFormat: "application/pdf", contentUrl: ORIGIN + pdf, license: "https://creativecommons.org/publicdomain/mark/1.0/" },
      ...(h.source === OHP.name || t.source === OHP.name ? {
        isBasedOn: { "@type": "CreativeWork", name: `${h.title} (${OHP.name})`, url: (h.source === OHP.name ? h.sourceUrl : t.sourceUrl) || OHP.url, publisher: { "@type": "Organization", name: OHP.name, url: OHP.url }, license: "https://creativecommons.org/publicdomain/mark/1.0/" },
        creditText: v.credit.text,
      } : {}),
    },
    breadcrumbLd(crumbs),
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ];
  const scripts = `<script src="/assets/choir.js?v=${ASSET_VERSION.choirJs}" defer></script>
<script src="/assets/hymn.js?v=${ASSET_VERSION.hymnJs}" defer></script>`;
  return page({ path, title: hymnPageTitle(h), description: h.description, jsonLd: ld, body, active: "/hymns", scripts, head: pdfAlternate(path, n) });
}

/** The letter a title is filed under: its first letter, past quotation marks ("'Tis" under T). */
export function indexLetter(title) {
  const m = /\p{L}/u.exec(String(title).normalize("NFKD"));
  return m ? m[0].toUpperCase() : "#";
}

/** What the index's filter box matches for a hymn: titles, first line, tune, writers, season and topics. */
function searchText(h) {
  const t = h.tuneData;
  return [h.title, ...(h.alsoKnownAs || []), h.verses[0].lines[0], t.name, ...h.text.map((p) => p.name), ...t.music.map((p) => p.name), h.category || "", ...(h.occasions || []), ...(h.topics || []), h.view.header]
    .join(" ").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * /hymns: every hymn and tune page A–Z, the filter box (assets/hymns-index.js), and links to the other ways in:
 * the seasons and occasions (each a page of its own, `occasions` from collections.mjs occasionPages), the
 * writers and composers, and the first lines.
 */
export function renderHymnIndex(hymns, tunes = [], { occasions = [] } = {}) {
  const crumbs = [["/", "Home"], ["/hymns", "Hymns"]];
  // Hymns and tune pages (a tune without words) in one A–Z, each filed under its title.
  const entries = [...hymns.map((h) => ({ title: h.title, html: () => item(h) })), ...tunes.map((t) => ({ title: t.view.title, html: () => tuneIndexItem(t) }))]
    .sort((a, b) => a.title.localeCompare(b.title));
  const groups = new Map();
  for (const e of entries) {
    const L = indexLetter(e.title);
    if (!groups.has(L)) groups.set(L, []);
    groups.get(L).push(e);
  }
  const letters = [...groups.keys()].sort();
  function item(h) { return `    <li class="hymn-item" data-kind="hymn" data-search="${escapeHtml(searchText(h))}">
      <h3><a href="/hymns/${h.slug}">${escapeHtml(h.title)}</a></h3>
      <p class="first-line">${escapeHtml(h.verses[0].lines[0])}</p>
      <p class="story-meta"><span>${escapeHtml(h.view.header)}</span><span>${escapeHtml(h.view.time)}</span><span>Tune: ${escapeHtml(h.tuneData.name)}</span>${h.category || h.occasions ? `<span>${escapeHtml(h.category || h.occasions[0])}</span>` : ""}</p>
    </li>`; }
  const sections = letters.map((L) => `<section class="hymn-letter" id="letter-${L}" aria-labelledby="letter-${L}-title">
  <h2 id="letter-${L}-title">${L}</h2>
  <ul class="hymn-list">
${groups.get(L).map((e) => e.html()).join("\n")}
  </ul>
</section>`).join("\n");
  const body = `${breadcrumbs(crumbs)}
<header class="masthead">
  <h1>Hymns in Tonic Solfa</h1>
  <!-- The search first (board l-ux-high/06c): on a phone it sat some 850px down, under the chips. -->
  <div class="hymn-find hymn-find-top" id="hymn-find" hidden>
    <label class="sr-only" for="hymn-filter">Find a hymn</label>
    <input type="search" id="hymn-filter" placeholder="Title, first line, tune, writer or season" autocomplete="off" spellcheck="false">
    ${tunes.length ? `<!-- One control, one choice always made, All to start (board m-ux-medium W4a): it reads apart from the season links below. -->
    <div class="hymn-kinds" role="group" aria-label="Hymns or tunes"><button type="button" data-kind="" aria-pressed="true">All</button><button type="button" data-kind="hymn" aria-pressed="false">Hymns</button><button type="button" data-kind="tune" aria-pressed="false">Tunes</button></div>` : ""}
    <p class="hymn-count" id="hymn-count" aria-live="polite"></p>
  </div>
  <p class="masthead-dek">${hymns.length} public-domain hymns with the solfa written out under the words${tunes.length ? `, and ${tunes.length} more hymn tunes on their own,` : ""} with the staff notation, a piano to sing along with and a free PDF of each to print. The solfa is written by the same engine NoteFusion uses for your own songs.</p>
  ${identifyCallout()}
</header>
${browseLinks("/hymns")}
${occasions.length ? `<h2 class="hymn-seasons-title">Hymns for the season</h2>\n${occasionLinks(occasions)}` : ""}
<nav class="az" aria-label="Hymns by first letter">${letters.map((L) => `<a href="#letter-${L}">${L}</a>`).join("")}</nav>
<div class="hymn-index" id="hymn-index">
${sections}
</div>
<p class="hymn-none" id="hymn-none" hidden>No hymn matches that. Try fewer words or <a href="/hymns" id="hymn-clear" data-track="Hymns: clear search">clear the search</a>, <a href="${IDENTIFY_PATH}" data-track="Hymns: hum to find (no match)">hum the tune and we'll find it</a>, or <a href="/app">transcribe the song with NoteFusion</a>.</p>
<p class="note">Every hymn here is out of copyright: everyone who wrote it died before ${PD_DIED_BEFORE}, and it was first published before ${PD_PUBLISHED_BEFORE}. Most come from the ${OHP.name}${tunes.length ? ` and the ${CCEH.name}` : ""}; see <a href="/hymns/credits">sources and licences</a>. Want a song that is not here? <a href="/app">Transcribe it with NoteFusion</a>.</p>
${ctaBox("hymns")}`;
  return page({
    path: "/hymns", title: "Hymns in Tonic Solfa: solfa, words and staff | NoteFusion",
    description: `${hymns.length} public-domain hymns in Tonic Solfa: the doh, the solfa line by line under the words, staff notation and a piano to sing along with.`,
    body, active: "/hymns",
    scripts: `<script src="/assets/hymns-index.js?v=${ASSET_VERSION.hymnsIndexJs}" defer></script>`,
        // The hymns only: the tune pages are many, and each is in the sitemap and linked from the list itself.
    jsonLd: [{ "@context": "https://schema.org", "@type": "ItemList", name: "Hymns in Tonic Solfa", numberOfItems: hymns.length, itemListElement: hymns.map((h, i) => ({ "@type": "ListItem", position: i + 1, url: `${ORIGIN}/hymns/${h.slug}`, name: h.title })) }, breadcrumbLd(crumbs)],
  });
}

/** /hymns/credits: where the hymns come from, under what terms, and who wrote each one. */
export function renderHymnCredits(hymns, tunes = []) {
  const path = "/hymns/credits";
  const crumbs = [["/", "Home"], ["/hymns", "Hymns"], [path, "Sources and licences"]];
  const fromOhp = hymns.filter((h) => h.source === OHP.name);
  // The tune pages from the CCEH, and those encoded by hand from other public-domain scores.
  const fromCceh = tunes.filter((t) => t.source === CCEH.short), tunesByHand = tunes.filter((t) => t.source !== CCEH.short);
  const melodyOnly = hymns.filter((h) => h.source !== OHP.name && h.tuneData.source === OHP.name);
  const byHand = hymns.filter((h) => h.source !== OHP.name && h.tuneData.source !== OHP.name);
  const row = (h) => {
    const c = creditLine(h);
    return `    <tr><td><a href="/hymns/${h.slug}">${escapeHtml(h.title)}</a></td><td>${c.html}</td></tr>`;
  };
  const table = (list) => `<table class="credits-table">
  <thead><tr><th scope="col">Hymn</th><th scope="col">Credits</th></tr></thead>
  <tbody>
${list.map(row).join("\n")}
  </tbody>
</table>`;
  const body = `${breadcrumbs(crumbs)}
<article class="hymn-page credits-page">
<header class="post-header">
  <h1>Sources and licences</h1>
  <p class="post-lede">Where the hymns on NoteFusion come from, why each one is free to use, and who wrote it.</p>
</header>

<section aria-labelledby="ohp-title">
  <h2 id="ohp-title">The Open Hymnal Project</h2>
  <p>${fromOhp.length + melodyOnly.length} of the ${hymns.length} hymns here come from the <a href="${OHP.url}" rel="noopener">Open Hymnal Project</a>, a freely distributable hymnal of public-domain hymns edited by ${OHP.editor}, published as scores in the ABC music format. We read the melody and every verse from each hymn's score, and NoteFusion's own solfa engine writes the Tonic Solfa from the notes; each hymn page links to the hymn's page at the Open Hymnal.</p>
  <p>The Open Hymnal states the copyright of every hymn in its score. We take only hymns it marks as public domain (a few whose harmony is under its own licence give us only their public-domain melody and words), and of those only the ones that also pass our own rule below. Its <a href="${OHP.copying}" rel="noopener">copying page</a> places the project's own editing, indexes and data files in the public domain.</p>
  <p>Imported hymns have not yet been checked note by note against a printed hymn book; each one says so on its page. If you find a wrong note or word, tell us and we will correct it.</p>
</section>

${tunes.length ? `<section aria-labelledby="cceh-title">
  <h2 id="cceh-title">The Christian Classics Ethereal Hymnary</h2>
  <p>${fromCceh.length} hymn tunes on their own (tunes without words) come from the <a href="${CCEH.url}" rel="noopener">${CCEH.name}</a> (CCEH), an archive of public-domain hymn tunes at the Christian Classics Ethereal Library, given as four-part scores. We read each tune's melody from its MIDI file, check it against the incipit (the opening notes in do-re-mi) on the tune's page, and NoteFusion's own solfa engine writes the Tonic Solfa from the notes; each tune page links to the tune's page at the CCEH.</p>
  <p>The CCEH <a href="${CCEH.terms}" rel="noopener">states</a> that its music is in the public domain and that all its files — sheet music, MIDIs and electronic scores — are free to use in any manner. It judges public domain by the American rule (published before 1923); we apply our own rule below as well, so tunes by composers or arrangers who died in ${PD_DIED_BEFORE} or later are not taken, and tunes whose composer's dates we do not have are held back until they are checked.</p>
  <p>Imported tunes have not yet been checked note by note against a printed hymn book; each one says so on its page. If you find a wrong note, tell us and we will correct it.</p>
</section>

` : ""}<section aria-labelledby="rule-title">
  <h2 id="rule-title">Our public-domain rule</h2>
  <p>A hymn is published here only if everyone named — composer, arranger, author and translator — died before ${PD_DIED_BEFORE} (or the source is anonymous or traditional), and both the words and the music were first published before ${PD_PUBLISHED_BEFORE}. That keeps every page out of copyright in Nigeria and the UK and EU (the writer's life plus 70 years) and in the United States (published before ${PD_PUBLISHED_BEFORE}). Hymns whose dates the source does not give are held back until they are checked, and hymns still in copyright anywhere are not copied at all.</p>
  <p>Modern arrangements and translations of old hymns can still be under copyright, so a hymn book's version may differ from the one here.</p>
</section>

<section aria-labelledby="hand-title">
  <h2 id="hand-title">Encoded by NoteFusion</h2>
  <p>${byHand.length} hymns were encoded by hand from public-domain scores and checked against other public sources; ${melodyOnly.length ? `${melodyOnly.length} more have our words with the Open Hymnal's melody. ` : ""}Each page says what was checked.${tunesByHand.length ? ` ${tunesByHand.length} ${tunesByHand.length === 1 ? "tune" : "tunes"} without words ${tunesByHand.length === 1 ? "was" : "were"} encoded the same way, each from the public-domain score its page names.` : ""}</p>
</section>

<section aria-labelledby="list-title">
  <h2 id="list-title">Every hymn and its credits</h2>
${table(hymns)}
</section>${tunes.length ? `

<section aria-labelledby="tunes-title">
  <h2 id="tunes-title">Every hymn tune and its credits</h2>
<table class="credits-table">
  <thead><tr><th scope="col">Tune</th><th scope="col">Credits</th></tr></thead>
  <tbody>
${tunes.map((t) => `    <tr><td><a href="${t.view.url}">${escapeHtml(t.view.title)}</a></td><td>${t.view.credit.html}</td></tr>`).join("\n")}
  </tbody>
</table>
</section>` : ""}
</article>
<p class="back-link"><a href="/hymns">← All hymns in Tonic Solfa</a></p>`;
  return page({
    path, title: "Hymn sources and licences | NoteFusion",
    description: tunes.length
      ? `Where NoteFusion's ${hymns.length} public-domain hymns and ${tunes.length} hymn tunes in Tonic Solfa come from (the Open Hymnal Project, the CCEH) and who wrote each.`
      : `Where NoteFusion's ${hymns.length} public-domain hymns in Tonic Solfa come from — most from the Open Hymnal Project — and who wrote each one.`,
    body, active: "/hymns",
    jsonLd: [
      { "@context": "https://schema.org", "@type": "WebPage", name: "Hymn sources and licences", url: ORIGIN + path, citation: { "@type": "CreativeWork", name: OHP.name, url: OHP.url, editor: { "@type": "Person", name: OHP.editor } } },
      breadcrumbLd(crumbs),
    ],
  });
}

/**
 * "New to solfa? Read …" with the beginner guides that are live. Posts come from the API at deploy time, so a
 * guide that is unpublished (or a build without the API's posts) leaves its link out rather than breaking it.
 */
const GUIDES = [["how-to-read-tonic-solfa", "how to read Tonic Solfa"], ["how-to-find-the-doh-of-a-song", "how to find the doh of a song"]];
function guideLine(posts) {
  const live = GUIDES.filter(([slug]) => posts.some((p) => p.slug === slug));
  if (!live.length) return "";
  return `  <p>New to solfa? Read ${live.map(([slug, text]) => `<a href="/blog/${slug}">${text}</a>`).join(" and ")}.</p>`;
}
