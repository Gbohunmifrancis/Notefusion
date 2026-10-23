import { Directory, File, Paths } from "expo-file-system";
import { ensurePiano } from "./piano";
import { voicesWav } from "./synth";
import { runSliced, sourceKey, type VoicesSource } from "./melodySource";

/**
 * A sheet's playback audio, made without holding the screen and kept on the phone (the recipe, its name and the slice
 * runner are lib/melodySource). Made in one go on the Result screen, a song's audio held the phone still for seconds
 * on opening, on every tempo change and on every move of a part's balance.
 */

/** Clips kept, newest first; a song's is a few MB, a hymn's a few hundred KB. */
const KEEP_FILES = 30;

function folder(): Directory {
  const dir = new Directory(Paths.cache, "nf-audio");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Keeps the newest KEEP_FILES clips. A leftover file is not fatal: the cache folder is the system's to clear too. */
function prune(dir: Directory): void {
  try {
    const files = dir
      .list()
      .filter((f): f is File => f instanceof File)
      .map((f) => ({ f, at: f.modificationTime ?? 0 }))
      .sort((x, y) => y.at - x.at);
    for (const { f } of files.slice(KEEP_FILES)) f.delete();
  } catch {
    // Pruned next time.
  }
}

/**
 * The file to play for `source`: the kept one, or one made now (in slices) and kept. Null when `cancelled` turned true
 * meanwhile (a newer recipe took its place) or there is nothing to play.
 */
export async function wavFileFor(source: VoicesSource, cancelled: () => boolean): Promise<string | null> {
  // The recorded piano, not the stand-in voice a cold start would otherwise make and keep.
  const piano = await ensurePiano();
  if (cancelled()) return null;
  const dir = folder();
  const key = sourceKey(source);
  const kept = new File(dir, `${key}.wav`);
  if (piano && kept.exists) return kept.uri;

  const bytes = await runSliced(voicesWav(source.voices, source.tempoBpm, source.opts), cancelled);
  if (!bytes) return null;
  // Written under another name and renamed, so a write cut short is never taken for a whole clip. Without the piano
  // the clip is the stand-in voice: played, but under its own name, never kept as the piano's.
  const name = piano ? `${key}.wav` : `${key}-stand-in-${Date.now()}.wav`;
  const part = new File(dir, `${key}-${Date.now()}.part`);
  part.write(bytes);
  if (piano && kept.exists) kept.delete();
  part.rename(name);
  prune(dir);
  return new File(dir, name).uri;
}
