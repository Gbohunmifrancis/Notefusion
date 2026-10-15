/* What a sheet's overall confidence means to the person reading it.
 *
 * The number itself (the model's margin over its runner-up, weighed by note length) is for the admin
 * console: on a sheet, "52%" reads as a grade on the singer and says nothing about what to do. So the
 * web app shows a plain note, and only when there is something to do. The thresholds live here and
 * nowhere else in this client; the mobile app keeps its own in src/lib/confidence.ts.
 */
(function () {
  "use strict";

  /** At or above `clear`: nothing to say. Below `hard`: the recording was hard to hear. */
  var THRESHOLDS = { clear: 0.75, hard: 0.5 };

  /**
   * The note for a sheet whose overall confidence is `conf` (0..1), or null when it needs none.
   * `highlighted` says whether the page marks the doubtful notes, so the note can point at them.
   */
  function note(conf, highlighted) {
    var c = typeof conf === "number" && isFinite(conf) ? conf : 0;
    if (c >= THRESHOLDS.clear) return null;
    if (c >= THRESHOLDS.hard) return highlighted ? "Check the highlighted notes." : "Some notes may need a check.";
    return "This recording was hard to hear — listen back and correct any notes.";
  }

  window.NfConfidence = { THRESHOLDS: THRESHOLDS, note: note };
})();
