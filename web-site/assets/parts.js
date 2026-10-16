/* The four parts on the result view: what the "Four parts" action does, and which voices play.
 *
 * The action opens the "Write the four parts" pop-up while the sheet has no parts, and goes straight
 * to the parts once it has them (written, saved with the sheet, or heard from a choir), so it is
 * never a dead end. The mix is which of soprano, alto, tenor and bass the player sounds: each voice
 * can be muted, or soloed (heard alone), so a singer can drop their own part and sing it against the
 * others. Plain functions over plain objects; app.js draws the buttons and drives the player.
 */
(function () {
  "use strict";

  /** True when the result carries at least one voice with notes (an empty object is not parts). */
  function hasParts(result) {
    var parts = result && result.parts;
    if (!parts || typeof parts !== "object") return false;
    return Object.keys(parts).some(function (k) { return parts[k] && parts[k].notes && parts[k].notes.length; });
  }

  /** What the "Four parts" action does for this sheet: "show" the parts it has, or "write" them. */
  function action(result) { return hasParts(result) ? "show" : "write"; }

  /** Every voice on: {soprano: true, alto: true, …}. */
  function mixFor(names) {
    var mix = {};
    (names || []).forEach(function (n) { mix[n] = true; });
    return mix;
  }

  /** The voice heard alone, when exactly one of several is on; null otherwise. */
  function soloed(mix) {
    var names = Object.keys(mix || {});
    var on = names.filter(function (n) { return mix[n]; });
    return names.length > 1 && on.length === 1 ? on[0] : null;
  }

  /** Mute or unmute one voice. Muting the last one sounding brings every voice back rather than silence. */
  function toggle(mix, name) {
    var next = Object.assign({}, mix);
    next[name] = !next[name];
    var anyOn = Object.keys(next).some(function (n) { return next[n]; });
    return anyOn ? next : mixFor(Object.keys(next));
  }

  /** Hear one voice alone; asking again for the voice already alone brings every voice back. */
  function solo(mix, name) {
    var names = Object.keys(mix || {});
    if (soloed(mix) === name) return mixFor(names);
    var next = {};
    names.forEach(function (n) { next[n] = n === name; });
    return next;
  }

  window.NfParts = { hasParts: hasParts, action: action, mixFor: mixFor, soloed: soloed, toggle: toggle, solo: solo };
})();
