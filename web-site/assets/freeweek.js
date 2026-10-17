/* A free account's weekly transcriptions: how many are left and when they come back.
 *
 * Free accounts get 3 hummed or recorded transcriptions a week; the week turns every Friday at 18:00
 * West Africa Time for everyone (FreeTier in the API). The API sends the moment as `freeResetsAtUtc`;
 * this shows it in the reader's own time ("Friday 6pm"). The mobile app keeps its own copy in
 * src/lib/freeWeek.ts.
 */
(function () {
  "use strict";

  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  /** What to say when the API did not send the moment (an older API): the rule itself. */
  var FALLBACK = "Friday 6pm (West Africa Time)";

  /** "6pm", "6:30pm", "12am": short, and the same whatever the browser's language. */
  function clock(d) {
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + (m ? ":" + String(m).padStart(2, "0") : "") + (h < 12 ? "am" : "pm");
  }

  /** When the free ones come back, in the reader's time: "Friday 6pm". */
  function when(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return FALLBACK;
    return DAYS[d.getDay()] + " " + clock(d);
  }

  /**
   * This week's free ones for a free account, from the subscription the API returned: { left, total, back }.
   * An API from before the weekly fields only sent the totals with bought ones folded in; those are taken
   * apart again so the numbers still read right.
   */
  function free(sub) {
    if (!sub) return null;
    var total = sub.freeTranscriptionsPerWeek, left = sub.freeTranscriptionsRemaining;
    if (typeof total !== "number" || total <= 0) {
      total = Math.max(0, (sub.trialGenerationsTotal || 0) - (sub.boughtTranscriptionsTotal || 0));
      left = Math.max(0, (sub.trialGenerationsRemaining || 0) - (sub.boughtTranscriptionsRemaining || 0));
    }
    return { left: Math.max(0, left || 0), total: total, back: when(sub.freeResetsAtUtc) };
  }

  window.NfFreeWeek = { when: when, free: free, FALLBACK: FALLBACK };
})();
