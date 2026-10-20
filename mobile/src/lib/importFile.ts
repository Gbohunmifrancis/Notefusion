/**
 * Which files Record's Import can send. The picker still offers every file: Android types many the worker reads
 * under no audio type at all (a video's .mp4 or .webm, an .ogg as application/ogg, a .musicxml or .abc score), so
 * the name's ending is checked here instead, before anything is uploaded. Mirrors the worker's ACCEPTED_SUFFIXES and
 * ACCEPTED_SCORE_SUFFIXES (server/app/api/routes.py). Pure (`importFile.test.ts`).
 */

const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(["wav", "flac", "ogg", "opus", "mp3", "m4a", "aac", "webm", "mp4", "caf", "weba"]);
const SCORE_EXTENSIONS: ReadonlySet<string> = new Set(["mid", "midi", "xml", "musicxml", "mxl", "abc"]);

/** "mp3" for "Take 1.MP3"; "" when the name has no ending. */
export function fileExtension(name: string | null | undefined): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** A score or MIDI file: read as written, nothing to isolate. */
export function isScoreFile(name: string | null | undefined): boolean {
  return SCORE_EXTENSIONS.has(fileExtension(name));
}

/**
 * Whether the worker will take the file. A name with no ending is sent as a recording (the API names it), so only a
 * known ending that is neither audio nor a score is refused.
 */
export function canImport(name: string | null | undefined): boolean {
  const ext = fileExtension(name);
  return ext === "" || AUDIO_EXTENSIONS.has(ext) || SCORE_EXTENSIONS.has(ext);
}

/**
 * The API refused the audio itself — a format it cannot read (415) or no clear notes in it (422) — so sending the same
 * take again would be refused again: Record's failure card offers a new take instead of a retry.
 */
export function audioRefused(code: string | null | undefined): boolean {
  return code === "UNSUPPORTED_MEDIA" || code === "INVALID_AUDIO";
}
