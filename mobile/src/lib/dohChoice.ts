/**
 * The "or is it…?" doh prompt. When the worker is unsure of the doh it sends the other keys the
 * voice fits nearly as well, each with the notes written in its scale (`keyAlternatives`). Choosing
 * one swaps the pitches and the key together: a note the singer left between two scale tones is
 * written as the chosen key's tone, not as an accidental, which a plain re-key would leave.
 */
import type { KeyAlternative, NoteEvent } from "../api/types";

/**
 * The alternatives worth asking about: readable, a doh other than the sheet's, one per doh.
 * `dohOf` is the key's doh pitch class, or null for a key it cannot read (`lib/solfa`).
 */
export function dohChoices(
  key: string,
  notes: readonly NoteEvent[],
  alternatives: readonly KeyAlternative[] | null | undefined,
  dohOf: (key: string) => number | null,
): KeyAlternative[] {
  const current = dohOf(key);
  if (current === null || !alternatives) return [];
  const seen = new Set([current]);
  const out: KeyAlternative[] = [];
  for (const alt of alternatives) {
    const doh = dohOf(alt.key);
    if (doh === null || alt.pitches.length !== notes.length) continue;
    if (seen.has(doh)) continue;
    seen.add(doh);
    out.push(alt);
  }
  return out;
}

/** The notes written in the alternative's scale: the same rhythm, its pitches. */
export function writeInKey<N extends NoteEvent>(notes: readonly N[], alt: KeyAlternative): N[] {
  return notes.map((n, i) => {
    const pitch = alt.pitches[i];
    return pitch === undefined || pitch === n.pitchMidi ? n : { ...n, pitchMidi: pitch };
  });
}
