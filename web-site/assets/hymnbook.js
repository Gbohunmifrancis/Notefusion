/* "Is this Amazing Grace? Use the hymnbook version."
 *
 * When the worker recognises a hymn we hold in a transcription (result.hymnMatch), the published score is
 * exactly right where the transcription is a reading: notes, rhythm, bar lines, pickup and time signature.
 * The match carries that score already written in the key that was sung, so taking it is a swap of the
 * result, nothing more: this file decides when to ask and what the swapped result is. app.js draws the
 * prompt (as it draws "Which doh is it?") and saves the swapped sheet with the hymn's slug, so the saved
 * sheet keeps the hymn's credit. A "recognition only" match (kind "incipit") names the hymn and links to
 * it; it never offers a version. A famous piece that is not a hymn (`category` "piece": a classical theme, a
 * folk or children's song, a carol, an anthem) is offered the same way, as its published version. A tune many
 * hymns are sung to carries them (`settings`: slug, title, url, credit, first verse): "Which hymn is it?" takes the
 * words and the credit of the one picked, for a page whose words were not read.
 */
(function () {
  "use strict";

  /**
   * What to ask about `result`'s hymn match: "version" (a whole score to swap to), "name" (recognition
   * only: name and link it), or null. Never once answered, on a saved sheet, or on a sheet with parts
   * (the parts are written against the transcription's beats).
   */
  function ask(result, state) {
    var m = result && result.hymnMatch;
    var s = state || {};
    if (!m || s.savedId || s.hymnAnswered || result.parts || result.hymn) return null;
    if (m.kind === "score" && m.notes && m.notes.length && m.musicXml && m.key && m.timeSignature) return "version";
    if (m.kind === "incipit" && m.url) return "name";
    return null;
  }

  /** Whether the match is a famous piece rather than a hymn (it has no hymnbook; its version is the published one). */
  function isPiece(match) { return !!match && (match.category === "piece" || String(match.slug || "").indexOf("piece-") === 0); }

  /** "hymnbook version" or "published version": what the prompt and its buttons call the version on offer. */
  function noun(match) { return isPiece(match) ? "published version" : "hymnbook version"; }

  /** "Amazing Grace (hymnbook, 3/4)", "Für Elise (published, 3/8)": what the prompt calls the version on offer. */
  function label(match) {
    return match.title + (match.timeSignature ? " (" + (isPiece(match) ? "published" : "hymnbook") + ", " + match.timeSignature + ")" : "");
  }

  /**
   * The result as the hymnbook version: the hymn's notes, rhythm, time signature, score and solfa in the
   * key that was sung, at the pace it was sung. What was read against the transcription's own beats goes
   * (the chords, the backing track's alignment, the other dohs on offer); the hymn's credit comes with it.
   */
  /** The hymns sung to the matched tune that can be picked ([] when there are none). */
  function settings(match) { return (match && match.settings) || []; }

  /** The hymn of that list whose title is `text` (any case, spaces trimmed), or null. */
  function findSetting(match, text) {
    var t = String(text || "").trim().toLowerCase();
    if (!t) return null;
    return settings(match).filter(function (s) { return s.title.toLowerCase() === t; })[0] || null;
  }

  /** The version swapped in: the match's own notes, with `setting`'s words and credit when one was picked. */
  function swap(result, match, setting) {
    return Object.assign({}, result, {
      key: match.key,
      tempo: match.tempo || result.tempo,
      timeSignature: match.timeSignature,
      notes: match.notes.map(function (n) { return Object.assign({}, n); }),
      solfaLines: match.solfaLines || [],
      musicXml: match.musicXml,
      // Published notes, not a reading: nothing on the sheet is in doubt.
      overallConfidence: 1,
      chords: null,
      chordsSource: null,
      keyAlternatives: null,
      backingAudioBase64: "",
      hasBacking: false,
      beatOriginSec: 0,
      beatTimesSec: null,
      hymn: setting
        ? { slug: setting.slug, title: setting.title, url: setting.url, credit: setting.credit }
        : Object.assign({ slug: match.slug, title: match.title, url: match.url, credit: match.credit }, match.category ? { category: match.category } : {})
    });
  }

  /** The credit line under a hymnbook (or published) version's title. */
  function credit(hymn) {
    return (isPiece(hymn) ? "Published version of “" : "Hymnbook version of “") + hymn.title + "”. " + (hymn.credit || "");
  }

  window.NfHymnbook = { ask: ask, label: label, swap: swap, credit: credit, isPiece: isPiece, noun: noun, settings: settings, findSetting: findSetting };
})();
