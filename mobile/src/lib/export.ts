/**
 * MusicXML export. Writes the score the worker engraved to a cache file and hands
 * it to the OS share sheet, which is what lets a user open it in Sibelius,
 * MuseScore, or Finale — the point of transcribing at all for most users.
 *
 * MusicXML rather than the solfa text: solfa is a labelling of the note list and
 * the app re-derives it per key (see ./solfa), so it has no file format to own.
 * The .musicxml extension is the uncompressed single-file form; .mxl would need
 * zip machinery for no benefit here.
 */

import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** Filesystem-safe stem from a user-entered title, so the shared file is recognisable. */
function safeFileName(title: string): string {
  const stem = title
    .trim()
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return stem.length > 0 ? stem : "transcription";
}

export type ExportOutcome =
  | { ok: true }
  | { ok: false; reason: "empty" | "unavailable" | "failed"; message: string };

/**
 * Shares `musicXml` as a .musicxml file. Returns an outcome rather than throwing
 * or alerting so the caller owns the UI copy.
 *
 * The file is left in the cache directory: the share sheet reads it after this
 * function returns, so deleting it here would race the consumer. The OS reclaims
 * the cache under pressure.
 */
export async function exportMusicXml(
  musicXml: string,
  title: string,
): Promise<ExportOutcome> {
  if (!musicXml.trim()) {
    return {
      ok: false,
      reason: "empty",
      message:
        "This transcription has no score attached yet. Re-open it from your library and try again.",
    };
  }

  if (!(await Sharing.isAvailableAsync())) {
    return {
      ok: false,
      reason: "unavailable",
      message: "Sharing isn't available on this device.",
    };
  }

  try {
    const file = new File(Paths.cache, `${safeFileName(title)}.musicxml`);
    // A stale file from a previous export of the same title would otherwise
    // make write() throw rather than overwrite.
    if (file.exists) file.delete();
    file.write(musicXml);

    await Sharing.shareAsync(file.uri, {
      mimeType: "application/vnd.recordare.musicxml+xml",
      dialogTitle: `Export ${title}`,
      UTI: "public.xml",
    });

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: "failed",
      message: e instanceof Error ? e.message : "Could not export the score.",
    };
  }
}
