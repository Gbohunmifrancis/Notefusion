/* "Make the second m an f": a correction to a sheet, typed in plain words.
 *
 * A fixed set of phrasings, read here in the browser (nothing is sent anywhere, and the same words always do the
 * same thing):
 *   make the second m an f · change note 5 to s · the last d should be r · replace the third s with l
 *   change every t to ta · the first m in bar 3 to f · make the m in bar 2 a d'
 *   move the last d up an octave · lower note 4 by a semitone · raise the second s two semitones
 *   delete note 6 · remove the third m
 * A note is named by its syllable as the sheet writes it (d r m f s l t and the chromatics de ra re ma fe sa se
 * la le ta; doh ray me fah soh lah te too), optionally with its octave marks (s, d'), by its count ("the second
 * m", "the last d", "every t") or by its place ("note 5", "the last note"), and narrowed to a bar ("in bar 3",
 * "in the pickup": bars are counted as the staff numbers them, from the first full bar).
 * A new syllable lands in the octave nearest the old note unless octave marks say where.
 *
 * read() says what was asked or why it could not be followed; apply() makes the change to the notes and says
 * what it did. Plain script, no build step. Labels with window.NfChoir (choir.js). Exposes window.NfSheetEdit.
 */
(function () {
  "use strict";

  // Semitones above doh of every syllable the engine writes (choir.js ASC/DESC).
  var SEMIS = { d: 0, de: 1, ra: 1, r: 2, re: 3, ma: 3, m: 4, f: 5, fe: 6, sa: 6, s: 7, se: 8, la: 8, l: 9, le: 10, ta: 10, t: 11 };
  // Whole names. "la" and "re" are not among them: in tonic solfa they are the chromatics (flat lah, sharp ray).
  var NAMES = { doh: "d", do: "d", ray: "r", me: "m", mi: "m", fah: "f", fa: "f", soh: "s", sol: "s", so: "s", lah: "l", te: "t", ti: "t" };
  var ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
    eleventh: 11, twelfth: 12, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  var COUNTS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eleven: 11, twelve: 12 };
  var EXAMPLE = "Try “make the second m an f”, “change note 5 to s” or “move the last d up an octave”.";

  /** A syllable token ("m", "s,", "d'", "doh", "m's") as {syl, marks}, or null. */
  function syllableOf(token, plural) {
    var t = token;
    if (plural) t = t.replace(/'s$/, "");
    var m = /^([a-z]+)(['’,]*)$/.exec(t);
    if (!m) return null;
    var syl = SEMIS[m[1]] !== undefined ? m[1] : NAMES[m[1]];
    return syl ? { syl: syl, marks: m[2] ? m[2].replace(/’/g, "'") : null } : null;
  }
  /** "second", "2nd", "2" as 2; "last" as -1; null otherwise. */
  function ordinalOf(token) {
    if (token === "last") return -1;
    if (ORDINALS[token]) return ORDINALS[token];
    var m = /^(\d+)(st|nd|rd|th)?$/.exec(token);
    return m ? Number(m[1]) : null;
  }
  function countOf(token) {
    if (COUNTS[token]) return COUNTS[token];
    return /^\d+$/.test(token) ? Number(token) : null;
  }

  function tokens(text) {
    var s = String(text || "").toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”"]/g, " ")
      .replace(/\b(please|can you|could you|i want to|i'd like to)\b/g, " ")
      .replace(/[.!?;:]+(\s|$)/g, " ").replace(/,(\s+(?=[a-z]{2,}))/g, "$1").trim();
    return s ? s.split(/\s+/) : [];
  }

  /** The target at tokens[i]: a note by place, by syllable and count, or every one of a syllable; then "in bar N". */
  function readTarget(tok, i) {
    var target = null;
    if (tok[i] === "the") i++;
    if (tok[i] === "every" || tok[i] === "all") {
      i++;
      if (tok[i] === "the") i++;
      var every = tok[i] && syllableOf(tok[i], true);
      if (!every) return null;
      target = { every: true, syl: every.syl, marks: every.marks };
      i++;
    } else if (tok[i] === "note" && countOf(tok[i + 1] || "") !== null) {
      target = { place: countOf(tok[i + 1]) };
      i += 2;
    } else {
      var nth = tok[i] !== undefined ? ordinalOf(tok[i]) : null;
      if (nth !== null) i++;
      if (nth !== null && (tok[i] === "to" && tok[i + 1] === "last")) { nth = -2; i += 2; }
      if (tok[i] === "note") { target = { place: nth === null ? 1 : nth }; i++; }
      else {
        var one = tok[i] && syllableOf(tok[i], false);
        if (!one) return null;
        target = { syl: one.syl, marks: one.marks, nth: nth };
        i++;
      }
    }
    if (tok[i] === "in") {
      var j = i + 1;
      if (tok[j] === "the") j++;
      var bar = null;
      if (tok[j] === "pickup" || tok[j] === "upbeat" || tok[j] === "anacrusis") { bar = 0; j += 1; }
      else if (tok[j] === "bar" && tok[j + 1] && countOf(tok[j + 1]) !== null) { bar = countOf(tok[j + 1]); j += 2; }
      else if (tok[j] && ordinalOf(tok[j]) > 0 && tok[j + 1] === "bar") { bar = ordinalOf(tok[j]); j += 2; }
      if (bar !== null) { target.bar = bar; i = j; }
    }
    return { target: target, i: i };
  }

  /** "up an octave", "by a semitone", "two semitones down", "an octave higher": signed semitones, or null. */
  function readShift(tok, i, sign) {
    var dir = sign || 0, amount = null, unit = null;
    for (; i < tok.length; i++) {
      var w = tok[i];
      if (w === "up" || w === "higher") dir = 1;
      else if (w === "down" || w === "lower") dir = -1;
      else if (w === "by") continue;
      else if (countOf(w) !== null && amount === null) amount = countOf(w);
      else if (/^octaves?$/.test(w)) unit = 12;
      else if (/^semitones?$/.test(w) || w === "half-step" || w === "half-steps") unit = 1;
      else if (w === "half" && /^steps?$/.test(tok[i + 1] || "")) { unit = 1; i++; }
      else return null;
    }
    if (!dir || !unit) return null;
    return dir * (amount === null ? 1 : amount) * unit;
  }

  /** The syllable after "to", "into", "a", "an", "be", "with", or null. */
  function readSyllable(tok, i) {
    while (i < tok.length && /^(to|into|a|an|be|is|really|should|with|it|instead)$/.test(tok[i])) i++;
    if (i !== tok.length - 1) return null;
    return syllableOf(tok[i], false);
  }

  /**
   * What `text` asks for, as {ok: true, target, change} where change is {to: {syl, marks}}, {shift: semitones} or
   * {remove: true}; or {ok: false, error} in a sentence that says how to put it.
   */
  function read(text) {
    var tok = tokens(text);
    if (!tok.length) return { ok: false, error: "Type a change to make. " + EXAMPLE };
    var verb = tok[0], i = 1, sign = 0;
    if (/^(make|turn|change|replace|move|put|take|raise|lower|delete|remove|drop|set)$/.test(verb)) {
      if (verb === "raise") sign = 1;
      if (verb === "lower") sign = -1;
    } else { verb = ""; i = 0; }
    var found = readTarget(tok, i);
    if (!found) return { ok: false, error: "I couldn't tell which note you mean. " + EXAMPLE };
    var rest = found.i, change = null;
    if (/^(delete|remove|drop)$/.test(verb)) {
      if (rest === tok.length) change = { remove: true };
    } else {
      var shift = readShift(tok, rest, sign);
      if (shift !== null) change = { shift: shift };
      else if (!sign) {
        var to = readSyllable(tok, rest);
        if (to && (verb || /^(to|should|is|into)$/.test(tok[rest] || ""))) change = { to: to };
      }
    }
    if (!change) return { ok: false, error: "I couldn't tell what to change it to. " + EXAMPLE };
    return { ok: true, target: found.target, change: change };
  }

  function beatsPerBar(ts) { var p = String(ts || "4/4").split("/").map(Number); return p[0] && p[1] ? (p[0] * 4) / p[1] : 4; }
  /**
   * Bars counted as the staff numbers them: a first bar the tune enters part-way through is the pickup (bar 0),
   * and bar 1 is the first full one, as a hymn book counts.
   */
  function barCounter(notes, perBar) {
    var first = notes.reduce(function (m, n) { return Math.min(m, n.startBeat); }, Infinity);
    var base = Math.floor(first / perBar + 1e-9), pickup = first - base * perBar > 1e-9;
    return function (note) { return Math.floor(note.startBeat / perBar + 1e-9) - base + (pickup ? 0 : 1); };
  }
  function nameOf(note) { return note.solfa + (note.octaveMark || ""); }
  function plural(syl) { return syl + "’s"; }
  function marksShift(marks) {
    if (!marks) return 0;
    var up = (marks.match(/'/g) || []).length, down = (marks.match(/,/g) || []).length;
    return up - down;
  }

  /** The indices (into `notes`) the target names, in order, or an error sentence. */
  function resolve(notes, target, barOf) {
    var order = notes.map(function (_, k) { return k; }).sort(function (a, b) { return notes[a].startBeat - notes[b].startBeat; });
    var where = target.bar === undefined ? "" : target.bar === 0 ? " in the pickup" : " in bar " + target.bar;
    if (target.bar !== undefined) {
      order = order.filter(function (k) { return barOf(notes[k]) === target.bar; });
      if (!order.length) return { error: "There are no notes" + where + "." };
    }
    if (target.place !== undefined) {
      var at = target.place < 0 ? order.length + target.place : target.place - 1;
      if (at < 0 || at >= order.length) return { error: "There " + (order.length === 1 ? "is only 1 note" : "are only " + order.length + " notes") + where + "." };
      return { picked: [order[at]] };
    }
    var matches = order.filter(function (k) {
      var n = notes[k];
      return n.solfa === target.syl && (target.marks === null || (n.octaveMark || "") === target.marks);
    });
    var name = target.syl + (target.marks || "");
    if (!matches.length) return { error: "There's no " + name + where + " on this sheet." };
    if (target.every) return { picked: matches };
    if (target.nth === null) {
      if (matches.length > 1) return { error: "There are " + matches.length + " " + plural(name) + where + ". Say which one, like “the second " + name + "”." };
      return { picked: matches };
    }
    var idx = target.nth < 0 ? matches.length + target.nth : target.nth - 1;
    if (idx < 0 || idx >= matches.length) return { error: "There " + (matches.length === 1 ? "is only 1 " + name : "are only " + matches.length + " " + plural(name)) + where + "." };
    return { picked: [matches[idx]] };
  }

  /** The new pitch of `note` written as `to` in `keyText`: its nearest octave, or where `to`'s marks put it. */
  function pitchFor(note, to, dohPc) {
    var old = (((note.pitchMidi - dohPc) % 12) + 12) % 12, want = SEMIS[to.syl];
    if (to.marks !== null) {
      // The unmarked doh this note was written from, then the new syllable as many octaves off it as its marks say.
      var unmarkedDoh = note.pitchMidi - old - 12 * marksShift(note.octaveMark);
      return unmarkedDoh + want + 12 * marksShift(to.marks);
    }
    var step = (((want - old) % 12) + 12) % 12;
    return note.pitchMidi + (step > 6 ? step - 12 : step);
  }

  /** "note 5 (bar 2" — closed by the caller, which adds the syllable or not. */
  function describe(note, barOf, notes) {
    var order = notes.map(function (_, k) { return k; }).sort(function (a, b) { return notes[a].startBeat - notes[b].startBeat; });
    var bar = barOf(note);
    return "note " + (order.indexOf(notes.indexOf(note)) + 1) + " (" + (bar === 0 ? "the pickup" : "bar " + bar);
  }

  /**
   * `request` (from read) made on `notes` (labelled, as the result carries them) in `keyText`/`timeSignature`:
   * {notes, said, from} with the notes relabelled and `from[i]` the index in `notes` of the note now at i, or
   * {error}. The notes given are never changed.
   */
  function apply(notes, keyText, timeSignature, request) {
    var C = window.NfChoir, key = C.parseKey(keyText);
    if (!key) return { error: "This sheet has no key to name the notes from." };
    var dohPc = key.mode === "major" ? key.tonicPitchClass : (key.tonicPitchClass + 3) % 12;
    var barOf = barCounter(notes, beatsPerBar(timeSignature)), found = resolve(notes, request.target, barOf);
    if (found.error) return { error: found.error };
    var picked = found.picked, change = request.change, first = notes[picked[0]], many = picked.length > 1;
    // "4 m’s" or "note 5 (bar 2, m)"; a change to a syllable names the old one itself ("from m to f").
    var what = many ? picked.length + " " + plural(request.target.syl + (request.target.marks || "")) : describe(first, barOf, notes);
    var whole = many ? what : what + ", " + nameOf(first) + ")";
    if (change.remove) {
      if (picked.length >= notes.length) return { error: "A sheet must keep at least one note." };
      var gone = {};
      picked.forEach(function (k) { gone[k] = true; });
      var from = notes.map(function (_, k) { return k; }).filter(function (k) { return !gone[k]; });
      return { notes: C.label(from.map(function (k) { return notes[k]; }), keyText), said: "Deleted " + whole + ".", from: from };
    }
    var moved = notes.slice();
    for (var p = 0; p < picked.length; p++) {
      var k = picked[p], n = notes[k];
      var pitch = change.shift !== undefined ? n.pitchMidi + change.shift : pitchFor(n, change.to, dohPc);
      if (pitch < 21 || pitch > 108) return { error: "That would take " + describe(n, barOf, notes) + ") off the keyboard." };
      moved[k] = { pitchMidi: pitch, startBeat: n.startBeat, durBeats: n.durBeats, conf: 1 };
    }
    var labelled = C.label(moved, keyText), now = labelled[picked[0]];
    var said = change.shift !== undefined
      ? "Moved " + whole + " " + (change.shift > 0 ? "up" : "down") + " " + amount(Math.abs(change.shift)) + "."
      : "Changed " + (many ? what : what + ") from " + nameOf(first)) + " to " + nameOf(now) + ".";
    return { notes: labelled, said: said, from: notes.map(function (_, k) { return k; }) };
  }
  function amount(semis) {
    if (semis % 12 === 0) return semis === 12 ? "an octave" : semis / 12 + " octaves";
    return semis === 1 ? "a semitone" : semis + " semitones";
  }

  /** read() then apply(): {notes, said} or {error}. */
  function edit(notes, keyText, timeSignature, text) {
    var request = read(text);
    return request.ok ? apply(notes, keyText, timeSignature, request) : { error: request.error };
  }

  window.NfSheetEdit = { read: read, apply: apply, edit: edit, EXAMPLE: EXAMPLE };
})();
