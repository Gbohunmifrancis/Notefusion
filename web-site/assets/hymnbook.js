/* "Is this Amazing Grace? Use the hymnbook version."
 *
 * When the worker recognises a hymn we hold in a transcription (result.hymnMatch), the published score is
 * exactly right where the transcription is a reading: notes, rhythm, bar lines, pickup and time signature.
 * The match carries that score already written in the key that was sung, so taking it is a swap of the
 * result, nothing more: this file decides when to ask and what the swapped result is. app.js draws the
 * prompt (as it draws "Which doh is it?") and saves the swapped sheet with the hymn's slug, so the saved
 * sheet keeps the hymn's credit. A "recognition only" match (kind "incipit") names the hymn and links to
 * it; it never offers a version.
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

  /** "Amazing Grace (hymnbook, 3/4)": what the prompt calls the version on offer. */
  function label(match) {
    return match.title + (match.timeSignature ? " (hymnbook, " + match.timeSignature + ")" : "");
  }

  /**
   * The result as the hymnbook version: the hymn's notes, rhythm, time signature, score and solfa in the
   * key that was sung, at the pace it was sung. What was read against the transcription's own beats goes
   * (the chords, the backing track's alignment, the other dohs on offer); the hymn's credit comes with it.
   */
  function swap(result, match) {
    return Object.assign({}, result, {
      key: match.key,
      tempo: match.tempo || result.tempo,
      timeSignature: match.timeSignature,
      notes: match.notes.map(function (n) { return Object.assign({}, n); }),
      solfaLines: match.solfaLines || [],
      musicXml: match.musicXml,
      chords: null,
      chordsSource: null,
      keyAlternatives: null,
      backingAudioBase64: "",
      beatOriginSec: 0,
      hymn: { slug: match.slug, title: match.title, url: match.url, credit: match.credit }
    });
  }

  /** The credit line under a hymnbook version's title. */
  function credit(hymn) {
    return "Hymnbook version of “" + hymn.title + "”. " + (hymn.credit || "");
  }

  window.NfHymnbook = { ask: ask, label: label, swap: swap, credit: credit };
})();
