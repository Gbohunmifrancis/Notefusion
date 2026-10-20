/**
 * A held delete's list work (board m-ux-medium P2a): the sheets leave the list at once and the server is told after
 * the "… deleted · Undo" toast (`heldChange`). Undo puts each back where it was. Pure (`heldDelete.test.ts`).
 */

/** A sheet taken out of a list, and where it stood. */
export interface Removed<T> {
  item: T;
  index: number;
}

/** The sheets of `list` named by `ids`, each with its place, in list order. */
export function takeOut<T extends { id: string }>(list: readonly T[], ids: ReadonlySet<string>): Removed<T>[] {
  const out: Removed<T>[] = [];
  list.forEach((item, index) => {
    if (ids.has(item.id)) out.push({ item, index });
  });
  return out;
}

/**
 * `list` with the removed sheets back in their places. One still there (Undo before its row had folded away) is left
 * as it is, so nothing is listed twice.
 */
export function putBack<T extends { id: string }>(list: readonly T[], removed: readonly Removed<T>[]): T[] {
  const next = [...list];
  const present = new Set(next.map((t) => t.id));
  for (const r of [...removed].sort((a, b) => a.index - b.index)) {
    if (present.has(r.item.id)) continue;
    next.splice(Math.min(r.index, next.length), 0, r.item);
    present.add(r.item.id);
  }
  return next;
}

/** A list read while some deletes are still held: those sheets stay out of it until Undo or the send. */
export function withoutHeld<T extends { id: string }>(list: readonly T[], held: ReadonlySet<string>): T[] {
  return held.size === 0 ? [...list] : list.filter((t) => !held.has(t.id));
}
