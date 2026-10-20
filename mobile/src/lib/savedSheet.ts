/**
 * Option A (board 12): every finished transcription is filed in the Library by the server the moment its job
 * finishes. The words the phone puts around such a sheet. Pure.
 */

/** What kind of take a result was, for the line under its title: "Hummed", "Song", "Choir", "Chords". */
export function takeKind(result: {
  separated?: boolean | null;
  partsSource?: string | null;
  chordsSource?: string | null;
}): string {
  if (result.partsSource === "heard") return "Choir";
  if (result.separated) return "Song";
  if (result.chordsSource === "heard") return "Chords";
  return "Hummed";
}

/** The first-open toast's second line: what the sheet was filed as, and why when a hymn named it. */
export function savedToastBody(title: string, hymnTitle?: string | null): string {
  return hymnTitle && hymnTitle.trim() === title.trim() ? `As "${title}", the hymn it matched` : `As "${title}"`;
}

/**
 * The first-open toast's second line on a filed sheet with doubtful notes (board m-ux-medium P1f): "2 notes worth a
 * listen", beside its one action, Check.
 */
export function worthAListenLine(count: number): string {
  return count === 1 ? "1 note worth a listen" : `${count} notes worth a listen`;
}

/** A sheet the server filed that its owner has not opened yet: the Library's blue dot. */
export function isUnopened(sheet: { savedAutomatically?: boolean; openedAtUtc?: string | null }): boolean {
  return !!sheet.savedAutomatically && !sheet.openedAtUtc;
}

/** "Saved automatically · 18:42", on the phone's clock. */
export function autoSavedLine(createdAtUtc: string): string {
  const d = new Date(createdAtUtc);
  return `Saved automatically · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The folder a typed name files into: an existing folder spelt any other case ("sunday choir" for "Sunday choir")
 * is that folder, in its own spelling, so one folder never splits in two. Otherwise the name as typed, trimmed.
 */
export function folderNamed(typed: string, folders: readonly string[]): string {
  const name = typed.trim();
  const key = name.toLowerCase();
  return folders.find((f) => f.trim().toLowerCase() === key) ?? name;
}

/**
 * What a move to a folder says once it is done: "Moved to Sunday choir", "3 sheets moved to Sunday choir", "Taken out
 * of its folder". A haptic alone left no word on screen that it worked.
 */
export function filedToast(count: number, folder: string | null): string {
  if (folder) return count === 1 ? `Moved to ${folder}` : `${count} sheets moved to ${folder}`;
  return count === 1 ? "Taken out of its folder" : `${count} sheets taken out of their folders`;
}

/** What sharing with the choir (or taking a sheet back out) says once it is done. */
export function choirToast(count: number, share: boolean): string {
  if (share) return count === 1 ? "Shared with your choir" : `${count} sheets shared with your choir`;
  return count === 1 ? "Taken out of the choir library" : `${count} sheets taken out of the choir library`;
}

/** What "Keep offline" (or undoing it) says once it is done: a haptic alone left no word that it worked. */
export function offlineToast(keep: boolean): string {
  return keep ? "Kept on this phone for offline use" : "No longer kept on this phone";
}

/** What Stop sharing says once the link is off. */
export const SHARING_STOPPED = "Sharing stopped: the link no longer opens this sheet";
