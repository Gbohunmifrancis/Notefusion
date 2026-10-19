// The ways into the hymnal besides A–Z by title: seasons and occasions (/hymns/occasions/<slug>), the people
// who wrote the words and the music (/hymns/people/<slug>), and every first line (/hymns/first-lines). This
// file only groups and sorts what content/ already says; lib/render-collections.mjs writes the pages.
import { slugify } from "./util.mjs";

/** Where the site keeps every name a person has been credited by and their page's address (see collectPeople). */
export const PEOPLE_ADDRESSES_PATH = "hymns/people/addresses.json";

// ── Seasons and occasions ───────────────────────────────────────────────────
/**
 * The church year, then the other occasions. A hymn is filed under an occasion when its `category` is one
 * of the occasion's categories (the Open Hymnal Project files every hymn it publishes under one), or when
 * its own `occasions` list names it (the hymns encoded by hand, which have no category). Topics are not used:
 * the Open Hymnal's topic tags name what a hymn mentions ("Harvest", "Trinity", "Easter"), not when it is
 * sung. An occasion gets a page only with at least MIN_OCCASION hymns, so no page is thin; the rest wait.
 * A tune page (content/hymns/tunes, a tune without words) is filed the same way by its own `occasions` list, and
 * counts toward that minimum. `intro` is the page's opening, in plain facts about the day; nothing about any one
 * hymn. `what` names the page's list where it is more than hymns (Halloween's songs and hymns).
 */
export const OCCASIONS = [
  { slug: "advent", name: "Advent", categories: ["Advent"], noun: "hymns", intro: "Advent is the four Sundays before Christmas, when the church prepares to celebrate the coming of Christ. Its hymns look forward: to his birth at Bethlehem and to his coming again." },
  { slug: "christmas", name: "Christmas", categories: ["Christmas"], noun: "carols and hymns", intro: "Carols and hymns for Christmas Eve, Christmas Day and the twelve days that follow. They tell of the birth of Jesus at Bethlehem: the angels, the shepherds and the child in the manger." },
  { slug: "epiphany", name: "Epiphany", categories: ["Epiphany"], noun: "hymns", intro: "Epiphany, on 6 January, remembers the wise men who followed the star to the child Jesus. The Sundays after it recall how he was made known to the world, from his baptism in the Jordan onwards." },
  { slug: "lent", name: "Lent", categories: ["Lent"], noun: "hymns", intro: "Lent is the forty days before Easter, from Ash Wednesday, kept with prayer, fasting and repentance. Its hymns turn to sorrow for sin, to Christ's forty days in the wilderness and to his cross." },
  { slug: "holy-week", name: "Holy Week", categories: ["Palm Sunday", "Good Thursday", "Good Friday"], noun: "hymns", intro: "Holy Week runs from Palm Sunday, when Jesus rode into Jerusalem, through Maundy Thursday and Good Friday to Easter Eve. These hymns follow it: the palms and hosannas, the Last Supper and Gethsemane, and the cross." },
  { slug: "good-friday", name: "Good Friday", categories: ["Good Friday"], noun: "hymns", intro: "Good Friday, the Friday before Easter Day, remembers the crucifixion of Jesus. These are hymns of the cross and of his suffering and death." },
  { slug: "easter", name: "Easter", categories: ["Easter"], noun: "hymns", intro: "Easter Day celebrates the resurrection of Jesus from the dead, and the Easter season runs on for fifty days to Pentecost. These are hymns of the empty tomb and the risen Lord." },
  { slug: "ascension", name: "Ascension", categories: ["Ascension"], noun: "hymns", intro: "Ascension Day, forty days after Easter, remembers Jesus being taken up into heaven. Its hymns sing of Christ ascended, reigning and praying for his people." },
  { slug: "pentecost", name: "Pentecost", categories: ["Pentecost"], noun: "hymns", intro: "Pentecost, fifty days after Easter, remembers the Holy Spirit coming upon the apostles in Jerusalem. Its hymns pray for the Spirit's breath, light and fire." },
  { slug: "trinity", name: "Trinity", categories: ["Trinity"], noun: "hymns", intro: "Trinity Sunday, the Sunday after Pentecost, praises one God: Father, Son and Holy Spirit." },
  { slug: "harvest", name: "Harvest", categories: ["Harvest"], noun: "hymns", intro: "Harvest thanksgiving, when a church brings the fruits of the year to God and gives thanks for them." },
  { slug: "halloween", name: "Halloween", categories: [], noun: "songs and hymns", what: "songs and hymns", intro: "Halloween, on 31 October, is All Hallows' Eve: the night before All Saints' Day, when the church remembers all the saints. The night has its spooky classics and folk songs, and the day that follows its All Saints hymns." },
  { slug: "all-saints", name: "All Saints", categories: [], noun: "hymns", intro: "All Saints' Day, on 1 November, remembers all the saints, known and unknown, who have gone before in the faith." },
  { slug: "thanksgiving", name: "Thanksgiving", categories: ["Thanksgiving"], noun: "hymns", intro: "Hymns of thanks to God, for a thanksgiving service, a harvest, an anniversary or any Sunday a church sets aside to give thanks." },
  { slug: "communion", name: "Holy Communion", categories: ["Lord’s Supper"], noun: "hymns", intro: "Hymns for the Lord's Supper, also called Holy Communion or the Eucharist, sung before and while the bread and wine are shared." },
  { slug: "baptism", name: "Baptism", categories: ["Baptismal Life"], noun: "hymns", intro: "Hymns for a baptism, and for remembering the promises made in it." },
  { slug: "wedding", name: "Wedding", categories: [], noun: "hymns", intro: "Hymns for a wedding service." },
  { slug: "morning", name: "Morning", categories: ["Morning"], noun: "hymns", intro: "Hymns for the start of the day: morning prayer, a morning service or an assembly." },
  { slug: "evening", name: "Evening", categories: ["Evening"], noun: "hymns", intro: "Hymns for the close of the day, for evening prayer or an evening service. They give thanks for the day and ask God's keeping through the night." },
  { slug: "funeral", name: "Funeral", categories: ["Funeral"], noun: "hymns", intro: "Hymns of comfort and of the hope of the resurrection, for a funeral, a wake or a memorial service." },
  { slug: "new-year", name: "New Year", categories: [], noun: "hymns", intro: "Hymns for the turn of the year, from a watchnight service on 31 December to the first Sunday of January." },
];
export const MIN_OCCASION = 4;
export const OCCASION_NAMES = OCCASIONS.map((o) => o.name);

/** True when the hymn is filed under the occasion (see OCCASIONS). */
export function inOccasion(h, o) {
  return o.categories.includes(h.category) || (h.occasions || []).includes(o.name);
}

/**
 * The occasions that get a page, each with its hymns and its tune pages (A–Z, as given), in the order of the
 * church year. `tunes` are published tune pages (after prepareTune); a hymn and a tune page count alike.
 */
export function occasionPages(hymns, tunes = []) {
  return OCCASIONS.map((o) => ({ ...o, url: `/hymns/occasions/${o.slug}`, hymns: hymns.filter((h) => inOccasion(h, o)), tunes: tunes.filter((t) => inOccasion(t, o)) }))
    .filter((o) => o.hymns.length + o.tunes.length >= MIN_OCCASION);
}

// ── People ──────────────────────────────────────────────────────────────────
/** A person's dates as the hymn and tune pages print them: "(1725–1807)", "(died 1604)", "(5th century)", "(fl. 1820)". */
export function personYears(p) {
  return p.traditional ? "" : !p.died ? (p.activeBy ? ` (fl. ${p.activeBy})` : "") : p.lived ? ` (${p.lived})` : p.born ? ` (${p.born}–${p.died})` : ` (died ${p.died})`;
}

/** "Fanny Jane Crosby" → "Crosby": the last name, past a parenthesis ("Lelia Naylor (Mrs. Charles H.) Morris") or ", Jr.". */
export function surname(name) {
  const words = String(name).replace(/\([^)]*\)/g, " ").replace(/,?\s+(Jr|Sr)\.?$/i, "").trim().split(/\s+/);
  return words[words.length - 1];
}

/**
 * Who a credit names, so one person credited two ways is one page: the same surname, the same first name and
 * the same years ("Fanny Crosby" and "Fanny Jane Crosby", "Philip P. Bliss" and "Philip Paul Bliss").
 */
export function personKey(p) {
  const first = String(p.name).trim().split(/\s+/)[0].toLowerCase();
  return [surname(p.name).toLowerCase(), first, p.born ?? "", p.died ?? "", p.lived ?? "", p.activeBy ?? ""].join("|");
}

/** What a credit's role makes the person on that hymn or tune. */
function roleOf(kind, role) {
  if (kind === "text") return /^Translated/i.test(role) ? "translation" : "words";
  return /^(Arranged|Harmony|Harmonized|Adapted)/i.test(role) ? "arrangement" : "music";
}
const ROLE_NAMES = { words: "Hymn writer", translation: "Translator", music: "Composer", arrangement: "Arranger" };

/**
 * Everyone credited (words or music, by name: not "traditional") on at least two published hymns and tune
 * pages together, A–Z by surname. Each: { key, slug, url, name, years, role, works: [{ kind, item, as }] },
 * `as` being what they gave that hymn or tune ("words", "translation", "music", "arrangement").
 * `addresses` ({ name: slug }, every name a person has been credited by) keeps each page at the address it was first
 * given, so a new credit that changes the name most of them use does not move a published page.
 */
export function collectPeople(hymns, tunes = [], { min = 2, addresses = {} } = {}) {
  const byKey = new Map();
  const credit = (p, kind, item, itemKind) => {
    if (!p || p.traditional || !p.name) return;
    const key = personKey(p);
    if (!byKey.has(key)) byKey.set(key, { key, names: new Map(), dates: [], works: new Map() });
    const e = byKey.get(key);
    e.names.set(p.name, (e.names.get(p.name) || 0) + 1);
    e.dates.push({ years: personYears(p).trim(), born: p.born, died: p.died, lived: p.lived });
    const id = `${itemKind}:${item.slug}`;
    if (!e.works.has(id)) e.works.set(id, { kind: itemKind, item, as: [] });
    const as = roleOf(kind, p.role || "");
    if (!e.works.get(id).as.includes(as)) e.works.get(id).as.push(as);
  };
  for (const h of hymns) {
    for (const p of h.text) credit(p, "text", h, "hymn");
    for (const p of h.tuneData.music) credit(p, "music", h, "hymn");
  }
  for (const t of tunes) for (const p of t.music) credit(p, "music", t, "tune");

  const people = [];
  for (const e of byKey.values()) {
    if (e.works.size < min) continue;
    // The name most of their credits use (the longer on a tie), and the years most of them give.
    const name = [...e.names].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
    const counts = new Map();
    for (const d of e.dates) counts.set(d.years, (counts.get(d.years) || 0) + 1);
    const years = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    const dates = e.dates.find((d) => d.years === years);
    const works = [...e.works.values()];
    const order = ["words", "translation", "music", "arrangement"];
    const roles = order.filter((r) => works.some((w) => w.as.includes(r))).map((r, i) => (i ? ROLE_NAMES[r].toLowerCase() : ROLE_NAMES[r]));
    const role = roles.length > 1 ? `${roles.slice(0, -1).join(", ")} and ${roles[roles.length - 1]}` : roles[0];
    people.push({ key: e.key, name, names: [...e.names.keys()], years, born: dates.lived ? undefined : dates.born, died: dates.lived ? undefined : dates.died, role, works });
  }
  people.sort((a, b) => surname(a.name).localeCompare(surname(b.name)) || a.name.localeCompare(b.name));
  // Each person's address (a parenthesis in the name is left out of it); two people whose names make the same
  // slug are told apart by their dates.
  const taken = new Map();
  const kept = (p) => p.names.map((n) => addresses[n]).find((slug) => slug && !taken.has(slug));
  for (const p of people) {
    let slug = kept(p) || slugify(p.name.replace(/\([^)]*\)/g, " "));
    if (taken.has(slug)) slug = slugify(`${p.name} ${p.years}`);
    taken.set(slug, p);
    p.slug = slug;
    p.url = `/hymns/people/${slug}`;
  }
  return people;
}

// ── First lines ─────────────────────────────────────────────────────────────
/** The key a first line sorts under: letters and digits, accents and leading quotation marks dropped. */
export function firstLineSortKey(text) {
  return String(text).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** A line as a first-line index prints it: without its closing comma, semicolon, colon or full stop. */
export function cleanFirstLine(line) {
  return String(line).trim().replace(/[,;:.]+$/, "");
}

/**
 * Every hymn's first line, and the first line of its refrain when it has one, A–Z (ignoring quotation marks
 * and accents; the hymn's title breaks a tie). Each: { text, key, letter, hymn, refrain }.
 */
export function firstLineEntries(hymns) {
  const out = [];
  for (const h of hymns) {
    out.push({ text: cleanFirstLine(h.verses[0].lines[0]), hymn: h, refrain: false });
    const chorus = h.verses.find((v) => /^(Refrain|Chorus)$/i.test(v.label || ""));
    if (chorus) out.push({ text: cleanFirstLine(chorus.lines[0]), hymn: h, refrain: true });
  }
  for (const e of out) {
    e.key = firstLineSortKey(e.text);
    e.letter = /^[a-z]/.test(e.key) ? e.key[0].toUpperCase() : "#";
  }
  return out.sort((a, b) => a.key.localeCompare(b.key) || a.hymn.title.localeCompare(b.hymn.title) || Number(a.refrain) - Number(b.refrain));
}

/** `addresses` with every name each of `people` is credited by pointing at their page; a name already there keeps its address. */
export function peopleAddresses(people, addresses = {}) {
  const out = { ...addresses };
  for (const p of people) for (const n of p.names) if (!(n in out)) out[n] = p.slug;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
