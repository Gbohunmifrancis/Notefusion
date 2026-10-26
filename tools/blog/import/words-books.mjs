#!/usr/bin/env node
// Imports words-only hymn books that print each hymn's metre and author into content/hymns as words pages, each set to
// a tune we hold in that metre, as such books were sung (the same way as import/watts.mjs):
//   --book 1848  A Book of Hymns for Public and Private Devotion (Samuel Longfellow and Samuel Johnson, Boston 1848; the
//                fifteenth edition of 1866, with its supplement): Project Gutenberg eBook #33180
//   --book 1846  Hymns for Christian Devotion (John G. Adams and Edwin H. Chapin, Boston 1846; the twenty-second
//                edition of 1853): eBook #20476
//
//   node tools/blog/import/words-books.mjs --book 1848|1846 --src FILE [--date YYYY-MM-DD] [--publish] [--dry-run]
//
// FILE is the book's plain text, downloaded beforehand into a directory of its own. It is data: read and parsed here,
// never run.
//
// For every hymn:
//   - its author must be one of AUTHORS (a name the book gives that we can name in full with their dates; two joined by
//     "&" both), or the book's "Anonymous" or a collection it took the hymn from; another author (a surname we cannot
//     place, or a translation whose translator is not named) and it is reported, nothing written;
//   - its metre is the book's label read with the verse's length ("8 & 7s" in eight lines is 8.7.8.7 D); a metre we
//     hold no tune for, or lines that cannot be sung to it, and it is reported;
//   - a hymn already on the site (its first line, or a title or other title of ours) is left alone;
//   - otherwise a page set to one of METRES[pattern].tunes, picked by the page's slug so it keeps its tune.
// The books give only the year they were printed, so the pages say the words were "in print by" it, never a made-up
// first publication: 1848 (1866 for that book's supplement, hymns 480–600), 1853. Pages this importer wrote for the
// book before and no longer produces are removed; no other file is touched. The run ends with the book's report,
// tools/blog/import/hymns-<book>-report.json.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONTENT_DIR } from "../lib/site.mjs";
import { slugify } from "../lib/util.mjs";
import { parseMelody } from "../lib/solfa.mjs";
import { titleCase, normalizeTitle } from "./ohp.mjs";
import { fitLine, underlayDictionary, underlayOf } from "./syllables.mjs";
import { TUNES as WATTS_TUNES, dohOf, fromLaterBook } from "./watts.mjs";

const HYMNS_DIR = path.join(CONTENT_DIR, "hymns");
const TUNES_DIR = path.join(HYMNS_DIR, "tunes");
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The books: where their pages come from (`id`), what the page says of them, and the year their words were in print by.
 * `printedIn(n, year)` is the clause "printed in …, as hymn n" that the page's first paragraph ends with.
 */
export const BOOKS = {
  1848: {
    id: "hymns-1848",
    title: "A Book of Hymns for Public and Private Devotion",
    source: "A Book of Hymns for Public and Private Devotion (1848)",
    printing: "A Book of Hymns for Public and Private Devotion (Samuel Longfellow and Samuel Johnson, 1848), fifteenth edition, 1866",
    yearOf: (n) => (n >= 480 ? 1866 : 1848),
    printedIn: (n, year) => `${n >= 480 ? "the supplement of the 1866 edition of A Book of Hymns for Public and Private Devotion" : "A Book of Hymns for Public and Private Devotion"}, compiled by Samuel Longfellow and Samuel Johnson (Boston, ${year}), as hymn ${n}`,
  },
  1846: {
    id: "hymns-1846",
    title: "Hymns for Christian Devotion",
    source: "Hymns for Christian Devotion (1846)",
    printing: "Hymns for Christian Devotion (John G. Adams and Edwin H. Chapin, 1846), twenty-second edition, 1853",
    yearOf: () => 1853,
    printedIn: (n) => `Hymns for Christian Devotion, compiled by John G. Adams and Edwin H. Chapin (Boston, 1846), as hymn ${n} of its twenty-second edition (1853)`,
  },
};
for (const [key, b] of Object.entries(BOOKS)) b.report = path.join(HERE, `hymns-${key}-report.json`);

/**
 * The metres we can set, by their syllables per line, each with tunes that sing one syllable to a note (checked
 * against their melodies at every run). Common, Long and Short Metre share Watts' tunes.
 */
export const METRES = {
  "8 6 8 6": { name: "Common Metre", tunes: WATTS_TUNES.CM },
  "8 6 8 6 8 6 8 6": { name: "Common Metre Double", tunes: ["materna", "all-saints-new"] },
  "8 8 8 8": { name: "Long Metre", tunes: WATTS_TUNES.LM },
  "8 8 8 8 8 8": { name: "Long Metre, six lines", tunes: ["melita", "selena"] },
  "6 6 8 6": { name: "Short Metre", tunes: WATTS_TUNES.SM },
  "7 7 7 7": { name: "Sevens", tunes: ["innocents", "heinlein", "vienna", "pleyels-hymn", "st-bees"] },
  "7 7 7 7 7 7": { name: "Sevens, six lines", tunes: ["ratisbon-werner", "spanish-hymn"] },
  "7 7 7 7 7 7 7 7": { name: "Sevens Double", tunes: ["hollingside", "martyn", "messiah-herald", "watchman"] },
  "8 7 8 7": { name: "Eights and Sevens", tunes: ["stuttgart", "galilee-jude", "all-for-jesus", "omni-die", "st-oswald"] },
  "8 7 8 7 8 7 8 7": { name: "Eights and Sevens Double", tunes: ["rustington", "lux-eoi"] },
  "8 7 8 7 8 7": { name: "Eights and Sevens, six lines", tunes: ["mannheim"] },
  "8 7 8 7 4 7": { name: "8.7.8.7.4.7", tunes: ["coronae", "st-austin", "st-raphael"] },
  "7 6 7 6 7 6 7 6": { name: "Sevens and Sixes Double", tunes: ["aurelia", "ewing", "greenland", "angels-story"] },
  "10 10 10 10": { name: "Tens", tunes: ["eventide", "ellers", "langran", "song-twenty-two", "penitentia"] },
  "10 10 10 10 10 10": { name: "Tens, six lines", tunes: ["yorkshire"] },
  "11 10 11 10": { name: "Elevens and Tens", tunes: ["perfect-love", "wesley-mason", "henley"] },
  "6 6 4 6 6 6 4": { name: "Sixes and Fours", tunes: ["dort", "malvern-gwyllt"] },
  "6 6 6 6 8 8": { name: "Hallelujah Metre", tunes: ["darwall", "st-john-parish-choir"] },
};

/**
 * The syllables per line the book's metre label gives a verse of `lines` lines, or null: "P. M." (particular metre), a
 * "(Peculiar.)" one, and the rarer lettered metres ("C. P. M.", "H. M." in eight lines) give none. The line count a label
 * may carry ("L. M. 6l.") is the verse's own.
 */
export function patternFor(label, lines) {
  const full = String(label).replace(/\s+/g, " ").trim();
  if (/peculiar/i.test(full)) return null;
  const core = full.replace(/\s*\d+l\.?$/, "").replace(/\s*\bM\.?$/, "").replace(/\.$/, "").trim();   // "L. M. 6l." → "L"
  const repeat = (base) => (lines % base.length === 0 ? Array.from({ length: lines }, (_, i) => base[i % base.length]) : null);
  const exact = (base) => (lines === base.length ? base : null);
  if (core === "C") return repeat([8, 6, 8, 6]);
  if (core === "L") return lines === 6 ? Array(6).fill(8) : repeat([8, 8, 8, 8]);   // "L. M. 6l.": 8.8.8.8.8.8
  if (core === "S") return repeat([6, 6, 8, 6]);
  if (core === "H") return exact([6, 6, 6, 6, 8, 8]);
  // Numbers: "7s", "10s" (every line the same); "8 & 7s", "8s. & 7s." (alternating); "6 & 4s"; "8, 7, & 4s".
  if (!/^[\d\s.,&s]+$/.test(core)) return null;
  const n = (core.match(/\d+/g) || []).map(Number);
  if (n.length === 1) return [4, 6, 8].includes(lines) ? Array(lines).fill(n[0]) : null;
  if (n.length === 2 && n[0] === 6 && n[1] === 4) return exact([6, 6, 4, 6, 6, 6, 4]);
  if (n.length === 2) return lines % 2 === 0 && lines >= 4 ? Array.from({ length: lines }, (_, i) => n[i % 2]) : null;
  if (n.join(" ") === "8 7 4") return exact([8, 7, 8, 7, 4, 7]);
  return null;
}

/**
 * Authors the book names whom we can name in full: the book's spelling → {name, born, died}. Spellings and dates
 * match the people already on our pages. Left out on purpose: surnames that could be more than one writer, and
 * writers whose hymns here are mostly translations (Luther, Goethe, Neale, John Wesley, Hedge, Madame Guyon), whose
 * translator the book does not name.
 */
export const AUTHORS = {
  "Montgomery": ["James Montgomery", 1771, 1854],
  "Gaskell": ["William Gaskell", 1805, 1884],
  "Doddridge": ["Philip Doddridge", 1702, 1751],
  "C. Wesley": ["Charles Wesley", 1707, 1788],
  "Bowring": ["John Bowring", 1792, 1872],
  "Whittier": ["John Greenleaf Whittier", 1807, 1892],
  "Bulfinch": ["Stephen Greenleaf Bulfinch", 1809, 1870],
  "Heber": ["Reginald Heber", 1783, 1826],
  "Watts": ["Isaac Watts", 1674, 1748],
  "Mrs. Hemans": ["Felicia Hemans", 1793, 1835],
  "Moore": ["Thomas Moore", 1779, 1852],
  "Jones Very": ["Jones Very", 1813, 1880],
  "Sarah F. Adams": ["Sarah Flower Adams", 1805, 1848],
  "Emily Taylor": ["Emily Taylor", 1795, 1872],
  "Sterling": ["John Sterling", 1806, 1844],
  "Pierpont": ["John Pierpont", 1785, 1866],
  "Newton": ["John Newton", 1725, 1807],
  "Johns": ["John Johns", 1801, 1847],
  "Norton": ["Andrews Norton", 1786, 1853],
  "Mrs. Miles": ["Sarah Elizabeth Miles", 1807, 1877],
  "Milman": ["Henry Hart Milman", 1791, 1868],
  "Keble": ["John Keble", 1792, 1866],
  "H. Ware": ["Henry Ware Jr.", 1794, 1843],
  "H. Ware, Jr.": ["Henry Ware Jr.", 1794, 1843],
  "H. Ware, Jr": ["Henry Ware Jr.", 1794, 1843],
  "Furness": ["William Henry Furness", 1802, 1896],
  "Cowper": ["William Cowper", 1731, 1800],
  "Barton": ["Bernard Barton", 1784, 1849],
  "Mrs. Barbauld": ["Anna Laetitia Barbauld", 1743, 1825],
  "Barbauld": ["Anna Laetitia Barbauld", 1743, 1825],
  "E. H. Chapin": ["Edwin Hubbell Chapin", 1814, 1880],
  "Drummond": ["William Drummond of Hawthornden", 1585, 1649],
  "Conder": ["Josiah Conder", 1789, 1855],
  "Bryant": ["William Cullen Bryant", 1794, 1878],
  "Alford": ["Henry Alford", 1810, 1871],
  "A. C. Coxe": ["Arthur Cleveland Coxe", 1818, 1896],
  "W. H. Burleigh": ["William Henry Burleigh", 1812, 1871],
  "Patrick": ["John Patrick", 1632, 1695],
  "Mrs. Sigourney": ["Lydia Sigourney", 1791, 1865],
  "Mrs. Howitt": ["Mary Howitt", 1799, 1888],
  "Mrs. Gilman": ["Caroline Gilman", 1794, 1888],
  "Mrs. Follen": ["Eliza Lee Cabot Follen", 1787, 1860],
  "Merrick": ["James Merrick", 1720, 1769],
  "J. Weiss": ["John Weiss", 1818, 1879],
  "J. H. Perkins": ["James Handasyd Perkins", 1810, 1849],
  "H. Martineau": ["Harriet Martineau", 1802, 1876],
  "H. M. Williams": ["Helen Maria Williams", 1759, 1827],
  "Wotton": ["Henry Wotton", 1568, 1639],
  "W. Scott": ["Walter Scott", 1771, 1832],
  "R. W. Emerson": ["Ralph Waldo Emerson", 1803, 1882],
  "R. C. Trench": ["Richard Chenevix Trench", 1807, 1886],
  "J. R. Lowell": ["James Russell Lowell", 1819, 1891],
  "E. H. Sears": ["Edmund Hamilton Sears", 1810, 1876],
  "E. B. Barrett": ["Elizabeth Barrett Browning", 1806, 1861],
  "H. K. White": ["Henry Kirke White", 1785, 1806],
  "Edmeston": ["James Edmeston", 1791, 1867],
  "Mrs. Steele": ["Anne Steele", 1717, 1778],
  "T. Parker": ["Theodore Parker", 1810, 1860],
  "Smart": ["Christopher Smart", 1722, 1771],
  "Sandys": ["George Sandys", 1578, 1644],
  "W. Roscoe": ["William Roscoe", 1753, 1831],
  "W. J. Fox": ["William Johnson Fox", 1786, 1864],
  "W. Croswell": ["William Croswell", 1804, 1851],
  "Croswell": ["William Croswell", 1804, 1851],
  "Mrs. Southey": ["Caroline Bowles Southey", 1786, 1854],
  "Mrs. Osgood": ["Frances Sargent Osgood", 1811, 1850],
  "Marriott": ["John Marriott", 1780, 1825],
  "L. E. Landon": ["Letitia Elizabeth Landon", 1802, 1838],
  "Jane Taylor": ["Jane Taylor", 1783, 1824],
  "J. F. Clarke": ["James Freeman Clarke", 1810, 1888],
  "Hogg": ["James Hogg", 1770, 1835],
  "Hart": ["Joseph Hart", 1712, 1768],
  "Grant": ["Robert Grant", 1779, 1838],
  "Dr. Tuckerman": ["Joseph Tuckerman", 1778, 1840],
  "Dale": ["Thomas Dale", 1797, 1870],
  "Browne": ["Simon Browne", 1680, 1732],
  "Frothingham": ["Nathaniel Langdon Frothingham", 1793, 1870],
  "Flint": ["James Flint", 1779, 1855],
  "S. S. Cutting": ["Sewall Sylvester Cutting", 1813, 1882],
  "J. G. Adams": ["John Greenleaf Adams", 1810, 1887],
  "M. B. Lamar": ["Mirabeau B. Lamar", 1798, 1859],
  // Hymns for Christian Devotion (1846) adds these, and other spellings of the above.
  "Steele": ["Anne Steele", 1717, 1778],
  "J. Newton": ["John Newton", 1725, 1807],
  "E. Taylor": ["Emily Taylor", 1795, 1872],
  "L. H. Sigourney": ["Lydia Sigourney", 1791, 1865],
  "Bp. Heber": ["Reginald Heber", 1783, 1826],
  "J. G. Whittier": ["John Greenleaf Whittier", 1807, 1892],
  "H. H. Milman": ["Henry Hart Milman", 1791, 1868],
  "Sir Walter Scott": ["Walter Scott", 1771, 1832],
  "Sir H. Wotton": ["Henry Wotton", 1568, 1639],
  "George Sandys": ["George Sandys", 1578, 1644],
  "Miss Martineau": ["Harriet Martineau", 1802, 1876],
  "Landon": ["Letitia Elizabeth Landon", 1802, 1838],
  "S. F. Adams": ["Sarah Flower Adams", 1805, 1848],
  "B. Barton": ["Bernard Barton", 1784, 1849],
  "Hemans": ["Felicia Hemans", 1793, 1835],
  "Beddome": ["Benjamin Beddome", 1717, 1795],
  "S. F. Smith": ["Samuel Francis Smith", 1808, 1895],
  "Sir J. E. Smith": ["James Edward Smith", 1759, 1828],
  "Pope": ["Alexander Pope", 1688, 1744],
  "Milton": ["John Milton", 1608, 1674],
  "Heginbotham": ["Ottiwell Heginbotham", 1744, 1768],
  "Kippis": ["Andrew Kippis", 1725, 1795],
  "Henry Moore": ["Henry Moore", 1732, 1802],
  "Gibbons": ["Thomas Gibbons", 1720, 1785],
  "Fawcett": ["John Fawcett", 1740, 1817],
  "John Fawcett": ["John Fawcett", 1740, 1817],
  "Cotton": ["Nathaniel Cotton", 1705, 1788],
  "Collyer": ["William Bengo Collyer", 1782, 1854],
  "Addison": ["Joseph Addison", 1672, 1719],
  "S. Streeter": ["Sebastian Streeter", 1783, 1867],
  "Kelly": ["Thomas Kelly", 1769, 1855],
  "Logan": ["John Logan", 1748, 1788],
  "Medley": ["Samuel Medley", 1738, 1799],
  "Herbert": ["George Herbert", 1593, 1633],
  "Kenn": ["Thomas Ken", 1637, 1711],
  "Bishop Kenn": ["Thomas Ken", 1637, 1711],
  "Toplady": ["Augustus Montague Toplady", 1740, 1778],
  "R. Palmer": ["Ray Palmer", 1808, 1887],
  "W. B. Tappan": ["William Bingham Tappan", 1794, 1849],
  "Raffles": ["Thomas Raffles", 1788, 1863],
  "Enfield": ["William Enfield", 1741, 1797],
  "Drennan": ["William Drennan", 1754, 1820],
  "Blacklock": ["Thomas Blacklock", 1721, 1791],
  "Butcher": ["Edmund Butcher", 1757, 1822],
  "C. Sprague": ["Charles Sprague", 1791, 1875],
  "Dwight": ["Timothy Dwight", 1752, 1817],
  "Cennick": ["John Cennick", 1718, 1755],
  "Grigg": ["Joseph Grigg", 1720, 1768],
  "Haweis": ["Thomas Haweis", 1734, 1820],
  "Hastings": ["Thomas Hastings", 1784, 1872],
  "Gisborne": ["Thomas Gisborne", 1758, 1846],
  "Dryden": ["John Dryden", 1631, 1700],
  "Burns": ["Robert Burns", 1759, 1796],
  "Bathurst": ["William Hiley Bathurst", 1796, 1877],
  "Willis": ["Nathaniel Parker Willis", 1806, 1867],
  "Waterston": ["Robert Cassie Waterston", 1812, 1893],
  "R. C. Waterston": ["Robert Cassie Waterston", 1812, 1893],
  "H. F. Gould": ["Hannah Flagg Gould", 1789, 1865],
  "Miss H. F. Gould": ["Hannah Flagg Gould", 1789, 1865],
  "H. Ballou": ["Hosea Ballou", 1771, 1852],
  "H. Ballou, 2d": ["Hosea Ballou II", 1796, 1861],
  "T. Whittemore": ["Thomas Whittemore", 1800, 1861],
  "O. A. Skinner": ["Otis Ainsworth Skinner", 1807, 1861],
  "J. Q. Adams": ["John Quincy Adams", 1767, 1848],
  "J. J. Gurney": ["Joseph John Gurney", 1788, 1847],
  "T. H. Bayley": ["Thomas Haynes Bayly", 1797, 1839],
  "A. C. Thomas": ["Abel Charles Thomas", 1807, 1880],
  "Stowell": ["Hugh Stowell", 1799, 1865],
  "Thomson": ["James Thomson", 1700, 1748],
  "E. Peabody": ["Ephraim Peabody", 1807, 1856],
  "Mrs. Hale": ["Sarah Josepha Hale", 1788, 1879],
  "Mrs. Gilbert": ["Ann Gilbert", 1782, 1866],
  "Mrs. Brown": ["Phoebe Hinsdale Brown", 1783, 1861],
  "Tate": ["Nahum Tate", 1652, 1715],
  "Brady": ["Nicholas Brady", 1659, 1726],
  "Bickersteth": ["Edward Bickersteth", 1786, 1850],
  "Jay": ["William Jay", 1769, 1853],
  "Hammond": ["William Hammond", 1719, 1783],
};

/** The transcription's misprints of names in AUTHORS. */
const MISPRINTS = { "L. H. Signourney": "L. H. Sigourney", "Mrs. Bareauld": "Mrs. Barbauld", "Byrant": "Bryant" };

/**
 * Sources the book gives instead of an author (a collection, a magazine, a church's book): the words are anonymous,
 * and the page says where the book had them.
 */
const COLLECTIONS = /^(Anonymous|Moravian|Wesleyan|Methodist|German|Breviary|Ancient Hymns|Hymns of Zion)$|(\b(Coll?|Co|Sel|H\. ?B|Book|Hymns|Psalmist|Psalmody|Psalms|Magazine|Mag|Review|Register|Lyrics|Songs|Choir|Watchman|Ballads|Inquirer|Memorial))$/;
/** …except a hymn the book has from a Latin breviary or from German: translated, by a translator it does not name. */
const TRANSLATED = /^(Breviary|Roman Breviary|German|Ancient Hymns|Lutheran Coll)$/;

/** The book's hymns: [{number, label, author, altered, heading, verses: [[lines]]}]; the doxologies at the end left out. */
export function parseBook(text) {
  const lines = String(text).replace(/\r/g, "").replace(/[ \t]*--[ \t]*/g, " — ").split("\n");
  const hymns = [];
  let cur = null, stanza = null;
  const close = () => { if (stanza && stanza.length) cur.verses.push(stanza); stanza = null; };
  const end = () => { if (cur) { close(); hymns.push(cur); cur = null; } };
  for (const raw of lines) {
    if (/^\*\*\* END|^\s*DOXOLOGIES\.\s*$/.test(raw)) { end(); break; }
    // "23.                               L. M.                     Frothingham."; "33.   L. M. 6l.   Watts."
    const head = /^(\d+)\.\s{3,}(\S.*?)(?:\s{2,}(\*?)(\S.*?))?\s*$/.exec(raw);
    if (head && /(\bM|\d+s|\d+l|Peculiar\.?[)\]])\.?$/.test(head[2]) && !/^\s/.test(raw)) {
      end();
      cur = { number: Number(head[1]), label: head[2].trim(), altered: head[3] === "*", author: (head[4] || "").replace(/\.$/, "").trim(), heading: [], verses: [] };
      continue;
    }
    // The next number with the author a single space after the metre ("496.   S. M. Patrick"): still a header, or its
    // verses would run on into the hymn before it.
    const loose = /^(\d+)\.\s{3,}(\S.*?)\s*$/.exec(raw);
    if (loose && cur && Number(loose[1]) === cur.number + 1) {
      const after = (token) => new RegExp(`^(.*?${token}(?:\\s*\\d+l\\.)?(?:\\s*[([]Peculiar\\.?[)\\]])?)\\s+(\\*?)(\\S.*)$`).exec(loose[2]);
      const m = after("\\bM\\.?") || after("\\d+s\\.");
      end();
      cur = { number: Number(loose[1]), label: (m ? m[1] : loose[2]).trim(), altered: m?.[2] === "*", author: (m ? m[3] : "").replace(/\.$/, "").trim(), heading: [], verses: [] };
      continue;
    }
    if (!cur) continue;
    if (/^\s*SUPPLEMENT\.\s*$/.test(raw)) { end(); continue; }
    const line = raw.trim();
    if (!line) { close(); continue; }
    const start = /^\s{0,3}(\d+)\s+(\S.*)$/.exec(raw);
    if (start) { close(); stanza = [start[2].trim()]; continue; }
    if (stanza) stanza.push(line);
    else if (!cur.verses.length) cur.heading.push(line);
  }
  end();
  // The transcription marks italics as _word_; an underlay reads "_" as a held note.
  for (const h of hymns) h.verses = h.verses.map((v) => v.map((l) => l.replace(/_/g, "").trim()).filter(Boolean));
  return hymns;
}

/**
 * Who wrote the words, as the page credits them ({people, from, altered}), or why we cannot say ({why}). "A & B" is two
 * writers, both of whom we must be able to name; ", alt." is the book's mark for words it altered.
 */
export function authorOf(h) {
  if (!h.author) return { why: "the book names no author" };
  const altered = /,\s*alt\.?$/.test(h.author);
  const label = MISPRINTS[h.author.replace(/,\s*alt\.?$/, "")] || h.author.replace(/,\s*alt\.?$/, "");
  if (TRANSLATED.test(label)) return { why: `a translation (from ${label}) whose translator the book does not name` };
  if (COLLECTIONS.test(label)) return { people: [{ name: "Anonymous", traditional: true, role: "Words" }], from: label === "Anonymous" ? null : label, altered };
  const names = label.split(/\s+&\s+/);
  const people = [];
  for (const n of names) {
    const known = AUTHORS[n];
    if (!known) return { why: `an author we cannot name in full: “${n}”` };
    const [name, born, died] = known;
    people.push({ name, born, died, role: "Words" });
  }
  return { people, altered };
}

/** The first verse under the pattern, one syllable to a note, if every verse is the pattern's length and nearly every line fits it. */
export function fitHymn(verses, pattern, dict) {
  if (!verses.length || verses.some((v) => v.length !== pattern.length)) return { why: "verses of different lengths" };
  let fits = 0;
  for (const v of verses) v.forEach((l, i) => { if (fitLine(l, pattern[i], dict)) fits++; });
  const total = verses.length * pattern.length;
  if (fits / total < 0.8) return { why: `only ${fits} of ${total} lines sing as ${pattern.join(".")}` };
  const first = verses[0].map((l, i) => fitLine(l, pattern[i], dict));
  if (!first.every(Boolean)) return { why: `its first verse cannot be sung as ${pattern.join(".")}` };
  return { underlay: underlayOf(first) };
}

/** A tune for the page, the same every run: picked from the metre's list by the slug. */
export function pickTune(slug, pattern) {
  const list = METRES[pattern].tunes;
  const n = crypto.createHash("sha256").update(slug).digest().readUInt32BE(0);
  return list[n % list.length];
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const jsonText = (x) => JSON.stringify(x, null, 2) + "\n";
const firstWords = (s, n = 6) => normalizeTitle(s).split(" ").slice(0, n).join(" ");
const sentence = (s) => s.replace(/[.\s]+$/, "");

export function runImport({ src, today, book, publish = false, dryRun = false, hymnsDir = HYMNS_DIR, tunesDir = TUNES_DIR, reportPath = BOOKS[book].report, log = console.log }) {
  const B = BOOKS[book];
  const hymns = parseBook(fs.readFileSync(src, "utf8"));
  const dict = underlayDictionary(hymnsDir);

  // The tunes, checked: published, a doh we can name, one note per syllable of the metre.
  const tunes = {};
  for (const [pattern, m] of Object.entries(METRES)) for (const slug of m.tunes) {
    const t = readJson(path.join(tunesDir, `${slug}.json`));
    const notes = parseMelody(t.melody, { time: t.time, pickup: t.pickup || 0 }).notes.length;
    const want = pattern.split(" ").map(Number).reduce((a, b) => a + b, 0);
    if (t.draft || !dohOf(t.key) || notes !== want) throw new Error(`${slug} cannot carry ${m.name} one syllable to a note`);
    tunes[slug] = t;
  }

  // What we have: every hymn's first line, title and other titles; the files this importer wrote.
  // (A book after this one in SET_BY_METRE_ORDER is not "what we have": see watts.mjs.)
  const ours = new Map(), mine = new Set(), later = new Set();
  for (const f of fs.readdirSync(hymnsDir).filter((f) => f.endsWith(".json"))) {
    const h = readJson(path.join(hymnsDir, f));
    const slug = f.replace(/\.json$/, "");
    if (h.importedFrom?.startsWith(`${B.id}:`)) { mine.add(slug); continue; }
    if (fromLaterBook(h, B.id)) { later.add(slug); continue; }
    for (const t of [h.title, ...(h.alsoKnownAs || []), h.verses?.[0]?.lines?.[0]].filter(Boolean)) ours.set(firstWords(t), slug);
  }

  const report = { source: B.printing, date: today, written: [], alreadyOurs: [], skipped: [], counts: {} };
  const keep = new Set();
  for (const h of hymns) {
    const ref = String(h.number);
    const first = h.verses[0]?.[0];
    if (!first) { report.skipped.push({ ref, why: "no verses" }); continue; }
    const have = ours.get(firstWords(first));
    if (have) { report.alreadyOurs.push({ ref, first, page: have }); continue; }
    const { people, from, altered, why: whoWhy } = authorOf(h);
    if (!people) { report.skipped.push({ ref, first, why: whoWhy }); continue; }
    const anonymous = people[0].traditional;
    const names = people.map((p) => p.name).join(" and ");
    const pattern = patternFor(h.label, h.verses[0].length)?.join(" ");
    if (!pattern || !METRES[pattern]) { report.skipped.push({ ref, first, why: `no tune we hold for “${h.label}” in ${h.verses[0].length}-line verses` }); continue; }
    const { underlay, why } = fitHymn(h.verses, pattern.split(" ").map(Number), dict);
    if (!underlay) { report.skipped.push({ ref, first, why }); continue; }

    const title = titleCase(first.replace(/[\s,;:.!?—-]+$/u, ""));
    const slug = slugify(title);
    if (keep.has(slug) || (fs.existsSync(path.join(hymnsDir, `${slug}.json`)) && !mine.has(slug) && !later.has(slug))) { report.skipped.push({ ref, first, why: `the page ${slug} is taken` }); continue; }
    const tune = pickTune(slug, pattern), t = tunes[tune];
    const doh = dohOf(t.key);
    const m = METRES[pattern];
    let description = `${title} in Tonic Solfa to ${t.name}, doh is ${doh}: the solfa with the words, staff notation, ${h.verses.length} verses and a piano.`;
    if (description.length > 160) description = `${title}: Tonic Solfa to ${t.name} (doh is ${doh}), staff notation and ${h.verses.length} verses.`;
    if (description.length > 160) { report.skipped.push({ ref, first, why: "title too long for a description" }); continue; }
    const year = B.yearOf(h.number);
    const heading = sentence(h.heading.join(" ").replace(/\s+/g, " ").trim());
    const source = from && from.replace(/ Coll?$/, " Collection").replace(/ Sel$/, " Selection");
    const who = anonymous
      ? `These words were printed without an author's name in ${B.printedIn(h.number, year)}${heading ? `, “${heading}”` : ""}${source ? `, where the book credits them to ${/^(Wesleyan|Moravian|Methodist)$/.test(source) ? `a ${source} source` : `${/'s?\s/.test(source) ? "" : "the "}${source}`}` : ""}.`
      : `${names} wrote these words. They were printed in ${B.printedIn(h.number, year)}${heading ? `, “${heading}”` : ""}.`;
    const page = {
      title,
      tune,
      text: people,
      textPublished: year,
      textPublishedBy: true,
      description,
      about: [
        who + (h.altered || altered ? " The compilers changed some of the words, and this is their version." : ""),
        `The book printed the words without tunes, marked ${m.name}${/\d/.test(m.name) ? "" : ` (${pattern.split(" ").join(".")})`}, to be sung to any tune of that metre. This page sets them to ${t.name}; any other ${m.name} tune fits them as well.`,
      ],
      underlay,
      verses: h.verses.map((lines) => ({ lines })),
      metre: pattern,
      source: B.source,
      licence: anonymous ? `Public domain: anonymous words in print by ${year}.` : `Public domain: ${people.map((p) => `${p.name} died in ${p.died}`).join("; ")}.`,
      credits: `Words ${anonymous ? "anonymous" : `by ${people.map((p) => `${p.name} (${p.born}–${p.died})`).join(" and ")}`}, public domain, as printed in ${B.title} (${year}); set to ${t.name} by NoteFusion, as words-only hymn books were sung.`,
      updated: today,
      reviewed: false,
      draft: !publish,
      setByMetre: true,
      importedFrom: `${B.id}:${ref}`,
    };
    keep.add(slug);
    report.written.push({ ref, slug, metre: pattern, tune, author: names });
    const file = path.join(hymnsDir, `${slug}.json`);
    if (!dryRun) {
      const old = fs.existsSync(file) ? readJson(file) : null;
      if (!old || jsonText({ ...old, updated: null }) !== jsonText({ ...page, updated: null })) fs.writeFileSync(file, jsonText(page));
    }
  }
  const removed = [...mine].filter((s) => !keep.has(s));
  if (!dryRun) for (const s of removed) fs.rmSync(path.join(hymnsDir, `${s}.json`));
  report.counts = { hymns: hymns.length, written: report.written.length, alreadyOurs: report.alreadyOurs.length, skipped: report.skipped.length, removed: removed.length };
  if (!dryRun) fs.writeFileSync(reportPath, jsonText(report));
  log(`${B.title}: ${hymns.length} hymns; ${report.written.length} pages${publish ? "" : " (drafts)"}, ${report.alreadyOurs.length} already ours, ${report.skipped.length} skipped, ${removed.length} removed.`);
  return report;
}

function main() {
  const args = process.argv.slice(2);
  const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const src = arg("--src"), book = arg("--book");
  if (!src || !BOOKS[book]) { console.error("usage: node tools/blog/import/words-books.mjs --book 1848|1846 --src FILE [--date YYYY-MM-DD] [--publish] [--dry-run]"); process.exit(2); }
  const today = arg("--date") || new Date().toISOString().slice(0, 10);
  runImport({ src, today, book, publish: args.includes("--publish"), dryRun: args.includes("--dry-run") });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
