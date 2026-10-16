// Hymn pages: the engine's solfa grid with the first verse, the same as plain text line by line,
// the staff (MusicXML drawn by OSMD in the browser), every verse, and facts read off the melody.
import { ORIGIN, OSMD, ASSET_VERSION } from "./site.mjs";
import { escapeHtml, jsonForScript } from "./util.mjs";
import { page, breadcrumbs, breadcrumbLd, ctaBox } from "./layout.mjs";
import { engineGrid, toLines, pitchLabel } from "./solfa.mjs";
import { gridHtml, textLinesHtml } from "./grid-html.mjs";
import { melodyToMusicXml } from "./musicxml.mjs";
import { PD_DIED_BEFORE, PD_PUBLISHED_BEFORE } from "./content.mjs";

const DIATONIC = ["d", "r", "m", "f", "s", "l", "t"];
const TIME_WORDS = { "2/4": "two crotchet beats", "3/4": "three crotchet beats", "4/4": "four crotchet beats", "6/8": "two dotted-crotchet beats (six quavers)", "3/2": "three minim beats", "9/8": "three dotted-crotchet beats (nine quavers)", "12/8": "four dotted-crotchet beats (twelve quavers)" };

function years(p) { return p.traditional ? "" : p.born ? ` (${p.born}–${p.died})` : ` (died ${p.died})`; }
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
    { q: `Is ${n} in the public domain?`, a: `Yes. ${pdPeople.length ? `${pdPeople.map((p) => `${p.name} died in ${p.died}`).join(", ")}; ` : ""}the words were first published in ${h.textPublished} and the music in ${h.tuneData.musicPublished}. Everyone named died before ${PD_DIED_BEFORE} and both were published before ${PD_PUBLISHED_BEFORE}, so the hymn is out of copyright in Nigeria, the UK, the EU and the United States. Modern arrangements and translations can still be under copyright.` },
  ];
}

export function renderHymn(h, { hymns, posts }) {
  const v = h.view, t = h.tuneData, n = hymnName(h);
  const path = `/hymns/${h.slug}`;
  const crumbs = [["/", "Home"], ["/hymns", "Hymns"], [path, n]];
  const sameTune = hymns.filter((o) => o !== h && o.tune === h.tune);
  const usedIn = posts.filter((p) => p.hymnsUsed.includes(h.slug));
  const faq = faqFor(h);
  const verse1 = h.verses[0].lines.join("\n");

  const facts = [
    ["Key", v.key], ["Doh", v.doh], ["Time", v.time], ["Starts on", `${v.first.solfa} (${v.first.letter})`],
    ["Range", `${v.low.solfa} to ${v.high.solfa} (${v.low.letter} to ${v.high.letter}${SPAN_WORDS[v.span] ? `, ${SPAN_WORDS[v.span]}` : ""})`],
    ["Tune", t.name], ["Words", h.text.map((p) => p.name).join(", ")], ["Music", t.music.map((p) => p.name).join(", ")],
  ];
  const tips = [
    `<li><strong>Find doh first.</strong> Play or hum ${escapeHtml(v.doh)} and sing <em>d r m f s</em> up from it, so the whole choir has the key in their ears before you start.</li>`,
    `<li><strong>Pitch the first note.</strong> The tune starts on <strong>${escapeHtml(v.first.solfa)}</strong> (${escapeHtml(v.first.letter)})${v.pickupWord ? `, on ${escapeHtml(v.pickupWord)}, as a pickup before the first full bar` : ""}.</li>`,
    `<li><strong>Count the time.</strong> ${escapeHtml(v.time)} means ${TIME_WORDS[v.time] || `${escapeHtml(v.time)} time`} in each bar. In the grid every cell is half a crotchet: a dash (–) holds the note before it, and _ is a rest.</li>`,
    `<li><strong>Know the notes.</strong> The tune uses ${v.usedOrdered.map((s) => `<em>${s}</em>`).join(" ")}${v.chromatic.length ? ` and the chromatic ${v.chromatic.map((s) => `<em>${s}</em>`).join(" ")}` : ""}${v.usedOrdered.length <= 5 && !v.chromatic.length ? ` — only ${v.usedOrdered.length} different notes, so it is a good one for a choir new to solfa` : ""}. A comma after a note (s,) is the octave below; an apostrophe (d') is the octave above.</li>`,
  ];
  const verses = h.verses.map((vv, i) => `<div class="verse">${vv.label ? `<p class="verse-label">${escapeHtml(vv.label)}</p>` : ""}<p>${vv.lines.map(escapeHtml).join("<br>")}</p>${vv.note ? `<p class="verse-note">${escapeHtml(vv.note)}</p>` : ""}</div>`);
  const credits = [...h.text.map((p) => `<li>${escapeHtml(p.role)}: ${escapeHtml(p.name)}${years(p)}</li>`), ...t.music.map((p) => `<li>${escapeHtml(p.role)}: ${escapeHtml(p.name)}${years(p)}</li>`)];

  const body = `${breadcrumbs(crumbs)}
<article class="hymn-page">
<header class="post-header">
  <p class="kicker"><a href="/hymns">Hymns in Tonic Solfa</a></p>
  <h1>${escapeHtml(h.title)} in Tonic Solfa</h1>
  <p class="post-lede">${escapeHtml(h.description)}</p>
</header>

<dl class="facts">
${facts.map(([k, val]) => `  <div><dt>${k}</dt><dd>${escapeHtml(val)}</dd></div>`).join("\n")}
</dl>

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

<section aria-labelledby="lines-title">
  <h2 id="lines-title">The solfa line by line</h2>
  <p>The same solfa as plain text, a line of the hymn at a time, with the words of the first verse under it — easy to copy into your own notes or a WhatsApp message to the choir.</p>
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
  <p>New to solfa? Read <a href="/blog/how-to-read-tonic-solfa">how to read Tonic Solfa</a> and <a href="/blog/how-to-find-the-doh-of-a-song">how to find the doh of a song</a>.</p>
</section>

<section aria-labelledby="about-title">
  <h2 id="about-title">About the hymn</h2>
${(h.about || []).map((p) => `  <p>${escapeHtml(p)}</p>`).join("\n")}
  <ul class="credits">
${credits.join("\n")}
  </ul>
${sameTune.length ? `  <p>Sung to the same tune: ${sameTune.map((o) => `<a href="/hymns/${o.slug}">${escapeHtml(o.title)}</a>`).join(", ")}.</p>` : ""}
</section>

<section class="faq" aria-labelledby="faq-title">
  <h2 id="faq-title">Questions about ${escapeHtml(n)}</h2>
${faq.map((f) => `  <h3>${escapeHtml(f.q)}</h3>\n  <p>${escapeHtml(f.a)}</p>`).join("\n")}
</section>

${ctaBox("hymn")}
</article>
${usedIn.length ? `<section class="side-list" aria-labelledby="posts-title"><h2 id="posts-title">On the blog</h2><ul>${usedIn.map((p) => `<li><a href="${p.url}">${escapeHtml(p.title)}</a></li>`).join("")}</ul></section>` : ""}
<p class="back-link"><a href="/hymns">← All hymns in Tonic Solfa</a></p>
<script type="application/json" id="hymn-data">${jsonForScript({ key: v.key, time: v.time, tempo: v.tempo, notes: v.notes, musicXml: v.musicXml, osmd: OSMD })}</script>`;

  const composers = t.music.filter((p) => !p.traditional).map((p) => ({ "@type": "Person", name: p.name, ...(p.born ? { birthDate: String(p.born) } : {}), deathDate: String(p.died) }));
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
      lyricist: h.text.map((p) => ({ "@type": "Person", name: p.name, ...(p.born ? { birthDate: String(p.born) } : {}), deathDate: String(p.died) })),
      lyrics: { "@type": "CreativeWork", text: verse1 },
      license: "https://creativecommons.org/publicdomain/mark/1.0/",
    },
    breadcrumbLd(crumbs),
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
  ];
  const scripts = `<script src="/assets/choir.js?v=${ASSET_VERSION.choirJs}" defer></script>
<script src="/assets/hymn.js?v=${ASSET_VERSION.hymnJs}" defer></script>`;
  return page({ path, title: hymnPageTitle(h), description: h.description, jsonLd: ld, body, active: "/hymns", scripts });
}

export function renderHymnIndex(hymns) {
  const crumbs = [["/", "Home"], ["/hymns", "Hymns"]];
  const items = hymns.map((h) => `  <li class="hymn-item">
    <h2><a href="/hymns/${h.slug}">${escapeHtml(h.title)}</a></h2>
    <p class="first-line">${escapeHtml(h.verses[0].lines[0])}</p>
    <p class="story-meta"><span>${escapeHtml(h.view.header)}</span><span>${escapeHtml(h.view.time)}</span><span>Tune: ${escapeHtml(h.tuneData.name)}</span></p>
  </li>`).join("\n");
  const body = `${breadcrumbs(crumbs)}
<header class="masthead">
  <p class="kicker">The hymnal</p>
  <h1>Hymns in Tonic Solfa</h1>
  <p class="masthead-dek">Public-domain hymns with the solfa written out under the words, the staff notation, and a piano to sing along with. The solfa is written by the same engine NoteFusion uses for your own songs.</p>
</header>
<ul class="hymn-list">
${items}
</ul>
<p class="note">Every hymn here is out of copyright: everyone who wrote it died before ${PD_DIED_BEFORE}, and it was first published before ${PD_PUBLISHED_BEFORE}. Want a song that is not here? <a href="/app">Transcribe it with NoteFusion</a>.</p>
${ctaBox("hymns")}`;
  return page({
    path: "/hymns", title: "Hymns in Tonic Solfa: solfa, words and staff | NoteFusion",
    description: "Public-domain hymns in Tonic Solfa: the doh, the solfa line by line under the words, staff notation and a piano to sing along with.",
    body, active: "/hymns",
    jsonLd: [{ "@context": "https://schema.org", "@type": "ItemList", name: "Hymns in Tonic Solfa", itemListElement: hymns.map((h, i) => ({ "@type": "ListItem", position: i + 1, url: `${ORIGIN}/hymns/${h.slug}`, name: h.title })) }, breadcrumbLd(crumbs)],
  });
}
