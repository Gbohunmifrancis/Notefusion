/**
 * Chord symbols laid over a solfa grid line, character for character.
 *
 * `renderSolfaLines` writes four bars to a line, cells joined by one space and bars by " | ", with
 * every cell half a beat. Each chord goes at the first character of the cell its beat falls in, in a
 * padded string the same length as the bar below it — so, drawn in the same monospaced face, the
 * symbol sits over the syllable it belongs to.
 *
 * No imports: the tests run on Node's own type stripping.
 */

export interface ChordAt {
  startBeat: number;
  symbol: string;
}

/** Quarter-note beats per bar; mirrors solfa.ts. */
function beatsPerBar(timeSignature: string): number {
  const [num, den] = timeSignature.split("/").map(Number);
  if (!num || !den) return 4;
  return (num * 4) / den;
}

/** Character offset of each cell inside a bar string whose cells are joined by single spaces. */
function cellOffsets(bar: string): number[] {
  const out: number[] = [];
  let inCell = false;
  for (let i = 0; i < bar.length; i++) {
    const space = bar[i] === " ";
    if (!space && !inCell) out.push(i);
    inCell = !space;
  }
  return out;
}

/**
 * Writes `text` into `line` at `at` only when the whole of it fits in blank space: a cut-down
 * symbol would read as a different chord ("Bb" as "B"), so one that will not fit is left out.
 */
function place(line: string[], at: number, text: string): void {
  if (at + text.length > line.length) return;
  for (let i = 0; i < text.length; i++) if (line[at + i] !== " ") return;
  for (let i = 0; i < text.length; i++) line[at + i] = text[i];
}

/**
 * One chord line per solfa line. `solfaLines[0]` is the "Doh is …" header and gets an empty string;
 * every other entry gets a string the same length as the solfa line under it.
 */
export function chordRows(
  chords: readonly ChordAt[],
  solfaLines: readonly string[],
  timeSignature: string,
  divisionsPerBeat = 2,
): string[] {
  const barBeats = beatsPerBar(timeSignature);
  const cellBeats = 1 / Math.max(1, divisionsPerBeat);
  const sorted = [...chords].sort((a, b) => a.startBeat - b.startBeat);

  let barIndex = 0;
  return solfaLines.map((line, i) => {
    if (i === 0) return "";
    // "| bar | bar | bar | bar |" -> the bars between the pipes, keeping their exact widths.
    const pieces = line.split("|");
    const out: string[] = [];
    for (let p = 0; p < pieces.length; p++) {
      const piece = pieces[p];
      const isBar = p > 0 && p < pieces.length - 1;
      if (!isBar) {
        out.push(" ".repeat(piece.length));
        continue;
      }
      const row = Array.from(" ".repeat(piece.length));
      const barStart = barIndex * barBeats;
      const offsets = cellOffsets(piece);
      for (const chord of sorted) {
        const rel = chord.startBeat - barStart;
        if (rel < -1e-9 || rel >= barBeats - 1e-9) continue;
        const cell = Math.min(offsets.length - 1, Math.floor(rel / cellBeats + 0.5));
        if (cell >= 0 && offsets[cell] !== undefined) place(row, offsets[cell], chord.symbol);
      }
      out.push(row.join(""));
      barIndex += 1;
    }
    return out.join(" ");
  });
}
