// The hymnal's other ways in (lib/collections.mjs, lib/render-collections.mjs): seasons and occasions, writers
// and composers, first lines — on small made-up hymns for the rules, and on the real content for the pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadAll, loadTunes, loadHymns } from "../lib/content.mjs";
import { prepareHymn } from "../lib/render-hymns.mjs";
import { prepareTune } from "../lib/render-tunes.mjs";
import { OCCASIONS, MIN_OCCASION, inOccasion, occasionPages, collectPeople, peopleAddresses, personKey, surname, firstLineEntries, firstLineSortKey, cleanFirstLine } from "../lib/collections.mjs";
import { renderOccasion, renderOccasionsHub, renderPerson, renderPeopleHub, renderFirstLines, neighbours, moreLinks, occasionTitle } from "../lib/render-collections.mjs";

const { hymns, tunes } = loadAll();
hymns.forEach(prepareHymn);
const tunePages = Object.values(tunes).filter((t) => t.draft === false && t.parsed).map(prepareTune);
const occasions = occasionPages(hymns);
const people = collectPeople(hymns, tunePages);
const occ = (slug) => OCCASIONS.find((o) => o.slug === slug);
const ld = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

// ── Occasions ───────────────────────────────────────────────────────────────
test("a hymn is filed under an occasion by its category, or by its own occasions list — never by a topic", () => {
  assert.ok(inOccasion({ category: "Christmas" }, occ("christmas")));
  assert.ok(inOccasion({ occasions: ["Christmas"] }, occ("christmas")), "a hand-made hymn names its occasion");
  assert.ok(inOccasion({ category: "Good Thursday" }, occ("holy-week")), "Holy Week gathers Palm Sunday, Maundy Thursday and Good Friday");
  assert.ok(inOccasion({ category: "Lord’s Supper" }, occ("communion")));
  assert.ok(!inOccasion({ category: "Communion of Saints" }, occ("communion")), "the communion of saints is not Holy Communion");
  assert.ok(!inOccasion({ category: "Praise", topics: ["Easter", "Christmas/Advent"] }, occ("easter")), "a topic names what a hymn mentions, not when it is sung");
  assert.ok(!inOccasion({ category: "Advent" }, occ("christmas")));
});

test("an occasion has a page only with at least four hymns, in the order of the church year", () => {
  assert.ok(occasions.length >= 8, occasions.map((o) => o.slug).join(" "));
  for (const o of occasions) assert.ok(o.hymns.length >= MIN_OCCASION, o.slug);
  const order = OCCASIONS.map((o) => o.slug);
  assert.deepEqual(occasions.map((o) => o.slug), order.filter((s) => occasions.some((o) => o.slug === s)));
  // Every occasion without a page really is short of hymns (no page is thin, none is left out).
  for (const o of OCCASIONS.filter((x) => !occasions.some((p) => p.slug === x.slug))) assert.ok(hymns.filter((h) => inOccasion(h, o)).length < MIN_OCCASION, o.slug);
  const christmas = occasions.find((o) => o.slug === "christmas");
  const slugs = christmas.hymns.map((h) => h.slug);
  for (const s of ["silent-night", "hark-the-herald-angels-sing", "o-come-all-ye-faithful", "joy-to-the-world", "the-first-noel"]) assert.ok(slugs.includes(s), s);
  assert.ok(!slugs.includes("o-come-o-come-emmanuel"), "an Advent hymn is not a Christmas one");
  assert.ok(occasions.find((o) => o.slug === "easter").hymns.some((h) => h.slug === "thine-be-the-glory"));
});

test("an occasions list in a hymn file must name occasions the site knows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-occ-"));
  fs.mkdirSync(path.join(dir, "tunes"));
  fs.writeFileSync(path.join(dir, "tunes", "t.json"), JSON.stringify({ name: "T", music: [{ name: "C", born: 1800, died: 1870, role: "Melody" }], musicPublished: 1850, key: "C major", time: "4/4", tempo: 90, melody: "C4:4", reviewed: false }));
  const hymn = { title: "H", tune: "t", text: [{ name: "W", born: 1800, died: 1880, role: "Words" }], textPublished: 1860, description: "d", underlay: "One", verses: [{ lines: ["One"] }], updated: "2026-10-15", reviewed: false, draft: false };
  fs.writeFileSync(path.join(dir, "h.json"), JSON.stringify({ ...hymn, occasions: ["Christmas"] }));
  assert.equal(loadHymns({ tunes: loadTunes(path.join(dir, "tunes")), dir })[0].occasions[0], "Christmas");
  fs.writeFileSync(path.join(dir, "h.json"), JSON.stringify({ ...hymn, occasions: ["Xmas"] }));
  assert.throws(() => loadHymns({ tunes: loadTunes(path.join(dir, "tunes")), dir }), /"occasions" must be a list of: Advent, Christmas/);
});

test("an occasion page: its hymns with their PDFs, the other occasions, CollectionPage + ItemList + BreadcrumbList", () => {
  const o = occasions.find((x) => x.slug === "christmas");
  const html = renderOccasion(o, { occasions });
  assert.match(html, /<h1>Christmas hymns in Tonic Solfa<\/h1>/);
  assert.match(html, new RegExp(`<title>Christmas hymns in Tonic Solfa — ${o.hymns.length} carols with words \\| NoteFusion</title>`));
  assert.ok(occasionTitle(o).length <= 70);
  assert.match(html, /<link rel="canonical" href="https:\/\/notefusion\.studio\/hymns\/occasions\/christmas">/);
  assert.match(html, /<a href="\/hymns\/silent-night">Silent Night<\/a>/);
  assert.match(html, /href="\/hymns\/silent-night\/silent-night-tonic-solfa\.pdf" type="application\/pdf"/);
  assert.match(html, /<a href="\/hymns\/occasions\/christmas" aria-current="page"/);
  assert.equal((html.match(/<li class="hymn-item">/g) || []).length, o.hymns.length);
  const [page, crumbs] = ld(html);
  assert.equal(page["@type"], "CollectionPage");
  assert.equal(page.mainEntity["@type"], "ItemList");
  assert.equal(page.mainEntity.numberOfItems, o.hymns.length);
  assert.equal(page.mainEntity.itemListElement[0].url, `https://notefusion.studio/hymns/${o.hymns[0].slug}`);
  assert.equal(crumbs["@type"], "BreadcrumbList");
  assert.deepEqual(crumbs.itemListElement.map((c) => c.name), ["Home", "Hymns", "Seasons and occasions", "Christmas"]);
  const hub = renderOccasionsHub(occasions);
  for (const x of occasions) assert.match(hub, new RegExp(`<a href="${x.url}">`));
  assert.equal(ld(hub)[0].mainEntity.numberOfItems, occasions.length);
});

// ── People ──────────────────────────────────────────────────────────────────
const P = (name, born, died, role = "Words") => ({ name, born, died, role });
const fake = (slug, text, music = []) => ({ slug, title: slug, text, tuneData: { music }, updated: "2026-10-15" });

test("people: credited on two hymns or tunes (words or music) or more; traditional sources never", () => {
  const hs = [
    fake("a", [P("Fanny Crosby", 1820, 1915)]),
    fake("f", [P("Fanny Crosby", 1820, 1915)]),
    fake("b", [P("Fanny Jane Crosby", 1820, 1915)], [P("William Howard Doane", 1832, 1915, "Music (1870)")]),
    fake("c", [P("Once Only", 1800, 1850)], [{ name: "Traditional Welsh melody", traditional: true, role: "Melody" }]),
    fake("d", [P("Lowell Mason", 1792, 1872)], [P("Lowell Mason", 1792, 1872, "Music")]),
    fake("e", [{ name: "Traditional Welsh melody", traditional: true, role: "Words" }], [P("Philip P. Bliss", 1838, 1876, "Music")]),
  ];
  const tunes = [{ slug: "t", music: [P("Philip Paul Bliss", 1838, 1876, "Music (1874)")], view: { url: "/hymns/tunes/t", title: "T" }, updated: "2026-10-15" }];
  const out = collectPeople(hs, tunes);
  assert.deepEqual(out.map((p) => p.name), ["Philip Paul Bliss", "Fanny Crosby"], "A–Z by surname; one hymn is not enough (Doane, Mason)");
  const crosby = out.find((p) => p.slug === "fanny-crosby");
  assert.equal(crosby.works.length, 3, "Fanny Crosby and Fanny Jane Crosby, same dates: one person, under the name most credits use");
  assert.equal(crosby.years, "(1820–1915)");
  assert.equal(crosby.role, "Hymn writer");
  assert.equal(crosby.url, "/hymns/people/fanny-crosby");
  const bliss = out.find((p) => p.slug === "philip-paul-bliss");
  assert.deepEqual(bliss.works.map((w) => w.kind), ["hymn", "tune"]);
  assert.equal(bliss.role, "Composer");
  // A page keeps its address when more credits come to use another name: two more "Philip P. Bliss" credits
  // outvote "Philip Paul Bliss" for the page's name, never its URL.
  const more = [...hs, fake("g", [], [P("Philip P. Bliss", 1838, 1876, "Music")]), fake("h", [], [P("Philip P. Bliss", 1838, 1876, "Music")])];
  const addresses = peopleAddresses(out);
  assert.equal(addresses["Philip P. Bliss"], "philip-paul-bliss");
  const moved = collectPeople(more, tunes, { addresses }).find((p) => p.name === "Philip P. Bliss");
  assert.equal(moved.url, "/hymns/people/philip-paul-bliss");
  assert.equal(collectPeople(more, tunes).find((p) => p.name === "Philip P. Bliss").slug, "philip-p-bliss", "without the record it would move");
  // A name already recorded keeps its address; a new name is added.
  assert.deepEqual(peopleAddresses([{ names: ["A B", "A C"], slug: "new" }], { "A B": "old" }), { "A B": "old", "A C": "new" });
  // Words and music on one hymn is one work; with min 1 the role reads both.
  const mason = collectPeople(hs, [], { min: 1 }).find((p) => p.name === "Lowell Mason");
  assert.equal(mason.works.length, 1);
  assert.equal(mason.role, "Hymn writer and composer");
  // The same name with other dates is someone else.
  assert.notEqual(personKey(P("John Smith", 1800, 1850)), personKey(P("John Smith", 1820, 1890)));
  assert.equal(surname("Lelia Naylor (Mrs. Charles H.) Morris"), "Morris");
  assert.equal(surname("John W. Work, Jr."), "Work");
});

test("people on the real hymnal: at least two works each, unique addresses, the hymn pages' dates", () => {
  assert.ok(people.length >= 50, String(people.length));
  assert.equal(new Set(people.map((p) => p.slug)).size, people.length);
  for (const p of people) {
    assert.ok(p.works.length >= 2, p.name);
    assert.match(p.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  }
  const newton = people.find((p) => p.slug === "john-newton");
  assert.equal(newton.years, "(1725–1807)");
  assert.ok(newton.works.some((w) => w.item.slug === "amazing-grace"));
  assert.ok(people.find((p) => p.slug === "fanny-crosby"));
  const coffin = people.find((p) => /Coffin/.test(p.name));
  assert.equal(coffin.slug, "charles-coffin", "a parenthesis in a name stays out of the address");
});

test("a person's page: their hymns grouped by what they wrote, Person + ItemList + BreadcrumbList", () => {
  const p = people.find((x) => x.slug === "isaac-watts");
  const html = renderPerson(p, { people });
  assert.match(html, /<h1>Isaac Watts: hymns in Tonic Solfa<\/h1>/);
  assert.match(html, /Isaac Watts \(1674–1748\) · Hymn writer/);
  assert.match(html, /<h2 id="works-words">Words<\/h2>/);
  assert.match(html, /<a href="\/hymns\/when-i-survey-the-wondrous-cross">/);
  const [person, list, crumbs] = ld(html);
  assert.deepEqual([person["@type"], list["@type"], crumbs["@type"]], ["Person", "ItemList", "BreadcrumbList"]);
  assert.equal(person.birthDate, "1674");
  assert.equal(person.deathDate, "1748");
  assert.equal(list.numberOfItems, p.works.length);
  const hub = renderPeopleHub(people);
  assert.match(hub, /<a href="\/hymns\/people\/isaac-watts">Isaac Watts<\/a>/);
  // The A–Z bar points at the sections that are there.
  const bar = [...hub.matchAll(/<a href="#(people-[A-Z])">/g)].map((m) => m[1]);
  for (const id of bar) assert.match(hub, new RegExp(`id="${id}"`));
});

test("a hymn page links its writers and composers, and lists more by them and more for its season", () => {
  const h = hymns.find((x) => x.slug === "silent-night");
  const html = moreLinks({ item: h, occasions: occasions.filter((o) => o.hymns.includes(h)), people: [] });
  assert.match(html, /<h2 id="more-christmas">More Christmas hymns<\/h2>/);
  assert.equal((html.match(/<li>/g) || []).length, 5);
  assert.ok(!html.includes('href="/hymns/silent-night"'), "never itself");
  assert.match(html, /All 25 carols and hymns for Christmas|All \d+ carols and hymns for Christmas/);
  assert.deepEqual(neighbours([1, 2, 3, 4], 3, 2), [4, 1]);
  assert.deepEqual(neighbours([1, 2], 1, 5), [2]);
});

// ── First lines ─────────────────────────────────────────────────────────────
test("first lines: A–Z past quotation marks and accents, refrains included, closing commas dropped", () => {
  const v = (lines, label) => ({ lines, ...(label ? { label } : {}) });
  const hs = [
    { slug: "b", title: "Blessed Assurance", verses: [v(["Blessed assurance, Jesus is mine!"]), v(["This is my story, this is my song,"], "Refrain")] },
    { slug: "t", title: "'Tis So Sweet", verses: [v(["’Tis so sweet to trust in Jesus,"])] },
    { slug: "o", title: "Ö", verses: [v(["Ö wie wohl ist mir;"])] },
    { slug: "a", title: "Abide", verses: [v(["Abide with me;"])] },
  ];
  const e = firstLineEntries(hs);
  assert.deepEqual(e.map((x) => x.text), ["Abide with me", "Blessed assurance, Jesus is mine!", "Ö wie wohl ist mir", "This is my story, this is my song", "’Tis so sweet to trust in Jesus"]);
  assert.deepEqual(e.map((x) => x.letter), ["A", "B", "O", "T", "T"]);
  assert.equal(e.find((x) => x.refrain).hymn.slug, "b");
  assert.equal(firstLineSortKey("’Tis so sweet"), "tis so sweet");
  assert.equal(cleanFirstLine("Abide with me; "), "Abide with me");
  assert.equal(cleanFirstLine("Hark! the herald angels sing"), "Hark! the herald angels sing");
});

test("the first-line index: every hymn once, every refrain, an A–Z bar to its sections, ItemList + BreadcrumbList", () => {
  const entries = firstLineEntries(hymns);
  const refrains = hymns.filter((h) => h.verses.some((x) => /^(Refrain|Chorus)$/i.test(x.label || ""))).length;
  assert.equal(entries.length, hymns.length + refrains);
  for (let i = 1; i < entries.length; i++) assert.ok(entries[i - 1].key.localeCompare(entries[i].key) <= 0, `${entries[i - 1].text} before ${entries[i].text}`);
  const html = renderFirstLines(entries);
  assert.match(html, /<h1>Hymns by first line<\/h1>/);
  assert.match(html, /<a href="\/hymns\/amazing-grace">Amazing grace! how sweet the sound<\/a>/);
  const bar = [...html.matchAll(/<a href="#(lines-[A-Z])">/g)].map((m) => m[1]);
  assert.deepEqual(bar, [...bar].sort());
  for (const id of bar) assert.match(html, new RegExp(`<section class="hymn-letter" id="${id}"`));
  const [list, crumbs] = ld(html);
  assert.equal(list["@type"], "ItemList");
  assert.equal(list.numberOfItems, entries.length);
  assert.equal(crumbs["@type"], "BreadcrumbList");
});
