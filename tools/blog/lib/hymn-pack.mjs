// web-site/hymns/pack.json: every published hymn and tune page as one download, for the app's Hymns
// screen to work offline (mobile/src/lib/hymnPack.ts reads it), and web-site/hymns/pack-version.json, the
// few bytes the app reads weekly to learn whether its copy is current.
//
// Per entry it carries what the app's sheet view needs and nothing it can derive: the melody as
// [MIDI pitch, start beat, length in beats] in quarter-note beats with any pickup at the end of the
// first bar (exactly as the worker's hymn index and the hymn page hold it), the key, meter, tempo and
// pickup, the first verse's syllables under the notes, every verse's words, the page's credit line, and the
// occasions the hymn or tune page names (content/hymns `occasions`: ["Christmas"] is the app's carols shelf,
// ["Halloween"] its Halloween one), when it names any.
// The app labels the solfa itself (lib/solfa.ts, the engine's mirror), so the pack never goes stale
// against a solfa rule.
//
// `version` is a hash of the content, so it changes exactly when a hymn does; the build is
// deterministic, and `node check.mjs` fails CI when the committed pack is stale like every other page.
import crypto from "node:crypto";
import { ORIGIN } from "./site.mjs";

export const PACK_PATH = "hymns/pack.json";
export const PACK_VERSION_PATH = "hymns/pack-version.json";
/** Bumped only when the shape changes in a way an older app cannot read. */
export const PACK_FORMAT = 1;

const round = (x) => Math.round(x * 1000) / 1000;
/** Titles sort by their first letter, not by a leading quote mark. */
const sortKey = (title) => title.replace(/^[^\p{L}\p{N}]+/u, "");
const notesOf = (parsed) => parsed.notes.map((n) => [n.pitchMidi, round(n.startBeat), round(n.durBeats)]);

/** A published hymn (after prepareHymn). */
function hymnEntry(h) {
  const t = h.tuneData;
  return {
    slug: h.slug,
    kind: "hymn",
    title: h.title,
    firstLine: h.verses[0].lines[0],
    tune: t.name,
    key: t.key,
    time: String(t.time),
    tempo: t.tempo,
    pickup: t.pickup || 0,
    credit: h.view.credit.text,
    url: `${ORIGIN}/hymns/${h.slug}`,
    // The seasons it is listed for (["Christmas"] puts it on the app's carols shelf); left out when it names none.
    ...(h.occasions?.length ? { occasions: h.occasions } : {}),
    notes: notesOf(t.parsed),
    words: h.underlay || "",
    verses: h.verses.map((v) => (v.label ? { label: v.label, lines: v.lines } : { lines: v.lines })),
  };
}

/** A published tune page (after prepareTune): a tune without words. */
function tuneEntry(t) {
  return {
    slug: `tune-${t.slug}`,
    kind: "tune",
    title: t.view.title,
    firstLine: "",
    tune: t.name,
    key: t.key,
    time: String(t.time),
    tempo: t.tempo,
    pickup: t.pickup || 0,
    credit: t.view.credit.text,
    url: ORIGIN + t.view.url,
    // A tune page's occasions (["Halloween"] puts it on the app's Halloween shelf); left out when it names none.
    ...(t.occasions?.length ? { occasions: t.occasions } : {}),
    notes: notesOf(t.parsed),
    words: "",
    verses: [],
  };
}

/** Both files' text: { pack, version } — the pack, and the small file that names its version and size. */
export function hymnPackFiles(hymns, tunes = []) {
  const entries = [...hymns.filter((h) => !h.draft).map(hymnEntry), ...tunes.filter((t) => !t.draft).map(tuneEntry)]
    .sort((a, b) => sortKey(a.title).localeCompare(sortKey(b.title)) || a.slug.localeCompare(b.slug));
  const slugs = new Set();
  for (const e of entries) {
    if (slugs.has(e.slug)) throw new Error(`hymn pack: two entries are called "${e.slug}"`);
    slugs.add(e.slug);
  }
  const body = entries.map((e) => JSON.stringify(e)).join(",\n");
  const version = crypto.createHash("sha256").update(`${PACK_FORMAT}\n${body}`).digest("hex").slice(0, 12);
  const hymnCount = entries.filter((e) => e.kind === "hymn").length;
  // One entry a line, so a change to one hymn is a one-line diff.
  const pack = `{"format": ${PACK_FORMAT}, "version": "${version}", "count": ${entries.length}, "hymnCount": ${hymnCount},\n"hymns": [\n${body}\n]}\n`;
  const meta = { format: PACK_FORMAT, version, count: entries.length, hymnCount, bytes: Buffer.byteLength(pack, "utf8"), url: `${ORIGIN}/${PACK_PATH}` };
  return { pack, version: JSON.stringify(meta) + "\n" };
}

/** Problems with a written pack and its version file (check.mjs): empty means it is sound. */
export function packErrors(packText, versionText) {
  const errors = [];
  let pack, meta;
  try { pack = JSON.parse(packText); } catch (e) { return [`${PACK_PATH} is not valid JSON (${e.message})`]; }
  try { meta = JSON.parse(versionText); } catch (e) { return [`${PACK_VERSION_PATH} is not valid JSON (${e.message})`]; }
  if (pack.format !== PACK_FORMAT || meta.format !== PACK_FORMAT) errors.push(`hymn pack: format is not ${PACK_FORMAT}`);
  if (pack.version !== meta.version) errors.push(`hymn pack: ${PACK_VERSION_PATH} names version ${meta.version}, the pack is ${pack.version}`);
  if (meta.bytes !== Buffer.byteLength(packText, "utf8")) errors.push(`hymn pack: ${PACK_VERSION_PATH} says ${meta.bytes} bytes, the pack is ${Buffer.byteLength(packText, "utf8")}`);
  if (!Array.isArray(pack.hymns) || pack.hymns.length !== pack.count || meta.count !== pack.count) errors.push("hymn pack: the count does not match the entries");
  for (const h of pack.hymns || []) {
    for (const k of ["slug", "title", "key", "time", "credit", "url"]) if (typeof h[k] !== "string" || !h[k]) errors.push(`hymn pack: ${h.slug || "?"} has no ${k}`);
    if (!Array.isArray(h.notes) || h.notes.length === 0 || !h.notes.every((n) => Array.isArray(n) && n.length === 3 && n.every(Number.isFinite))) errors.push(`hymn pack: ${h.slug} has no readable notes`);
    if (h.kind === "hymn" && (!h.verses?.length || !h.firstLine)) errors.push(`hymn pack: ${h.slug} has no words`);
    if (h.occasions != null && (!Array.isArray(h.occasions) || !h.occasions.length || !h.occasions.every((o) => typeof o === "string" && o))) errors.push(`hymn pack: ${h.slug} has unreadable occasions`);
  }
  return errors;
}
