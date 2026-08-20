/**
 * Key signatures and key-aware pitch spelling for the stave.
 *
 * Placement on a stave is diatonic: a pitch becomes a letter + octave + an
 * alteration, and only then a vertical position. Which letter depends on the
 * key — pitch class 10 is Bb in D minor (a B, sitting on the B line, covered by
 * the signature's single flat) and A# in B major (an A, needing its own sharp).
 * Spelling it unconditionally as a sharp puts the head on the wrong line, so the
 * drawn contour is wrong, not merely the label.
 *
 * This is deliberately separate from the solfa engine. `lib/solfa` names
 * *syllables* from scale degrees; this names *letters* for engraving. A Bb is
 * spelled "B flat" here and still sung as its movable-do syllable there, so the
 * two never contradict each other and neither needs to mirror the other. Nothing
 * in here changes a syllable, so the C#/Python solfa mirrors are untouched.
 *
 * No imports on purpose: the whole module is arithmetic over fixed tables, so it
 * compiles standalone and every one of the 24 keys can be checked in isolation.
 */

export type KeyMode = "major" | "minor";
export type Accidental = "sharp" | "flat" | "natural";

/** Natural pitch class of each letter step, C=0 … B=6. */
const NATURAL_PC = [0, 2, 4, 5, 7, 9, 11] as const;

/**
 * Sharps/flats in the signature of each major key, indexed by tonic pitch class.
 * Negative counts flats. The enharmonic choices are the conventional ones —
 * F# major (6 sharps) rather than Gb major, Db major (5 flats) rather than C#.
 */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5] as const;

/** Canonical order, never re-sorted: F C G D A E B for sharps, its reverse for flats. */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6] as const;
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3] as const;

/** Letter + alteration for each pitch class, sharp-preferring and flat-preferring. */
const PC_LETTER_SHARP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6] as const;
const PC_ALTER_SHARP = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0] as const;
const PC_LETTER_FLAT = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6] as const;
const PC_ALTER_FLAT = [0, -1, 0, -1, 0, 0, -1, 0, -1, 0, -1, 0] as const;

export interface KeySignature {
  /** Sharps as positive, flats as negative, −7…7. */
  fifths: number;
  /** Alteration the signature applies to each letter step C..B: −1, 0 or +1. */
  alter: readonly number[];
  /** The glyphs to draw, in canonical order. */
  accidentals: readonly { letter: number; kind: "sharp" | "flat" }[];
  tonicPitchClass: number;
  mode: KeyMode;
}

/**
 * Signature size for a key. Minor keys borrow their relative major's signature,
 * which is three semitones up — hence the −3.
 *
 * That subtraction can leave the range signatures are actually written in: C#
 * minor derives to −8 and G# minor to −7, and nobody writes eight flats or picks
 * Ab minor's seven over G# minor's five. Twelve fifths is one enharmonic turn of
 * the circle, so wrapping by +12 lands on the same sounding key with the spelling
 * convention uses: −8 → +4 and −7 → +5. Six flats (Eb minor) is the deepest flat
 * signature convention keeps, which is where the threshold sits. The major table
 * is already written in conventional spellings, so it never wraps.
 */
export function fifthsFor(tonicPitchClass: number, mode: KeyMode): number {
  const pc = ((tonicPitchClass % 12) + 12) % 12;
  const fifths = MAJOR_FIFTHS[pc]! - (mode === "minor" ? 3 : 0);
  return fifths < -6 ? fifths + 12 : fifths;
}

export function keySignatureFor(tonicPitchClass: number, mode: KeyMode): KeySignature {
  const fifths = fifthsFor(tonicPitchClass, mode);
  const sharps = fifths >= 0;
  const order = sharps ? SHARP_ORDER : FLAT_ORDER;
  const alter = [0, 0, 0, 0, 0, 0, 0];
  const accidentals: { letter: number; kind: "sharp" | "flat" }[] = [];

  for (let i = 0; i < Math.abs(fifths); i++) {
    const letter = order[i]!;
    alter[letter] = sharps ? 1 : -1;
    accidentals.push({ letter, kind: sharps ? "sharp" : "flat" });
  }

  return {
    fifths,
    alter,
    accidentals,
    tonicPitchClass: ((tonicPitchClass % 12) + 12) % 12,
    mode,
  };
}

/** C major — the fallback when the key text cannot be parsed. */
export const C_MAJOR: KeySignature = keySignatureFor(0, "major");

export interface Spelling {
  /** Letter step, C=0 … B=6. */
  letter: number;
  /** Absolute diatonic step, octave*7 + letter. C4 → 28. */
  step: number;
  /** −1 flat, 0 natural, +1 sharp. */
  alter: number;
  /** The glyph this note needs if nothing has stated its alteration yet, else null. */
  accidental: Accidental | null;
}

/**
 * Spells a MIDI pitch in a key.
 *
 * Diatonic pitches take their letter from the scale, so their alteration is
 * already carried by the signature and they need no glyph of their own. A
 * chromatic pitch always has two valid spellings — it sits in a whole-tone gap,
 * so it is both a raised lower degree and a lowered upper one — and the
 * convention is to follow the signature's own accidental type. The one standing
 * exception is the raised seventh in a minor key, which is a raise by definition
 * and far too common in sung melodies to spell as a flattened tonic.
 */
export function spell(midi: number, key: KeySignature): Spelling {
  const pc = ((Math.round(midi) % 12) + 12) % 12;

  // Diatonic: the signature already says what this letter sounds like.
  for (let letter = 0; letter < 7; letter++) {
    const sounding = (NATURAL_PC[letter]! + key.alter[letter]! + 12) % 12;
    if (sounding === pc) return finish(midi, letter, key.alter[letter]!, key);
  }

  // The raised seventh of a minor key. Raising a degree the signature already
  // flattened yields a natural, not a sharp — Bb minor's leading note is A, not A#.
  // G# minor is the one key where this needs a double sharp (its seventh is
  // already F#, so the leading note is F##); the stave draws single accidentals
  // only, so that one falls through to an enharmonic G natural below.
  if (key.mode === "minor" && pc === (key.tonicPitchClass + 11) % 12) {
    const seventh = leadingLetter(key);
    if (seventh !== null && Math.abs(key.alter[seventh]! + 1) <= 1) {
      return finish(midi, seventh, key.alter[seventh]! + 1, key);
    }
  }

  // Any other chromatic note: follow the signature's accidental type.
  const flats = key.fifths < 0;
  const letter = (flats ? PC_LETTER_FLAT : PC_LETTER_SHARP)[pc]!;
  const alter = (flats ? PC_ALTER_FLAT : PC_ALTER_SHARP)[pc]!;
  return finish(midi, letter, alter, key);
}

/** The letter of the key's seventh degree, or null if no letter is a semitone below the tonic. */
function leadingLetter(key: KeySignature): number | null {
  const target = (key.tonicPitchClass + 11) % 12;
  for (let letter = 0; letter < 7; letter++) {
    const sounding = (NATURAL_PC[letter]! + key.alter[letter]! + 12) % 12;
    if ((sounding + 1) % 12 === target) return letter;
  }
  return null;
}

function finish(midi: number, letter: number, alter: number, key: KeySignature): Spelling {
  // The octave comes from the letter, not from the sounding pitch: B#4 sounds
  // where C5 does but belongs to octave 4, so floor(midi/12) would place it an
  // octave too high and put the head on the wrong line.
  const octave = Math.round((Math.round(midi) - alter - NATURAL_PC[letter]!) / 12) - 1;
  const signatureAlter = key.alter[letter]!;
  return {
    letter,
    step: octave * 7 + letter,
    alter,
    // Only what the signature does not already say needs a glyph of its own.
    accidental: alter === signatureAlter ? null : accidentalFor(alter),
  };
}

/**
 * The glyph an alteration needs when something has to state it explicitly.
 * Zero is a natural, not "no glyph" — cancelling an earlier sharp or the
 * signature's own flat is exactly what a natural is for.
 */
export function accidentalFor(alter: number): Accidental {
  return alter > 0 ? "sharp" : alter < 0 ? "flat" : "natural";
}
