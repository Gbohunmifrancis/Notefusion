// Reads one tune page of the Christian Classics Ethereal Hymnary (https://www.ccel.org/cceh/NNNN/xNNNNNN.htm):
// the tune's name, metre, incipits, the people and books it credits, its other names, its notes and its
// files. The page is data: it is read as text here, never rendered or run.

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", copy: "©", eacute: "é", egrave: "è", ecirc: "ê", euml: "ë", aacute: "á", agrave: "à", acirc: "â", auml: "ä", oacute: "ó", ouml: "ö", ocirc: "ô", uuml: "ü", uacute: "ú", iacute: "í", iuml: "ï", ccedil: "ç", ntilde: "ñ", szlig: "ß", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", Eacute: "É", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", aring: "å", oslash: "ø", aelig: "æ" };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
}
const text = (html) => decodeEntities(String(html).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

/** The page's <dl> as [{label, items: [{html, text}]}], in order. */
function sections(html) {
  const dl = (/<dl>([\s\S]*?)<\/dl>/i.exec(html) || [])[1] || "";
  const out = [];
  for (const m of dl.matchAll(/<(dt|dd)>([\s\S]*?)(?=<dt>|<dd>|$)/gi)) {
    const body = m[2].replace(/<\/d[td]>\s*$/i, "");
    if (m[1].toLowerCase() === "dt") out.push({ label: text(body).replace(/:$/, ""), items: [] });
    else if (out.length) out[out.length - 1].items.push({ html: body, text: text(body) });
  }
  return out;
}

/** "8,7,8,7+4,4,7" → "8 7 8 7 + 4 4 7"; "i" → "Irregular"; "C.M." etc. kept. */
export function metreText(m) {
  const s = String(m || "").trim();
  if (!s) return null;
  if (/^i(rr(egular)?)?\.?$/i.test(s)) return "Irregular";
  return s.replace(/\s*\+\s*/g, " + ").replace(/\s*,\s*/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * One line of the page's Author section as a credit: {role, name, book, year, born, died, copyright, raw}.
 *   "John Bacchus Dykes, 1861"                   → {name, year: 1861}
 *   "arr. for tenor lead, John Dowland, 1562-1626" → {role: "arr. for tenor lead", name, born: 1562, died: 1626}
 *   "<i>Genevan Psalter</i>, 1551"               → {book: "Genevan Psalter", year: 1551}
 *   "Mark Andrews, &copy;1931"                    → {name, year: 1931, copyright: true}
 *   "Traditional"                                → {traditional: true, name: "Traditional"}
 * Years are read only as the page writes them; nothing is looked up here.
 */
export function parseCredit(item) {
  const raw = item.text;
  const out = { raw };
  if (/©|\(c\)|copyright/i.test(raw)) out.copyright = true;
  let parts = raw.split(/\s*,\s*/).filter(Boolean);
  // A leading role: "arr.", "harm.", "attr. to", "arr. for tenor lead", "rec.", "adapt.", "alt.", "from".
  if (parts.length > 1 && /^(arr|harm|attr|adapt|alt|rec|desc|melody|tune|music|setting|from|by|after|based|transcr|ed|coll|comp|vers|para|desc)\b[^,]*$/i.test(parts[0]) && /^[a-z]/.test(parts[0])) {
    out.role = parts[0];
    parts = parts.slice(1);
  }
  // A trailing date: "1861", "1562-1626", "©1931", "c. 1600", "1840?", "(1823-1876)", "fl. 1750".
  const last = parts[parts.length - 1] || "";
  const dates = /^(?:©\s*)?(?:(c\.|ca\.|circa|fl\.)\s*)?(\d{3,4})(?:\s*[-–]\s*(\d{3,4})?)?\??$/i.exec(last.replace(/[()]/g, "").trim());
  if (dates && parts.length >= 1) {
    parts = parts.slice(0, -1);
    if (dates[3]) { out.born = Number(dates[2]); out.died = Number(dates[3]); }
    else if (/-|–/.test(last) && !dates[3]) { out.born = Number(dates[2]); out.living = true; }
    else { out.year = Number(dates[2]); if (dates[1]) out.circa = true; }
  }
  // An italic title is a book (a psalter, a hymnal, a song collection): an anonymous source.
  const book = /<i>([\s\S]*?)<\/i>/i.exec(item.html);
  if (book) {
    out.book = text(book[1]);
    out.place = parts.filter((p) => p !== out.book && !p.includes(out.book)).join(", ") || undefined;
    if (!out.place) delete out.place;
  } else {
    const name = parts.join(", ").trim();
    if (name) out.name = name.replace(/\s*\(([^)]*)\)\s*$/, (m, alias) => (/\d/.test(alias) ? "" : m)).trim();
  }
  if (out.name && /^(traditional|anonymous|unknown|trad\.?)\b/i.test(out.name)) out.traditional = true;
  if (out.name && /^(traditional|old|ancient|medieval|plainsong|folk|(old )?(english|irish|welsh|scottish|german|french|dutch|swedish|norwegian|danish|finnish|american|spanish|italian|russian|polish|czech|bohemian|silesian|hebrew|greek|basque|cornish|manx|flemish|negro|african|catalan|latvian|appalachian)\b)/i.test(out.name) && !/,/.test(out.name)) out.traditional = true;
  return out;
}

/** Everything the importer reads off a tune page. */
export function parseTunePage(html) {
  const title = text((/<td align="right"><h2>([\s\S]*?)<\/h2>/i.exec(html) || [])[1] || "");
  const number = ((/<h2>\s*Tune:\s*(\d+)\s*<\/h2>/i.exec(html) || [])[1]) || null;
  const secs = sections(html);
  const get = (label) => secs.find((s) => s.label.toLowerCase() === label.toLowerCase());
  const meter = get("Meter");
  const inc = get("Incipit");
  const doremi = inc && inc.items.find((i) => /do-re-mi/i.test(i.text));
  const oxford = inc && inc.items.find((i) => /oxford/i.test(i.text));
  const code = (it) => (it ? text((/<code>([\s\S]*?)<\/code>/i.exec(it.html) || [])[1] || "") : null);
  const author = get("Author");
  const other = get("Other Names");
  const notes = get("Notes");
  const music = get("Music");
  const files = (music ? music.items : []).flatMap((it) => [...it.html.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({
    label: text(it.html.slice(0, it.html.indexOf(m[0]))),
    href: m[1],
    kind: /\.mid$/i.test(m[1]) ? "midi" : /\.nwc$/i.test(m[1]) ? "nwc" : /\.pdf$/i.test(m[1]) ? "pdf" : "other",
  })));
  return {
    number,
    title,
    metre: meter && meter.items[0] ? metreText(meter.items[0].text) : null,
    incipit: { doremi: code(doremi) || null, oxford: code(oxford) || null },
    credits: (author ? author.items : []).map(parseCredit),
    otherNames: other ? other.items.flatMap((i) => i.text.split(/\s*;\s*/)).map((s) => s.trim()).filter(Boolean) : [],
    notes: notes ? notes.items.map((i) => i.text).join(" ") : "",
    files,
    labels: secs.map((s) => s.label),
  };
}
