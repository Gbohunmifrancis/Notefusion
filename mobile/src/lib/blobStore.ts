import { Directory, File, Paths } from "expo-file-system";

/**
 * Text and audio kept for offline use, under the app's documents folder (never the cache folder,
 * which Android may empty when space runs low): `offline/` holds the saved-sheet copies, the hymn
 * pack and the send queue's recordings with their records. Every call is wrapped — a full disk or a missing file is an
 * empty answer, never a crash.
 */

function offlineRoot(): Directory {
  return new Directory(Paths.document, "offline");
}

function ensureDir(dir: Directory): Directory {
  try {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  } catch {
    // No room or no access: the write that follows fails inside its own guard and reports 0.
  }
  return dir;
}

export function dirAt(...segments: string[]): Directory {
  return ensureDir(new Directory(offlineRoot(), ...segments));
}

/** Writes text; returns its size in bytes, or 0 when it could not be written. */
export function writeText(dir: Directory, name: string, text: string): number {
  try {
    const file = new File(ensureDir(dir), name);
    if (!file.exists) file.create({ overwrite: true });
    file.write(text);
    return file.size ?? text.length;
  } catch {
    return 0;
  }
}

/** Writes bytes (a song's backing); returns the file's uri and size, or null when it could not be written. */
export function writeBytes(dir: Directory, name: string, bytes: Uint8Array): { uri: string; bytes: number } | null {
  try {
    const file = new File(ensureDir(dir), name);
    if (!file.exists) file.create({ overwrite: true });
    file.write(bytes);
    return { uri: file.uri, bytes: file.size ?? bytes.byteLength };
  } catch {
    return null;
  }
}

export async function readText(dir: Directory, name: string): Promise<string | null> {
  try {
    const file = new File(dir, name);
    if (!file.exists) return null;
    return await file.text();
  } catch {
    return null;
  }
}

export function removeFile(dir: Directory, name: string): void {
  try {
    const file = new File(dir, name);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}

export function removeUri(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}

export function removeDir(dir: Directory): void {
  try {
    if (dir.exists) dir.delete();
  } catch {
    // Already gone, or in use; the next sign-in's account check clears what is left.
  }
}

/** The uri a file named `name` in `dir` has (or will have). */
export function uriIn(dir: Directory, name: string): string {
  return new File(dir, name).uri;
}

export function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/** Size in bytes, or 0 when it cannot be read. */
export function fileSize(uri: string): number {
  try {
    const file = new File(uri);
    return file.exists ? file.size ?? 0 : 0;
  } catch {
    return 0;
  }
}

/** The names of the files and of the folders directly in `dir`; empty when it cannot be read. */
export function listDir(dir: Directory): { files: string[]; dirs: string[] } {
  try {
    if (!dir.exists) return { files: [], dirs: [] };
    const entries = dir.list();
    return {
      files: entries.filter((e) => e instanceof File).map((e) => e.name),
      dirs: entries.filter((e) => e instanceof Directory).map((e) => e.name),
    };
  } catch {
    return { files: [], dirs: [] };
  }
}

/**
 * Moves a recording (from the recorder's or the document picker's cache) into `dir`, keeping it
 * through a cache clear; falls back to a copy when a move across volumes is refused. Returns the new
 * uri and size, or null when the audio could not be kept.
 */
export function keepAudio(fromUri: string, dir: Directory, name: string): { uri: string; bytes: number } | null {
  try {
    const src = new File(fromUri);
    if (!src.exists) return null;
    const dest = new File(ensureDir(dir), name);
    if (dest.exists) dest.delete();
    try {
      src.moveSync(dest);
    } catch {
      src.copySync(dest);
    }
    const kept = new File(ensureDir(dir), name);
    return { uri: kept.uri, bytes: kept.size ?? 0 };
  } catch {
    return null;
  }
}
