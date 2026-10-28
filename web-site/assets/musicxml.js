/* MusicXML for the notes on screen, after they have been edited here.
 *
 * The worker's MusicXML (result.musicXml) is a snapshot of what it heard: the moment a note is changed on this
 * page it is stale, and the staff drawn from it would disagree with the solfa beside it. So an edited sheet's
 * staff is written here from its notes. A port of the phone's writer (mobile/src/lib/musicxml.ts and
 * keySignature.ts): a serialiser, not an engraver. It decides the rhythm (durations, dots, ties, rests, bar
 * lines) and the spelling (letter, alteration, key signature); beams, spacing and systems are the renderer's.
 *
 * Every duration is a whole number of divisions (96 to the crotchet), so every bar sums to exactly one bar and
 * no note is lengthened or shortened except where the next onset cuts it (a staff is one voice).
 *
 * Plain script, no build step. Reads keys with window.NfChoir.parseKey (choir.js). Exposes window.NfMusicXml.
 */
(function () {
  "use strict";

  var DIVISIONS = 96;
  var NATURAL_PC = [0, 2, 4, 5, 7, 9, 11];
  // Signature size of each major key by tonic pitch class (negative = flats), in the conventional spellings.
  var MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
  var SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
  var FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
  var PC_LETTER_SHARP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  var PC_ALTER_SHARP = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
  var PC_LETTER_FLAT = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];
  var PC_ALTER_FLAT = [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0];
  var LETTERS = ["C", "D", "E", "F", "G", "A", "B"];

  // ── Keys and spelling ────────────────────────────────────────────────────
  /** Minor keys borrow their relative major's signature; past six flats it wraps to the sharp spelling. */
  function fifthsFor(tonicPc, mode) {
    var pc = ((tonicPc % 12) + 12) % 12;
    var fifths = MAJOR_FIFTHS[pc] - (mode === "minor" ? 3 : 0);
    return fifths < -6 ? fifths + 12 : fifths;
  }
  function keySignatureFor(tonicPc, mode) {
    var fifths = fifthsFor(tonicPc, mode), sharps = fifths >= 0, order = sharps ? SHARP_ORDER : FLAT_ORDER;
    var alter = [0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < Math.abs(fifths); i++) alter[order[i]] = sharps ? 1 : -1;
    return { fifths: fifths, alter: alter, tonicPitchClass: ((tonicPc % 12) + 12) % 12, mode: mode };
  }
  /** The signature a key name like "D minor" implies; C major when it cannot be read. */
  function keySignatureOf(keyText) {
    var parsed = window.NfChoir ? window.NfChoir.parseKey(keyText) : null;
    return parsed ? keySignatureFor(parsed.tonicPitchClass, parsed.mode) : keySignatureFor(0, "major");
  }
  function finish(midi, letter, alter) {
    // The octave is the letter's: B#4 sounds where C5 does but belongs to octave 4.
    var octave = Math.round((Math.round(midi) - alter - NATURAL_PC[letter]) / 12) - 1;
    return { letter: letter, octave: octave, alter: alter };
  }
  /**
   * A pitch spelled in a key: a scale note takes its letter from the scale; a chromatic one follows the
   * signature's sharps or flats, except a minor key's raised seventh, which is always a raise.
   */
  function spell(midi, key) {
    var pc = ((Math.round(midi) % 12) + 12) % 12, letter;
    for (letter = 0; letter < 7; letter++) {
      if ((NATURAL_PC[letter] + key.alter[letter] + 12) % 12 === pc) return finish(midi, letter, key.alter[letter]);
    }
    if (key.mode === "minor" && pc === (key.tonicPitchClass + 11) % 12) {
      for (letter = 0; letter < 7; letter++) {
        var sounding = (NATURAL_PC[letter] + key.alter[letter] + 12) % 12;
        if ((sounding + 1) % 12 === pc && Math.abs(key.alter[letter] + 1) <= 1) return finish(midi, letter, key.alter[letter] + 1);
      }
    }
    var flats = key.fifths < 0;
    return finish(midi, (flats ? PC_LETTER_FLAT : PC_LETTER_SHARP)[pc], (flats ? PC_ALTER_FLAT : PC_ALTER_SHARP)[pc]);
  }

  // ── Durations ────────────────────────────────────────────────────────────
  var NOTE_TYPES = [["whole", 4], ["half", 2], ["quarter", 1], ["eighth", 0.5], ["16th", 0.25], ["32nd", 0.125], ["64th", 0.0625]];
  /** Every length one notehead can show (up to two dots), longest first. */
  var WRITABLE = [];
  NOTE_TYPES.forEach(function (t) {
    [0, 1, 2].forEach(function (dots) {
      var div = (t[1] * DIVISIONS * (Math.pow(2, dots + 1) - 1)) / Math.pow(2, dots);
      if (Number.isInteger(div)) WRITABLE.push({ div: div, type: t[0], dots: dots, plain: dots === 0 });
    });
  });
  WRITABLE.sort(function (a, b) { return b.div - a.div; });

  /** `len` divisions from `pos` as the fewest heads; a rest prefers lengths it is aligned to. */
  function decompose(pos, len, isRest) {
    var out = [], at = pos, left = len;
    while (left > 0) {
      var pick = null, i;
      if (isRest) for (i = 0; i < WRITABLE.length; i++) { var w = WRITABLE[i]; if (w.div <= left && w.plain && at % w.div === 0) { pick = w; break; } }
      if (!pick) for (i = 0; i < WRITABLE.length; i++) { if (WRITABLE[i].div <= left) { pick = WRITABLE[i]; break; } }
      if (!pick) break;
      out.push(pick); at += pick.div; left -= pick.div;
    }
    return out;
  }

  function beatsPerBar(ts) { var p = String(ts || "4/4").split("/").map(Number); return p[0] && p[1] ? (p[0] * 4) / p[1] : 4; }

  /** The notes laid out in bars, silence filled with rests; a note still sounding at the next onset is cut there. */
  function fragmentsOf(notes, perBarDiv) {
    var scaled = notes.map(function (n) {
      return { note: n, start: Math.round(n.startBeat * DIVISIONS), div: Math.max(1, Math.round(n.durBeats * DIVISIONS)) };
    }).sort(function (a, b) { return a.start - b.start; });
    var spans = [], t = 0;
    for (var i = 0; i < scaled.length; i++) {
      var cur = scaled[i];
      if (cur.start < t) continue;
      if (cur.start > t) spans.push({ start: t, div: cur.start - t, note: null });
      var next = scaled[i + 1];
      var end = next === undefined ? cur.start + cur.div : Math.min(cur.start + cur.div, next.start);
      if (end <= cur.start) continue;
      spans.push({ start: cur.start, div: end - cur.start, note: cur.note });
      t = end;
    }
    var total = Math.ceil(t / perBarDiv) * perBarDiv;
    if (total > t) spans.push({ start: t, div: total - t, note: null });
    var measures = [];
    spans.forEach(function (span) {
      var at = span.start, left = span.div;
      while (left > 0) {
        var index = Math.floor(at / perBarDiv), pos = at - index * perBarDiv, take = Math.min(left, perBarDiv - pos);
        while (measures.length <= index) measures.push([]);
        measures[index].push({ pos: pos, div: take, note: span.note, tiedFrom: span.note !== null && at > span.start, tiedTo: span.note !== null && take < left });
        at += take; left -= take;
      }
    });
    return measures;
  }

  // ── Writing ──────────────────────────────────────────────────────────────
  function pickClef(notes) {
    var sorted = notes.map(function (n) { return n.pitchMidi; }).sort(function (a, b) { return a - b; });
    var median = sorted[Math.floor(sorted.length / 2)];
    return (median === undefined ? 60 : median) < 52 ? "bass" : "treble";
  }
  function noteXml(frag, w, key, words) {
    var parts = [];
    if (frag.note === null) parts.push("        <rest/>");
    else {
      var sp = spell(frag.note.pitchMidi, key);
      parts.push("        <pitch>", "          <step>" + LETTERS[sp.letter] + "</step>");
      if (sp.alter !== 0) parts.push("          <alter>" + sp.alter + "</alter>");
      parts.push("          <octave>" + sp.octave + "</octave>", "        </pitch>");
    }
    parts.push("        <duration>" + w.div + "</duration>");
    if (frag.tiedFrom) parts.push('        <tie type="stop"/>');
    if (frag.tiedTo) parts.push('        <tie type="start"/>');
    parts.push("        <voice>1</voice>", "        <type>" + w.type + "</type>");
    for (var d = 0; d < w.dots; d++) parts.push("        <dot/>");
    if (frag.tiedFrom || frag.tiedTo) {
      parts.push("        <notations>");
      if (frag.tiedFrom) parts.push('          <tied type="stop"/>');
      if (frag.tiedTo) parts.push('          <tied type="start"/>');
      parts.push("        </notations>");
    }
    // The words sung on a note go under its first head, never under the heads tied on from it.
    if (words && !frag.tiedFrom) parts.push("        " + words);
    return "      <note>\n" + parts.join("\n") + "\n      </note>";
  }

  /**
   * The words under each of `notes` in the staff `xml` (each note's <lyric> elements as written, or "" for
   * none), by the notes' index; null when the staff's heads cannot be paired with the notes one to one.
   * A staff's heads run in time order: tied-on heads, rests, grace notes and chord tones are not notes of the tune.
   */
  function wordsFor(notes, xml) {
    if (!notes || !notes.length || !xml || xml.indexOf("<lyric") < 0) return null;
    var heads = [], m, re = /<note\b[^>]*>([\s\S]*?)<\/note>/g;
    while ((m = re.exec(xml))) {
      var inner = m[1];
      if (/<(rest|chord|grace)\b/.test(inner) || /<tie\s+type="stop"/.test(inner)) continue;
      heads.push((inner.match(/<lyric\b[\s\S]*?<\/lyric>/g) || []).join(""));
    }
    if (heads.length !== notes.length) return null;
    var order = notes.map(function (_, i) { return i; }).sort(function (a, b) { return notes[a].startBeat - notes[b].startBeat; });
    var out = [];
    order.forEach(function (idx, k) { out[idx] = heads[k]; });
    return out;
  }

  /**
   * A score-partwise document of `notes` ({pitchMidi, startBeat, durBeats}, beats in crotchets) in `keyText`
   * and `timeSignature`, with the tempo marked when given and `words` (wordsFor's, by the notes' index) under
   * the notes; null when there is nothing to write.
   */
  function build(notes, keyText, timeSignature, tempo, words) {
    if (!notes || !notes.length) return null;
    var perBar = beatsPerBar(timeSignature);
    if (!Number.isInteger(perBar * DIVISIONS)) return null;
    var perBarDiv = perBar * DIVISIONS, measures = fragmentsOf(notes, perBarDiv);
    if (!measures.length) return null;
    // The tune starts in the bar of its first note: whole bars of silence before it are not written, and a first
    // bar it enters part-way through is a pickup, a short bar numbered 0 as a hymn book prints it.
    var first = Math.min.apply(null, notes.map(function (n) { return Math.round(n.startBeat * DIVISIONS); }));
    measures = measures.slice(Math.floor(first / perBarDiv));
    var pickup = first % perBarDiv > 0;
    if (pickup) {
      measures[0] = measures[0].filter(function (f) { return f.note !== null || f.pos >= first % perBarDiv; });
      // The last bar gives the pickup's beats back, as a hymn book prints it, when it ends in that much silence.
      var last = measures[measures.length - 1], tail = last[last.length - 1], lent = perBarDiv - first % perBarDiv;
      if (measures.length > 1 && tail.note === null && tail.div >= lent) {
        tail.div -= lent;
        if (!tail.div) last.pop();
      }
    }
    var wordsOf = new Map();
    if (words) notes.forEach(function (n, i) { if (words[i]) wordsOf.set(n, words[i]); });
    var key = keySignatureOf(keyText), ts = String(timeSignature || "4/4").split("/").map(Number), clef = pickClef(notes), body = [];
    measures.forEach(function (frags, m) {
      body.push(pickup && m === 0 ? '    <measure number="0" implicit="yes">' : '    <measure number="' + (pickup ? m : m + 1) + '">');
      if (m === 0) {
        body.push("      <attributes>", "        <divisions>" + DIVISIONS + "</divisions>",
          "        <key><fifths>" + key.fifths + "</fifths><mode>" + key.mode + "</mode></key>",
          "        <time><beats>" + (ts[0] || 4) + "</beats><beat-type>" + (ts[1] || 4) + "</beat-type></time>",
          clef === "bass" ? "        <clef><sign>F</sign><line>4</line></clef>" : "        <clef><sign>G</sign><line>2</line></clef>",
          "      </attributes>");
        if (tempo) {
          body.push('      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>' +
            Math.round(tempo) + "</per-minute></metronome></direction-type><sound tempo=\"" + Math.round(tempo) + "\"/></direction>");
        }
      }
      if (frags.length === 1 && frags[0].note === null && frags[0].div === perBarDiv) {
        body.push("      <note>", '        <rest measure="yes"/>', "        <duration>" + perBarDiv + "</duration>", "        <voice>1</voice>", "      </note>", "    </measure>");
        return;
      }
      frags.forEach(function (frag) {
        var heads = decompose(frag.pos, frag.div, frag.note === null);
        heads.forEach(function (w, i) {
          var piece = { pos: frag.pos, div: frag.div, note: frag.note,
            tiedFrom: frag.tiedFrom || (frag.note !== null && i > 0), tiedTo: frag.tiedTo || (frag.note !== null && i < heads.length - 1) };
          body.push(noteXml(piece, w, key, i === 0 ? wordsOf.get(frag.note) : null));
        });
      });
      if (m === measures.length - 1) body.push('      <barline location="right"><bar-style>light-heavy</bar-style></barline>');
      body.push("    </measure>");
    });
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n' +
      '<score-partwise version="4.0">\n  <part-list>\n    <score-part id="P1"><part-name>Voice</part-name></score-part>\n  </part-list>\n' +
      '  <part id="P1">\n' + body.join("\n") + "\n  </part>\n</score-partwise>\n";
  }

  window.NfMusicXml = { build: build, wordsFor: wordsFor, spell: spell, keySignatureFor: keySignatureFor, DIVISIONS: DIVISIONS };
})();
