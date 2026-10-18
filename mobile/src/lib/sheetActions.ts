/**
 * What can be done to saved sheets from a list or the sheet itself — share a link, share with the choir, file in a
 * folder, keep offline, rename, delete — each as one function: the API call, the success tick, and a plain sentence
 * when it fails. The Library (its selection bar), Home's recent rows (board a-core/11) and the Result screen's options
 * all call these, so a sheet behaves the same wherever it is acted on. The list state each caller keeps is its own:
 * these return what changed.
 */

import { Share } from "react-native";
import { choirApi, libraryApi } from "../api/endpoints";
import { toApiError } from "../api/client";
import { showDialog } from "./dialog";
import * as haptics from "./haptics";
import { setSheetPinned } from "./offlineLibrary";
import { isNetworkCode } from "./reachability";
import { showToast } from "./toast";

type Sheet = { id: string; title: string };

function failed(title: string, e: unknown): void {
  showDialog({ title, message: toApiError(e).message, icon: "problem", tone: "danger" });
}

/** The first failure of a batch, if any. */
function firstFailure(results: PromiseSettledResult<unknown>[]): PromiseRejectedResult | undefined {
  return results.find((r): r is PromiseRejectedResult => r.status === "rejected");
}

/**
 * Each sheet's public link, made if needed, sent in one message through the phone's share sheet. Returns each sheet's
 * token (to mark them shared), or null when a link could not be made.
 */
export async function shareSheetLinks(targets: readonly Sheet[]): Promise<Map<string, string> | null> {
  if (targets.length === 0) return null;
  try {
    const links = await Promise.all(targets.map((t) => libraryApi.share(t.id)));
    const one = targets.length === 1 ? links[0]! : null;
    const message = one
      ? `${targets[0]!.title} — Tonic Solfa on NoteFusion\n${one.url}`
      : ["Tonic Solfa on NoteFusion", ...targets.map((t, i) => `${t.title}\n${links[i]!.url}`)].join("\n\n");
    await Share.share(one ? { message, url: one.url } : { message });
    return new Map(targets.map((t, i) => [t.id, links[i]!.token]));
  } catch (e) {
    failed("Could not share", e);
    return null;
  }
}

/** Puts the sheets in the choir's shared library, or takes them out. Returns the ones done. */
export async function setChoirSharing(targets: readonly Sheet[], share: boolean): Promise<Set<string>> {
  const results = await Promise.allSettled(targets.map((t) => (share ? choirApi.share(t.id) : choirApi.unshare(t.id))));
  const done = new Set(targets.filter((_, i) => results[i]!.status === "fulfilled").map((t) => t.id));
  const failure = firstFailure(results);
  if (failure) failed("Could not share with your choir", failure.reason);
  else if (share) haptics.play("success");
  return done;
}

/** Files the sheets in a folder (null takes them out). Returns the ones moved; all moved is a success tick. */
export async function fileSheets(targets: readonly Sheet[], folder: string | null): Promise<{ moved: Set<string>; ok: boolean }> {
  const results = await Promise.allSettled(targets.map((t) => libraryApi.setFolder(t.id, folder)));
  const moved = new Set(targets.filter((_, i) => results[i]!.status === "fulfilled").map((t) => t.id));
  const failure = firstFailure(results);
  if (failure) failed("Could not move the sheet", failure.reason);
  else haptics.play("success");
  return { moved, ok: !failure };
}

/** "Keep offline" for one sheet. Resolves true when it changed. */
export async function keepSheetOffline(id: string, keep: boolean): Promise<boolean> {
  try {
    await setSheetPinned(id, keep);
    haptics.play("success");
    return true;
  } catch (e) {
    const err = toApiError(e);
    showDialog({
      title: "Couldn't keep it offline",
      message: isNetworkCode(err.code) ? "You're offline. Try again when you're back online." : err.message,
      icon: "offline",
    });
    return false;
  }
}

/** Renames a saved sheet. Returns the title the server kept, or null when it failed. */
export async function renameSheet(id: string, title: string): Promise<string | null> {
  try {
    const updated = await libraryApi.rename(id, title.trim());
    showToast("Renamed");
    return updated.title;
  } catch (e) {
    failed("Could not rename", e);
    return null;
  }
}

/**
 * The one question before a delete (board a-core/11): the piece by name, what happens, then Cancel and the quiet pill
 * with the red word. `onDelete` runs only on Delete.
 */
export function askToDelete(targets: readonly Sheet[], onDelete: () => void): void {
  if (targets.length === 0) return;
  // One tap from losing work: the question arrives with the warning buzz.
  haptics.play("warning");
  const one = targets.length === 1 ? targets[0]! : null;
  showDialog({
    title: one ? `Delete “${one.title}”?` : `Delete ${targets.length} sheets?`,
    message: one
      ? "It leaves your library on every device and its share link stops working. This cannot be undone."
      : "They leave your library on every device and their share links stop working. This cannot be undone.",
    actions: [
      { label: "Cancel", style: "cancel" },
      { label: "Delete", style: "destructive", onPress: onDelete },
    ],
  });
}

/** Deletes the sheets. False (after saying so) when any could not be deleted. */
export async function deleteSheets(targets: readonly Sheet[]): Promise<boolean> {
  const failure = firstFailure(await Promise.allSettled(targets.map((t) => libraryApi.remove(t.id))));
  if (failure) failed("Could not delete", failure.reason);
  return !failure;
}
