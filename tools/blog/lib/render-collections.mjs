// The hymnal's other ways in (lib/collections.mjs groups them): /hymns/occasions and a page per season or
// occasion, /hymns/people and a page per writer or composer, and /hymns/first-lines. Plain lists with the
// doh, the time and a link to each hymn's printable PDF; no script.
import { ORIGIN } from "./site.mjs";
import { escapeHtml } from "./util.mjs";
import { page, breadcrumbs, breadcrumbLd, ctaBox, icon } from "./layout.mjs";
import { PD_DIED_BEFORE, PD_PUBLISHED_BEFORE } from "./content.mjs";
import { firstLineSortKey, surname, personKey } from "./collections.mjs";
import { pdfPath } from "./render-pdf.mjs";

export const OCCASIONS_PATH = "/hymns/occasions";
export const PEOPLE_PATH = "/hymns/people";
export const FIRST_LINES_PATH = "/hymns/first-lines";

const hymnUrl = (h) => `/hymns/${h.slug}`;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** A hymn in a list: its title, first line, doh, time, tune and its PDF. `note` adds what it is to the list. */
export function hymnRow(h, { note = "" } = {}) {
  return `    <li class="hymn-item">
      <h3><a href="${hymnUrl(h)}">${escapeHtml(h.title)}</a></h3>
      <p class="first-line">${escapeHtml(h.verses[0].lines[0])}</p>
      <p class="story-meta"><span>${escapeHtml(h.view.header)}</span><span>${escapeHtml(h.view.time)}</span><span>Tune: ${escapeHtml(h.tuneData.name)}</span>${note ? `<span>${escapeHtml(note)}</span>` : ""}<span><a href="${pdfPath(hymnUrl(h))}" type="application/pdf" data-track="List: solfa PDF">Solfa PDF</a></span></p>
    </li>`;
}

/** What a tune page is, as the pages name it: a tune file's `form` ("waltz theme"), else a hymn tune. */
export const tuneForm = (t) => t.form || "hymn tune";

/** A tune page in a list. */
export function tuneRow(t, { note = "" } = {}) {
  const form = tuneForm(t);
  return `    <li class="hymn-item">
      <h3><a href="${t.view.url}">${escapeHtml(t.view.title)}</a></h3>
      <p class="first-line">${escapeHtml(form[0].toUpperCase() + form.slice(1))}${t.metre && t.metre !== "Irregular" ? ` · ${escapeHtml(t.metre.replace(/ (?=\d)/g, "."))}` : ""}</p>
      <p class="story-meta"><span>${escapeHtml(t.view.header)}</span><span>${escapeHtml(t.view.time)}</span>${note ? `<span>${escapeHtml(note)}</span>` : ""}<span><a href="${pdfPath(t.view.url)}" type="application/pdf" data-track="List: solfa PDF">Solfa PDF</a></span></p>
    </li>`;
}

/** The ways into the hymnal, under the index's masthead and at the foot of each collection page. */
export function browseLinks(current = null) {
  const links = [["/hymns", "All hymns A–Z"], [OCCASIONS_PATH, "Seasons and occasions"], [PEOPLE_PATH, "Writers and composers"], [FIRST_LINES_PATH, "First lines"]];
  return `<nav class="hymn-browse" aria-label="Browse the hymns">${links.map(([href, text]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ""}>${escapeHtml(text)}</a>`).join("")}</nav>`;
}

/** The seasons and occasions as links (the index's filter row, and the row on each occasion page). */
export function occasionLinks(occasions, current = null) {
  return `<nav class="hymn-seasons" aria-label="Seasons and occasions">${occasions.map((o) => `<a href="${o.url}"${o.slug === current ? ' aria-current="page"' : ""} data-track="Occasion: ${escapeHtml(o.name)}">${escapeHtml(o.name)}</a>`).join("")}</nav>`;
}

const PD_NOTE = `Every hymn here is out of copyright: everyone who wrote it died before ${PD_DIED_BEFORE}, and it was first published before ${PD_PUBLISHED_BEFORE}. See <a href="/hymns/credits">sources and licences</a>.`;

function itemList(name, items) {
  return { "@type": "ItemList", name, numberOfItems: items.length, itemListElement: items.map(([url, n], i) => ({ "@type": "ListItem", position: i + 1, url: ORIGIN + url, name: n })) };
}
function collectionLd(path, name, description, list) {
  return { "@context": "https://schema.org", "@type": "CollectionPage", name, url: ORIGIN + path, description, inLanguage: "en", isPartOf: { "@type": "WebSite", name: "NoteFusion", url: ORIGIN + "/" }, mainEntity: list };
}
/** The first description that fits the 160 characters a search result shows. */
const fit = (...options) => options.find((d) => d.length <= 155) || options[options.length - 1].slice(0, 155);

// ── Seasons and occasions ───────────────────────────────────────────────────
/** An occasion's hymns and tune pages (occasionPages gives both; a tune page has no words), A–Z by title. */
const occasionItems = (o) => [...o.hymns, ...(o.tunes || [])].sort((a, b) => itemTitle(a).localeCompare(itemTitle(b)));
const itemTitle = (x) => (x.view && x.view.url ? x.view.title : x.title);
const itemUrl = (x) => (x.view && x.view.url ? x.view.url : hymnUrl(x));

export function occasionTitle(o) {
  if (o.tunes?.length) return `${o.name} ${o.what || "hymns"} in Tonic Solfa | NoteFusion`;
  const t = `${o.name} hymns in Tonic Solfa — ${o.hymns.length} ${o.slug === "christmas" ? "carols" : "hymns"} with words | NoteFusion`;
  return t.length <= 70 ? t : `${o.name} hymns in Tonic Solfa | NoteFusion`;
}

export function renderOccasion(o, { occasions }) {
  const path = o.url;
  const crumbs = [["/", "Home"], ["/hymns", "Hymns"], [OCCASIONS_PATH, "Seasons and occasions"], [path, o.name]];
  const heading = `${o.name} ${o.what || "hymns"} in Tonic Solfa`;
  const items = occasionItems(o), n = items.length;
  // A tune page has no words to write the solfa under.
  const withWords = o.tunes?.length ? "the solfa (under the words, where there are words)" : "the solfa written under the words";
  const description = fit(
    o.tunes?.length
      ? `${n} ${o.name} ${o.noun} in Tonic Solfa: the doh, the solfa, staff notation, a piano to sing along with and a free PDF to print.`
      : `${n} ${o.name} ${o.noun} in Tonic Solfa: the doh, the solfa under the words, staff notation, a piano to sing along with and a free PDF to print.`,
    `${n} ${o.name} ${o.noun} in Tonic Solfa, with ${o.tunes?.length ? "the solfa" : "the words"}, staff notation and a free PDF to print.`,
  );
  const body = `${breadcrumbs(crumbs)}
<header class="masthead">
  <h1>${escapeHtml(heading)}</h1>
  <p class="masthead-dek">${escapeHtml(o.intro)} Here ${n === 1 ? "is" : "are"} the ${plural(n, o.noun.replace(/s$/, ""), o.noun)} on NoteFusion, each with ${withWords}, staff notation, a piano to sing along with and a free PDF to print.</p>
</header>
${occasionLinks(occasions, o.slug)}
<ul class="hymn-list">
${items.map((x) => (x.view && x.view.url ? tuneRow(x) : hymnRow(x))).join("\n")}
</ul>
<p class="note">${PD_NOTE} Want a song that is not here? <a href="/app">Transcribe it with NoteFusion</a>.</p>
${browseLinks()}
${ctaBox("occasion")}`;
  const list = itemList(heading, items.map((x) => [itemUrl(x), itemTitle(x)]));
  return page({ path, title: occasionTitle(o), description, body, active: "/hymns", jsonLd: [collectionLd(path, heading, description, list), breadcrumbLd(crumbs)] });
}

/** "Silent Night, Away in a Manger, Hark! The Herald Angels Sing and 22 more": the hand-encoded hymns first. */
function sample(o) {
  const all = [...o.hymns, ...(o.tunes || [])];
  const first = [...all.filter((h) => !h.importedFrom), ...all.filter((h) => h.importedFrom)].slice(0, 3).map(itemTitle);
  const more = all.length - first.length;
  return more ? `${first.join(", ")} and ${more} more` : `${first.slice(0, -1).join(", ")} and ${first[first.length - 1]}`;
}

export function renderOccasionsHub(occasions) {
  const path = OCCASIONS_PATH;
  const crumbs = [["/", "Home"], ["/hymns", "Hymns"], [path, "Seasons and occasions"]];
  const heading = "Hymns for the seasons and occasions of the church year";
  const total = new Set(occasions.flatMap((o) => [...o.hymns, ...(o.tunes || [])])).size;
  const description = fit(`Hymns in Tonic Solfa for ${occasions.map((o) => o.name).join(", ")}: the solfa under the words, staff notation and a free PDF of each.`, `Hymns in Tonic Solfa for Advent, Christmas, Lent, Easter and the rest of the church year, with the words and a free PDF of each.`);
  const body = `${breadcrumbs(crumbs)}
<header class="masthead">
  <h1>${escapeHtml(heading)}</h1>
  <p class="masthead-dek">${total} hymns for ${occasions.length} seasons and occasions, in the order of the church year, each written out in Tonic Solfa under the words with staff notation, a piano and a free PDF.</p>
</header>
<ul class="hymn-list occasion-list">
${occasions.map((o) => `    <li class="hymn-item">
      <h2><a href="${o.url}">${escapeHtml(o.name)}</a></h2>
      <p class="first-line">${escapeHtml(o.intro.split(/(?<=\.)\s/)[0])}</p>
      <p class="story-meta">${escapeHtml(sample(o))}</p>
    </li>`).join("\n")}
</ul>
<p class="note">${PD_NOTE}</p>
${browseLinks(path)}
${ctaBox("occasions")}`;
  const list = itemList(heading, occasions.map((o) => [o.url, `${o.name} hymns`]));
  return page({ path, title: "Hymns for every season of the church year in Tonic Solfa | NoteFusion", description, body, active: "/hymns", jsonLd: [collectionLd(path, heading, description, list), breadcrumbLd(crumbs)] });
}

// ── People ──────────────────────────────────────────────────────────────────
const workUrl = (w) => (w.kind === "hymn" ? hymnUrl(w.item) : w.item.view.url);
const workTitle = (w) => (w.kind === "hymn" ? w.item.title : w.item.view.title);
function worksNoun(p) {
  const hymns = p.works.filter((w) => w.kind === "hymn").length, tunes = p.works.length - hymns;
  return [hymns ? plural(hymns, "hymn") : "", tunes ? plural(tunes, "hymn tune") : ""].filter(Boolean).join(" and ");
}

export function personTitle(p) {
  const what = p.works.some((w) => w.kind === "tune") && !p.works.some((w) => w.kind === "hymn") ? "hymn tunes" : "hymns";
  const t = `${p.name} ${what} in Tonic Solfa — words and solfa | NoteFusion`;
  return t.length <= 70 ? t : `${p.name} ${what} in Tonic Solfa | NoteFusion`;
}

export function renderPerson(p, { people }) {
  const path = p.url;
  const crumbs = [["/", "Home"], ["/hymns", "Hymns"], [PEOPLE_PATH, "Writers and composers"], [path, p.name]];
  const heading = `${p.name}: ${p.works.some((w) => w.kind === "hymn") ? "hymns" : "hymn tunes"} in Tonic Solfa`;
  const groups = [
    ["words", "Words", (w) => w.kind === "hymn" && w.as.includes("words")],
    ["translation", "Translations", (w) => w.kind === "hymn" && w.as.includes("translation") && !w.as.includes("words")],
    ["music", "Music", (w) => w.kind === "hymn" && !w.as.includes("words") && !w.as.includes("translation")],
    ["tunes", "Hymn tunes", (w) => w.kind === "tune"],
  ].map(([id, title, test]) => ({ id, title, works: p.works.filter(test) })).filter((g) => g.works.length);
  const asNote = (w) => {
    const bits = [];
    if (w.as.includes("words") && w.as.includes("music")) bits.push("Words and music");
    else if (w.as.includes("translation") && w.as.includes("music")) bits.push("Translation and music");
    if (w.as.includes("arrangement")) bits.push("Arrangement");
    return bits.join(", ");
  };
  const description = fit(
    `${p.name}${p.years ? ` ${p.years}` : ""}, ${p.role.toLowerCase()}: ${worksNoun(p)} in Tonic Solfa with the words, staff notation and a free PDF of each.`,
    `${p.name}: ${worksNoun(p)} in Tonic Solfa with the words, staff notation and a free PDF of each.`,
  );
  const body = `${breadcrumbs(crumbs)}
<header class="masthead">
  <h1>${escapeHtml(heading)}</h1>
  <p class="person-meta">${escapeHtml(p.name)}${p.years ? ` ${escapeHtml(p.years)}` : ""} · ${escapeHtml(p.role)}</p>
  <p class="masthead-dek">${escapeHtml(worksNoun(p).replace(/^./, (c) => c.toUpperCase()))} on NoteFusion credit ${escapeHtml(p.name)}. Each is written out in Tonic Solfa under the words, with staff notation, a piano to sing along with and a free PDF to print.</p>
</header>
${groups.map((g) => `<section class="person-works" aria-labelledby="works-${g.id}">
  <h2 id="works-${g.id}">${escapeHtml(g.title)}</h2>
  <ul class="hymn-list">
${g.works.map((w) => (w.kind === "hymn" ? hymnRow(w.item, { note: asNote(w) }) : tuneRow(w.item, { note: asNote(w) }))).join("\n")}
  </ul>
</section>`).join("\n")}
<p class="note">${PD_NOTE}</p>
${browseLinks()}
${ctaBox("person")}`;
  const person = { "@context": "https://schema.org", "@type": "Person", name: p.name, url: ORIGIN + path, description: p.role, ...(p.born ? { birthDate: String(p.born) } : {}), ...(p.died ? { deathDate: String(p.died) } : {}) };
  const list = { "@context": "https://schema.org", ...itemList(heading, p.works.map((w) => [workUrl(w), workTitle(w)])) };
  return page({ path, title: personTitle(p), description, body, active: "/hymns", jsonLd: [person, list, breadcrumbLd(crumbs)] });
}

export function renderPeopleHub(people) {
  const path = PEOPLE_PATH;
  const crumbs = [["/", "Home"], ["/hymns", "Hymns"], [path, "Writers and composers"]];
  const heading = "Hymn writers and composers";
  const groups = new Map();
  for (const p of people) {
    const L = surname(p.name).normalize("NFKD")[0].toUpperCase();
    if (!groups.has(L)) groups.set(L, []);
    groups.get(L).push(p);
  }
  const letters = [...groups.keys()].sort();
  const most = [...people].sort((a, b) => b.works.length - a.works.length || a.name.localeCompare(b.name)).slice(0, 2).map((p) => p.name);
  const description = fit(`${people.length} hymn writers, translators and composers, ${most.join(" and ")} among them, with their hymns in Tonic Solfa and a free PDF of each.`, `${people.length} hymn writers and composers with their hymns in Tonic Solfa and a free PDF of each.`);
  const body = `${breadcrumbs(crumbs)}
<header class="masthead">
  <h1>${heading}</h1>
  <p class="masthead-dek">Everyone credited with the words or the music of at least two hymns or hymn tunes on NoteFusion, A–Z by surname, with their dates as the hymn pages give them.</p>
</header>
<nav class="az" aria-label="Writers and composers by surname">${letters.map((L) => `<a href="#people-${L}">${L}</a>`).join("")}</nav>
${letters.map((L) => `<section class="hymn-letter" id="people-${L}" aria-labelledby="people-${L}-title">
  <h2 id="people-${L}-title">${L}</h2>
  <ul class="people-list">
${groups.get(L).map((p) => `    <li><a href="${p.url}">${escapeHtml(p.name)}</a> <span class="person-years">${escapeHtml(p.years)}</span><span class="person-role">${escapeHtml(p.role)} · ${escapeHtml(worksNoun(p))}</span></li>`).join("\n")}
  </ul>
</section>`).join("\n")}
${browseLinks(path)}
${ctaBox("people")}`;
  const list = itemList(heading, people.map((p) => [p.url, p.name]));
  return page({ path, title: "Hymn writers and composers: their hymns in Tonic Solfa | NoteFusion", description, body, active: "/hymns", jsonLd: [collectionLd(path, heading, description, list), breadcrumbLd(crumbs)] });
}

// ── First lines ─────────────────────────────────────────────────────────────
export function renderFirstLines(entries) {
  const path = FIRST_LINES_PATH;
  const crumbs = [["/", "Home"], ["/hymns", "Hymns"], [path, "First lines"]];
  const heading = "Hymns by first line";
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.letter)) groups.set(e.letter, []);
    groups.get(e.letter).push(e);
  }
  const letters = [...groups.keys()].sort();
  const hymnCount = new Set(entries.map((e) => e.hymn)).size;
  const refrains = entries.filter((e) => e.refrain).length;
  const description = `The first line of every hymn in Tonic Solfa on NoteFusion${refrains ? ", and of every refrain" : ""}, A to Z: find a hymn by the words you remember.`;
  const row = (e) => {
    const titleKey = firstLineSortKey(e.hymn.title);
    const showTitle = e.refrain || !e.key.startsWith(titleKey);
    const meta = [e.refrain ? `Refrain of ${escapeHtml(e.hymn.title)}` : showTitle ? escapeHtml(e.hymn.title) : "", escapeHtml(e.hymn.view.header)].filter(Boolean);
    return `    <li><a href="${hymnUrl(e.hymn)}">${escapeHtml(e.text)}</a><span class="fl-meta">${meta.join(" · ")}</span></li>`;
  };
  const body = `${breadcrumbs(crumbs)}
<header class="masthead">
  <h1>${heading}</h1>
  <p class="masthead-dek">The first line of each of the ${hymnCount} hymns${refrains ? `, and the first line of ${refrains} refrains,` : ""} A to Z, each linking to the hymn in Tonic Solfa with the words, staff notation and a piano. Quotation marks are skipped: <em>’Tis</em> is under T.</p>
</header>
<nav class="az" aria-label="First lines by letter">${letters.map((L) => `<a href="#lines-${L}">${L}</a>`).join("")}</nav>
${letters.map((L) => `<section class="hymn-letter" id="lines-${L}" aria-labelledby="lines-${L}-title">
  <h2 id="lines-${L}-title">${L}</h2>
  <ul class="first-lines">
${groups.get(L).map(row).join("\n")}
  </ul>
</section>`).join("\n")}
${browseLinks(path)}
${ctaBox("first-lines")}`;
  const list = { "@context": "https://schema.org", ...itemList(heading, entries.map((e) => [hymnUrl(e.hymn), e.text])) };
  return page({ path, title: "Hymns by first line: A–Z index in Tonic Solfa | NoteFusion", description, body, active: "/hymns", jsonLd: [list, breadcrumbLd(crumbs)] });
}

// ── Links from a hymn or tune page ──────────────────────────────────────────
/**
 * A person's name, linked to their page (/hymns/people/<slug>) when they have one. `personByKey` maps
 * collections.mjs personKey → person.
 */
export function personLink(p, personByKey) {
  const person = !p.traditional && personByKey.get(personKey(p));
  return person ? `<a href="${person.url}">${escapeHtml(p.name)}</a>` : escapeHtml(p.name);
}

/** The PDF button on a hymn or tune page. */
export function pdfButton(pagePath, track) {
  return `<p class="pdf-download"><a class="pdf-button" href="${pdfPath(pagePath)}" type="application/pdf" data-track="${track}">${icon("download")}Download the solfa (PDF)</a><span>A4, free to print and share with your choir</span></p>`;
}
/**
 * The piano under a hymn's or tune's solfa grid (assets/hymn.js shows it where the browser can play), and the bar that
 * keeps Play/Pause and the speed at the foot of a phone's screen while the tune plays and the player is scrolled away
 * (board n-ux-low V3e). One player plays both; `track` names the page kind for the click events ("Hymn", "Tune").
 */
export function playerHtml({ name, tempo, track }) {
  const speeds = `<option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option>`;
  return `  <div class="player" id="player" hidden>
    <button type="button" class="play-btn" id="play" data-track="${track}: play">Play</button>
    <label>Speed <select id="rate">${speeds}</select></label>
    <span class="player-note">Piano, ${escapeHtml(String(tempo))} beats a minute. The note being played lights up.</span>
  </div>
  <div class="mini-player" id="mini-player" role="group" aria-label="Player" hidden>
    <button type="button" class="play-btn" id="mini-play" data-track="${track}: mini player">Play</button>
    <span class="mini-title"><b>${escapeHtml(name)}</b><small>Piano · ${escapeHtml(String(tempo))} beats a minute</small></span>
    <label class="mini-speed"><span class="sr-only">Speed</span><select id="mini-rate">${speeds}</select></label>
  </div>`;
}
/** The <link rel="alternate"> in a page's head that names its PDF to crawlers. */
export function pdfAlternate(pagePath, title) {
  return `<link rel="alternate" type="application/pdf" href="${pdfPath(pagePath)}" title="${escapeHtml(title)} in Tonic Solfa (PDF)">`;
}

/** Up to `n` others from `list`, starting after `self` and going round, so each page links to different ones. */
export function neighbours(list, self, n) {
  const i = list.indexOf(self);
  const out = [];
  for (let k = 1; k < list.length && out.length < n; k++) out.push(list[(i + k) % list.length]);
  return out;
}

/**
 * "More Christmas hymns" and "More by Fanny Crosby" under a hymn or tune page: its occasions first, then the
 * people credited on it who have a page (words before music), at most `max` lists.
 */
export function moreLinks({ item, occasions = [], people = [], max = 3 }) {
  const sections = [];
  for (const o of occasions) {
    const all = occasionItems(o);
    sections.push({ id: `more-${o.slug}`, title: `More ${o.name} ${o.what || "hymns"}`, items: neighbours(all, item, 5).map((x) => [itemUrl(x), itemTitle(x)]), all: [o.url, `All ${plural(all.length, o.noun.replace(/s$/, ""), o.noun)} for ${o.name}`] });
  }
  for (const p of people) {
    const works = p.works.map((w) => w.item);
    sections.push({ id: `more-by-${p.slug}`, title: `More by ${p.name}`, items: neighbours(works, item, 5).map((x) => (x.view && x.view.url ? [x.view.url, x.view.title] : [hymnUrl(x), x.title])), all: [p.url, `Everything by ${p.name} (${worksNoun(p)})`] });
  }
  return sections.slice(0, max).map((s) => `<section class="side-list" aria-labelledby="${s.id}"><h2 id="${s.id}">${escapeHtml(s.title)}</h2><ul>${s.items.map(([href, text]) => `<li><a href="${href}">${escapeHtml(text)}</a></li>`).join("")}</ul><p class="side-all"><a href="${s.all[0]}">${escapeHtml(s.all[1])} ${icon("arrow-right", "ic-16")}</a></p></section>`).join("\n");
}
