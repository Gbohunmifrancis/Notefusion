/* "Beats in a bar": the meters a person may name before transcribing. Without one the worker writes
 * its own meter (4/4 today), so a 3/4 hymn came back barred in fours. The C# API accepts exactly these
 * (src/NoteFusion.Application/Transcriptions/Meters.cs) and the mobile app offers the same
 * (mobile/src/lib/meter.ts) — keep them in lock-step; web-site/tests/meter.test.mjs checks the API's list.
 * "Not sure" sends nothing.
 *
 * The choice is not remembered between songs: it belongs to the piece, not the person, and a 3/4 left
 * over from last week's hymn would silently bar this week's chorus in threes — worse than not asking.
 *
 * Plain script, no build step. Fills every <select data-meter> and exposes window.NfMeter.
 */
(function () {
  "use strict";

  var OPTIONS = [
    { value: "", label: "Not sure" },
    { value: "2/4", label: "2 (2/4)" },
    { value: "3/4", label: "3 (3/4 — waltz, many hymns)" },
    { value: "4/4", label: "4 (4/4 — most songs)" },
    { value: "6/8", label: "6 (6/8 — lilting)" }
  ];

  /** Puts the options in a select once, starting on Not sure. */
  function fill(select) {
    if (!select || select.options.length) return;
    OPTIONS.forEach(function (o) {
      var opt = select.ownerDocument.createElement("option");
      opt.value = o.value; opt.textContent = o.label;
      select.appendChild(opt);
    });
    select.value = "";
  }

  /** The meter to send ("3/4"), or null for Not sure or anything that is not on the list. */
  function chosen(select) {
    var v = select ? String(select.value || "") : "";
    for (var i = 1; i < OPTIONS.length; i++) if (OPTIONS[i].value === v) return v;
    return null;
  }

  /** The analytics name for a submission, so the console shows how often a meter is set and which. */
  function eventName(meter) { return "Beats in a bar: " + (meter || "Not sure"); }

  /** Back to Not sure, ready for the next song. */
  function reset(select) { if (select) select.value = ""; }

  var api = { OPTIONS: OPTIONS, fill: fill, chosen: chosen, eventName: eventName, reset: reset };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined" && window.document) {
    window.NfMeter = api;
    Array.prototype.forEach.call(window.document.querySelectorAll("select[data-meter]"), fill);
  }
})();
