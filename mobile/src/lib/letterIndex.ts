/**
 * The Hymns tab's A to Z (board n-ux-low Q4l): the hymns grouped under the letter they sort by, a letter rail on the
 * right edge that a finger drags or taps, and where each letter's group sits in the list so the rail can jump to it.
 * Pure; tests: letterIndex.test.ts.
 */

/** One letter's group: its header and the rows under it. */
export interface LetterSection<T> {
  letter: string;
  data: T[];
}

/**
 * A title's letter, read from its sort key (folded: lower case, no accents or punctuation, so "‘Tis So Sweet" is
 * "tis so sweet" and files under T): the first letter, upper case, or "#" for a title that starts with a number.
 */
export function letterOf(sortKey: string): string {
  const first = sortKey.charAt(0);
  return /[a-z]/i.test(first) ? first.toUpperCase() : "#";
}

/**
 * The items under their letters, in the order the letters first appear (the list comes sorted by the same key, so
 * that is A to Z) and each item in its own order. A letter with nothing under it has no group, so the rail leaves it
 * out.
 */
export function letterSections<T>(items: readonly T[], sortKey: (item: T) => string): LetterSection<T>[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const letter = letterOf(sortKey(item));
    const group = groups.get(letter);
    if (group) group.push(item);
    else groups.set(letter, [item]);
  }
  return [...groups].map(([letter, data]) => ({ letter, data }));
}

/** The rail's letters laid out in its height: each letter's slot, at most `maxSlot` tall, the column centred. */
export interface RailGeometry {
  slot: number;
  /** Where the first letter's slot starts, from the rail's top. */
  top: number;
}

export function railGeometry(height: number, count: number, maxSlot: number): RailGeometry {
  if (count <= 0 || height <= 0) return { slot: 0, top: 0 };
  const slot = Math.min(maxSlot, height / count);
  return { slot, top: (height - slot * count) / 2 };
}

/**
 * The letter under a finger `y` from the rail's top: a finger above the first letter or below the last holds the
 * end it passed, so a drag off the rail never jumps back.
 */
export function railIndexAt(y: number, geometry: RailGeometry, count: number): number {
  if (count <= 0 || geometry.slot <= 0) return 0;
  const i = Math.floor((y - geometry.top) / geometry.slot);
  return Math.max(0, Math.min(count - 1, i));
}

/** The heights the list is drawn with: everything above the first group, a letter's header, a row. */
export interface SectionMetrics {
  top: number;
  header: number;
  row: number;
}

/**
 * Where every cell of a sectioned list sits, as the list counts its cells: each group is its header, its rows, then
 * a footer of no height. Every row is drawn the same height (its divider inside it), so the list can scroll to any
 * letter before the rows on the way have been drawn.
 */
export function sectionCellLayouts(counts: readonly number[], m: SectionMetrics): { length: number; offset: number }[] {
  const out: { length: number; offset: number }[] = [];
  let offset = m.top;
  for (const count of counts) {
    out.push({ length: m.header, offset });
    offset += m.header;
    for (let i = 0; i < count; i++) {
      out.push({ length: m.row, offset });
      offset += m.row;
    }
    out.push({ length: 0, offset });
  }
  return out;
}
