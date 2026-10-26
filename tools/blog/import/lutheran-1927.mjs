// The Evangelical Lutheran Hymn-Book, abridged edition (Concordia, St. Louis 1927; Project Gutenberg eBook #76498), as
// import/words-books.mjs reads it (--book lutheran): its layout, and the people its attribution lines name.
//
// Every hymn is a number on a line of its own, the metre right-aligned ("C. M. 8 l", "8, 7, 8, 7, 8, 8, 7"), the first
// verse unnumbered and the rest "2.", "3.", and at the end, indented, who wrote it: "H. Bonar, 1846." or
// "B. Schmolck, 1734; C. Winkworth, tr., 1862.". A hymn is taken only when everyone the line names is in NAMES (in full,
// with the dates our pages already give them), and one from German or Latin only with its translator named: the
// translations the book prints without one (its own committee's, mostly) are left out.

/**
 * The book's spelling of a name → [name, born, died, language]. Born may be null where only the death is sure; the
 * language is the one the person wrote in ("en", or "de"/"la"/… for the originals a translator turned into English).
 */
export const NAMES = {
  // Translators.
  "C. Winkworth": ["Catherine Winkworth", 1827, 1878, "en"],
  "A. Crull": ["August Crull", 1845, 1923, "en"],
  "M. Loy": ["Matthias Loy", 1828, 1915, "en"],
  "R. Massie": ["Richard Massie", 1800, 1887, "en"],
  "J. Kelly": ["John Kelly", 1833, 1890, "en"],
  "F. E. Cox": ["Frances Elizabeth Cox", 1812, 1897, "en"],
  "Frances E. Cox": ["Frances Elizabeth Cox", 1812, 1897, "en"],
  "E. Cronenwett": ["Emanuel Cronenwett", 1841, 1931, "en"],
  "E. Caswall": ["Edward Caswall", 1814, 1878, "en"],
  "J. M. Neale": ["John Mason Neale", 1818, 1866, "en"],
  "C. H. L. Schuette": ["Conrad Herman Louis Schuette", 1843, 1926, "en"],
  "J. A. Rimbach": ["John Adam Rimbach", 1871, 1941, "en"],
  "H. E. Jacobs": ["Henry Eyster Jacobs", 1844, 1932, "en"],
  "J. W. Alexander": ["James Waddel Alexander", 1804, 1859, "en"],
  "J. Chandler": ["John Chandler", 1806, 1876, "en"],
  "John Chandler": ["John Chandler", 1806, 1876, "en"],
  "Jane Borthwick": ["Jane Borthwick", 1813, 1897, "en"],
  "C. W. Schaeffer": ["Charles William Schaeffer", 1813, 1896, "en"],
  "C. T. Brooks": ["Charles Timothy Brooks", 1813, 1883, "en"],
  "Elizabeth R. Charles": ["Elizabeth Rundle Charles", 1828, 1896, "en"],
  "Genevieve M. Irons": ["Genevieve M. Irons", 1855, 1928, "en"],
  // English writers.
  "Isaac Watts": ["Isaac Watts", 1674, 1748, "en"],
  "Charles Wesley": ["Charles Wesley", 1707, 1788, "en"],
  "J. Wesley": ["John Wesley", 1703, 1791, "en"],
  "Samuel Wesley, Sr": ["Samuel Wesley", 1662, 1735, "en"],
  "James Montgomery": ["James Montgomery", 1771, 1854, "en"],
  "John Newton": ["John Newton", 1725, 1807, "en"],
  "H. Bonar": ["Horatius Bonar", 1808, 1889, "en"],
  "Thomas Kelly": ["Thomas Kelly", 1769, 1855, "en"],
  "Anne Steele": ["Anne Steele", 1717, 1778, "en"],
  "W. W. How": ["William Walsham How", 1823, 1897, "en"],
  "Philip Doddridge": ["Philip Doddridge", 1702, 1751, "en"],
  "C. Wordsworth": ["Christopher Wordsworth", 1807, 1885, "en"],
  "W. Cowper": ["William Cowper", 1731, 1800, "en"],
  "J. Fawcett": ["John Fawcett", 1740, 1817, "en"],
  "H. F. Lyte": ["Henry Francis Lyte", 1793, 1847, "en"],
  "W. C. Dix": ["William Chatterton Dix", 1837, 1898, "en"],
  "Reginald Heber": ["Reginald Heber", 1783, 1826, "en"],
  "Ray Palmer": ["Ray Palmer", 1808, 1887, "en"],
  "J. S. B. Monsell": ["John Samuel Bewley Monsell", 1811, 1875, "en"],
  "J. Keble": ["John Keble", 1792, 1866, "en"],
  "J. Ellerton": ["John Ellerton", 1826, 1893, "en"],
  "H. W. Baker": ["Henry Williams Baker", 1821, 1877, "en"],
  "F. R. Havergal": ["Frances Ridley Havergal", 1836, 1879, "en"],
  "Charlotte Elliott": ["Charlotte Elliott", 1789, 1871, "en"],
  "W. H. Bathhurst": ["William Hiley Bathurst", 1796, 1877, "en"],
  "W. B. Collyer": ["William Bengo Collyer", 1782, 1854, "en"],
  "W. A. Muehlenberg": ["William Augustus Muhlenberg", 1796, 1877, "en"],
  "Thomas Ken": ["Thomas Ken", 1637, 1711, "en"],
  "Joseph Hart": ["Joseph Hart", 1712, 1768, "en"],
  "J. Grigg": ["Joseph Grigg", 1720, 1768, "en"],
  "J. Cawood": ["John Cawood", 1775, 1852, "en"],
  "J. Addison": ["Joseph Addison", 1672, 1719, "en"],
  "H. U. Onderdonk": ["Henry Ustick Onderdonk", 1789, 1858, "en"],
  "H. Harbaugh": ["Henry Harbaugh", 1817, 1867, "en"],
  "H. Alford": ["Henry Alford", 1810, 1871, "en"],
  "G. W. Doane": ["George Washington Doane", 1799, 1859, "en"],
  "G. Thring": ["Godfrey Thring", 1823, 1903, "en"],
  "F. W. Faber": ["Frederick William Faber", 1814, 1863, "en"],
  "M. Bridges": ["Matthew Bridges", 1800, 1894, "en"],
  "B. Francis": ["Benjamin Francis", 1734, 1799, "en"],
  "Sabine Baring-Gould": ["Sabine Baring-Gould", 1834, 1924, "en"],
  "J. D. Carlyle": ["Joseph Dacre Carlyle", 1758, 1804, "en"],
  "W. Hammond": ["William Hammond", 1719, 1783, "en"],
  "E. Perronet": ["Edward Perronet", 1726, 1792, "en"],
  "S. J. Stone": ["Samuel John Stone", 1839, 1900, "en"],
  "S. F. Smith": ["Samuel Francis Smith", 1808, 1895, "en"],
  "Sarah F. Adams": ["Sarah Flower Adams", 1805, 1848, "en"],
  "T. Hastings": ["Thomas Hastings", 1784, 1872, "en"],
  "T. Dwight": ["Timothy Dwight", 1752, 1817, "en"],
  "Robert Grant": ["Robert Grant", 1779, 1838, "en"],
  "John Bowring": ["John Bowring", 1792, 1872, "en"],
  "J. Bowring": ["John Bowring", 1792, 1872, "en"],
  "James Edmeston": ["James Edmeston", 1791, 1867, "en"],
  "H. K. White": ["Henry Kirke White", 1785, 1806, "en"],
  "B. Beddome": ["Benjamin Beddome", 1717, 1795, "en"],
  "B. Barton": ["Bernard Barton", 1784, 1849, "en"],
  "A. M. Toplady": ["Augustus Montague Toplady", 1740, 1778, "en"],
  "Alexander Pope": ["Alexander Pope", 1688, 1744, "en"],
  "Joseph Scriven": ["Joseph Scriven", 1819, 1886, "en"],
  "Edward Mote": ["Edward Mote", 1797, 1874, "en"],
  "H. W. Longfellow": ["Henry Wadsworth Longfellow", 1807, 1882, "en"],
  "Phoebe Cary": ["Phoebe Cary", 1824, 1871, "en"],
  "N. L. Frothingham": ["Nathaniel Langdon Frothingham", 1793, 1870, "en"],
  "T. Moore": ["Thomas Moore", 1779, 1852, "en"],
  "Samuel Medley": ["Samuel Medley", 1738, 1799, "en"],
  "S. Medley": ["Samuel Medley", 1738, 1799, "en"],
  "A. L. (Aikin) Barbauld": ["Anna Laetitia Barbauld", 1743, 1825, "en"],
  "Richard Baxter": ["Richard Baxter", 1615, 1691, "en"],
  "H. Downton": ["Henry Downton", 1818, 1885, "en"],
  "H. Auber": ["Harriet Auber", 1773, 1862, "en"],
  "E. Osler": ["Edward Osler", 1798, 1863, "en"],
  "Edward Osler": ["Edward Osler", 1798, 1863, "en"],
  "E. H. Bickersteth": ["Edward Henry Bickersteth", 1825, 1906, "en"],
  "T. H. Gill": ["Thomas Hornblower Gill", 1819, 1906, "en"],
  "R. Mant": ["Richard Mant", 1776, 1848, "en"],
  "L. Tuttiett": ["Lawrence Tuttiett", 1825, 1897, "en"],
  "Jane E. Leeson": ["Jane Eliza Leeson", 1809, 1881, "en"],
  "Mary F. Maude": ["Mary Fawler Maude", 1819, 1913, "en"],
  "J. Anstice": ["Joseph Anstice", 1808, 1836, "en"],
  "C. Elven": ["Cornelius Elven", 1797, 1873, "en"],
  "T. Cotterill": ["Thomas Cotterill", 1779, 1823, "en"],
  "Thomas Cotterill": ["Thomas Cotterill", 1779, 1823, "en"],
  "Thomas Haweis": ["Thomas Haweis", 1734, 1820, "en"],
  "W. Crosswell": ["William Croswell", 1804, 1851, "en"],
  "W. B. Tappan": ["William Bingham Tappan", 1794, 1849, "en"],
  "Andrew Reed": ["Andrew Reed", 1787, 1862, "en"],
  "Ambrose Serle": ["Ambrose Serle", 1742, 1812, "en"],
  "Basil Wood": ["Basil Wood", 1760, 1831, "en"],
  "E. Cooper": ["Edward Cooper", 1770, 1833, "en"],
  "Margaret Mackay": ["Margaret Mackay", 1802, 1887, "en"],
  "O. Allen": ["Oswald Allen", 1816, 1878, "en"],
  "D. March": ["Daniel March", 1816, 1909, "en"],
  "G. Duffield": ["George Duffield Jr.", 1818, 1888, "en"],
  "G. W. Bethune": ["George Washington Bethune", 1805, 1862, "en"],
  "G. Phillimore": ["Greville Phillimore", 1821, 1884, "en"],
  "S. D. Phelps": ["Sylvanus Dryden Phelps", 1816, 1895, "en"],
  "C. S. Robinson": ["Charles Seymour Robinson", 1829, 1899, "en"],
  "E. A. Dayman": ["Edward Arthur Dayman", 1807, 1890, "en"],
  "F. Rous": ["Francis Rous", 1579, 1659, "en"],
  "William Cullen Bryant": ["William Cullen Bryant", 1794, 1878, "en"],
  "Dorothy F. Bloomfield": ["Dorothy F. Gurney", 1858, 1932, "en"],
  "Josiah Condor": ["Josiah Conder", 1789, 1855, "en"],
  "James Hamilton": ["James Hamilton", 1819, 1896, "en"],
  "J. Morison": ["John Morison", 1750, 1798, "en"],
  "Wm. Shrubsole": ["William Shrubsole", 1759, 1829, "en"],
  "Thomas Scott": ["Thomas Scott", 1705, 1775, "en"],
  // German writers.
  "Martin Luther": ["Martin Luther", 1483, 1546, "de"],
  "Paul Gerhardt": ["Paul Gerhardt", 1607, 1676, "de"],
  "P. Gerhardt": ["Paul Gerhardt", 1607, 1676, "de"],
  "J. Olearius": ["Johann Olearius", 1611, 1684, "de"],
  "J. G. Olearius": ["Johann Gottfried Olearius", 1635, 1711, "de"],
  "C. Freund": ["Cornelius Freund", 1535, 1591, "de"],
  "J. Stegmann": ["Josua Stegmann", 1588, 1632, "de"],
  "J. Steuerlein": ["Johann Steuerlein", 1546, 1613, "de"],
  "J. Heermann": ["Johann Heermann", 1585, 1647, "de"],
  "J. Rist": ["Johann Rist", 1607, 1667, "de"],
  "Nikolaus Herman": ["Nikolaus Herman", null, 1561, "de"],
  "N. Selnecker": ["Nikolaus Selnecker", 1530, 1592, "de"],
  "B. Schmolck": ["Benjamin Schmolck", 1672, 1737, "de"],
  "Martin Behm": ["Martin Behm", 1557, 1622, "de"],
  "J. Scheffler": ["Johann Scheffler", 1624, 1677, "de"],
  "J. Franck": ["Johann Franck", 1618, 1677, "de"],
  "W. C. Dessler": ["Wolfgang Christoph Dessler", 1660, 1722, "de"],
  "Paul Eber": ["Paul Eber", 1511, 1569, "de"],
  "L. Helmbold": ["Ludwig Helmbold", 1532, 1598, "de"],
  "J. Gesenius": ["Justus Gesenius", 1601, 1673, "de"],
  "C. Schneegass": ["Cyriacus Schneegass", 1546, 1597, "de"],
  "Ph. Nicolai": ["Philipp Nicolai", 1556, 1608, "de"],
  "P. Nicolai": ["Philipp Nicolai", 1556, 1608, "de"],
  "Martin Rinckart": ["Martin Rinckart", 1586, 1649, "de"],
  "S. Dach": ["Simon Dach", 1605, 1659, "de"],
  "J. Neander": ["Joachim Neander", 1650, 1680, "de"],
  "G. Weissel": ["Georg Weissel", 1590, 1635, "de"],
  "T. Clausnitzer": ["Tobias Clausnitzer", 1619, 1684, "de"],
  "J. J. Rambach": ["Johann Jakob Rambach", 1693, 1735, "de"],
  "Erdmann Neumeister": ["Erdmann Neumeister", 1671, 1756, "de"],
  "J. Mentzer": ["Johann Mentzer", 1658, 1734, "de"],
  "Samuel Rodigast": ["Samuel Rodigast", 1649, 1708, "de"],
  "Michael Schirmer": ["Michael Schirmer", 1606, 1673, "de"],
  "V. Herberger": ["Valerius Herberger", 1562, 1627, "de"],
  "Martin Moller": ["Martin Moller", 1547, 1606, "de"],
  "M. Schalling": ["Martin Schalling", 1532, 1608, "de"],
  "Paul Speratus": ["Paul Speratus", 1484, 1551, "de"],
  "Paul Fleming": ["Paul Fleming", 1609, 1640, "de"],
  "C. F. Gellert": ["Christian Fürchtegott Gellert", 1715, 1769, "de"],
  "G. W. Sacer": ["Gottfried Wilhelm Sacer", 1635, 1699, "de"],
  "E. C. Homburg": ["Ernst Christoph Homburg", 1605, 1681, "de"],
  "J. Mathesius": ["Johann Mathesius", 1504, 1565, "de"],
  "C. Keymann": ["Christian Keymann", 1607, 1662, "de"],
  "Chr. Keymann": ["Christian Keymann", 1607, 1662, "de"],
  "J. A. Rothe": ["Johann Andreas Rothe", 1688, 1758, "de"],
  "S. Franck": ["Salomo Franck", 1659, 1725, "de"],
  "Sal. Franck": ["Salomo Franck", 1659, 1725, "de"],
  "H. Held": ["Heinrich Held", 1620, 1659, "de"],
  "B. Ringwaldt": ["Bartholomäus Ringwaldt", 1530, 1599, "de"],
  "C. Titius": ["Christoph Titius", 1641, 1703, "de"],
  "Fr. Funcke": ["Friedrich Funcke", 1642, 1699, "de"],
  "J. J. Schuetz": ["Johann Jakob Schütz", 1640, 1690, "de"],
  "William, Duke of Saxe-Weimar": ["Wilhelm II, Duke of Saxe-Weimar", 1598, 1662, "de"],
  "L. v. Zinzendorf": ["Nicolaus Ludwig von Zinzendorf", 1700, 1760, "de"],
  "Sigmund von Birken": ["Sigmund von Birken", 1626, 1681, "de"],
  "S. v. Birken": ["Sigmund von Birken", 1626, 1681, "de"],
  "G. W. Molanus": ["Gerhard Wolter Molanus", 1633, 1722, "de"],
  "M. Rutilius": ["Martin Rutilius", 1550, 1618, "de"],
  "M. B. Landstad": ["Magnus Brostrup Landstad", 1802, 1880, "no"],
  "J. O. Wallin": ["Johan Olof Wallin", 1779, 1839, "sv"],
  // Latin writers.
  "Rhabanus Maurus": ["Rabanus Maurus", null, 856, "la"],
  "Bede": ["Bede", 673, 735, "la"],
  "Thomas Aquinas": ["Thomas Aquinas", 1225, 1274, "la"],
  "Bernard of Clairvaux": ["Bernard of Clairvaux", 1090, 1153, "la"],
};

/** The book's hymns: [{number, label, author, heading, verses}], `author` the whole attribution line. */
export function parseLutheran(text) {
  const all = String(text).replace(/\r/g, "").replace(/[ \t]*--[ \t]*/g, " — ").split("\n");
  const lines = all.slice(all.findIndex((l) => /\*\*\* START OF/.test(l)) + 1, all.findIndex((l) => /\*\*\* END OF/.test(l)));
  const hymns = [];
  let cur = null, stanza = null, expect = 1;
  const close = () => { if (cur && stanza && stanza.length) cur.verses.push(stanza); stanza = null; };
  const end = () => { close(); if (cur) hymns.push(cur); cur = null; };
  for (const raw of lines) {
    // The next hymn's number (the order of service before hymn 1 numbers nothing on a line of its own).
    const num = /^(\d{1,3})$/.exec(raw);
    if (num && Number(num[1]) === expect) { end(); expect++; cur = { number: Number(num[1]), label: "", author: "", heading: [], verses: [] }; continue; }
    if (!cur) continue;
    if (/^[A-Z][A-Z ,.'’&-]+\.?$/.test(raw)) { end(); continue; }        // a section title ("INVITATION."): the hymn has ended
    if (!raw.trim()) { if (stanza && stanza.length) close(); continue; }
    if (/^\s{10,}\S/.test(raw)) {                                          // indented past the verses: the metre, or who wrote it
      const t = raw.trim();
      if (!cur.label && !cur.verses.length && !stanza) cur.label = t;
      else { close(); cur.author = (cur.author ? `${cur.author} ` : "") + t; }
      continue;
    }
    const v = /^\s{2,8}(?:(\d+)\.\s+)?(\S.*)$/.exec(raw);
    // (The transcription marks italics as _word_; an underlay reads "_" as a held note.)
    if (v) { if (v[1]) close(); if (!stanza) stanza = []; stanza.push(v[2].replace(/_/g, "").trim()); }
  }
  end();
  return hymns;
}

/** The book's metre label as words-books' patternFor reads one ("C. M. 8 l" → "C. M. 8l.", "7, 6, 8 l" → "7 & 6s"). */
export function lutheranLabel(label) {
  const l = String(label).replace(/\s*\(.*\)\s*$/, "").trim();
  const lines = /(\d+)\s*l$/.exec(l)?.[1];
  const core = l.replace(/,?\s*\d+\s*l$/, "").trim();
  if (/^\d+(, \d+)+$/.test(core)) return { label: core.replace(/,\s*/g, ","), lines };   // every line given
  return { label: core.replace(/^(\d+), (\d+)$/, "$1 & $2s"), lines };
}

/**
 * Whom the hymn's attribution names, in full ({people}), or why it is left out ({why}). A part naming a translator ("C.
 * Winkworth, tr., 1862") is the translator; the rest are the writers. Writers in another language need a translator.
 */
export function creditLutheran(h) {
  if (!h.author) return { why: "the book names no one" };
  const parts = h.author.replace(/\.$/, "").split(/;\s*/);
  const people = [];
  let translated = false, needs = false;
  for (const part of parts) {
    const isTr = /,\s*tr\b/.test(part);
    const name = part.replace(/^Ps\. \d+\.\s*/, "").replace(/,\s*(tr\b|a\.|abr\b|alt\b|cento|v\. \d|st\. \d|c\. \d{4}|† ?\d{3,4}|before \d{4}|\d{4}).*$/, "").replace(/\.$/, "").trim();
    // "Anon": the book knows no writer; the words stand as Anonymous, as in our other books.
    if (/^Anon\b/.test(name) && parts.length === 1) { people.push({ name: "Anonymous", traditional: true, role: "Words" }); continue; }
    const known = NAMES[name];
    if (!known) return { why: `someone we cannot name in full: “${name || part}”` };
    const [full, born, died, lang] = known;
    if (isTr) { translated = true; people.push({ name: full, ...(born ? { born } : {}), died, role: "Translated" }); }
    else { if (lang !== "en") needs = true; people.push({ name: full, ...(born ? { born } : {}), died, role: "Words" }); }
  }
  if (needs && !translated) return { why: "a translation whose translator the book does not name" };
  if (!people.some((p) => p.role === "Words")) return { why: "the book names only the translator" };
  return { people };
}
