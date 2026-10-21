import { useCallback, useEffect, useRef, useState } from "react";
import { File, Paths } from "expo-file-system";
import { libraryApi, transcriptionsApi } from "../api/endpoints";
import { keptBacking, rememberBacking } from "./offlineLibrary";

/**
 * The file behind a sheet's song backing (boards o-backing O1, O3): the band with the voice taken out, a small mono
 * MP3, played by a second player under the solfa (components/result/useBacking). It is never carried in the job or the
 * navigation params; it is fetched on its own, written to a file and played from there:
 *
 *   1. one sent inline (an older server, a guest's preview) is written out as it is;
 *   2. a saved sheet's backing kept on the phone (lib/offlineLibrary, beside its offline copy) plays from there,
 *      with no connection;
 *   3. a job that has just finished: `GET /api/transcriptions/jobs/{id}/backing` while the server still holds it;
 *   4. a saved sheet from the owner's own upload: `GET /api/library/{id}/backing` — and it is kept beside the sheet's
 *      offline copy then (a kept sheet always, an automatic copy within its own small room), so it plays offline next
 *      time. A link's backing is never kept: it plays from the cache while the sheet is open and goes with it.
 *
 * Downloads wait for `want` (the switch on, the sheet in the song's key, and on Data saver the first Play); a failed
 * one is tried again by `retry` (the next Play). A 404 (`BACKING_NOT_FOUND`) is final: the backing has gone.
 */

export interface BackingOrigin {
  /** The finished job the Result came from, while it is fresh. */
  jobId?: string;
  /** The saved sheet. */
  savedId?: string;
  /** The saved sheet may have its backing kept with it: the owner's own upload, never a pasted link. */
  savedKeepsIt: boolean;
  /** An older server's (or a preview's) backing sent inside the result. */
  inlineBase64?: string;
}

export type BackingFileState = "idle" | "loading" | "ready" | "gone" | "failed";

function notFound(e: unknown): boolean {
  return (e as { response?: { status?: number } } | null)?.response?.status === 404;
}

function deleteQuietly(uri: string | null): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Already gone.
  }
}

/** A cache file of its own for this Result, deleted when it closes (Android may also empty the cache folder). */
function writeCache(write: (file: File) => void): string {
  const file = new File(Paths.cache, `notefusion-backing-${Date.now()}-${Math.round(Math.random() * 1e6)}.mp3`);
  write(file);
  return file.uri;
}

export function useBackingFile(
  origin: BackingOrigin | null,
  want: boolean,
): { uri: string | null; state: BackingFileState; retry: () => void } {
  const [uri, setUri] = useState<string | null>(null);
  const [state, setStateValue] = useState<BackingFileState>("idle");
  const stateRef = useRef<BackingFileState>("idle");
  const setState = useCallback((s: BackingFileState) => {
    stateRef.current = s;
    setStateValue(s);
  }, []);
  /** Bumped whenever the origin changes or the Result closes: an answer for an older one is dropped. */
  const generation = useRef(0);
  /** The cache file this Result wrote, deleted on close; a kept file is the offline library's. */
  const cacheUri = useRef<string | null>(null);
  /** The phone has been looked at (inline, kept) before anything is downloaded. */
  const [localChecked, setLocalChecked] = useState(false);
  /** Bumped by `retry`: a failed download is tried again; each attempt runs once. */
  const [attempt, setAttempt] = useState(0);
  const tried = useRef(-1);

  const jobId = origin?.jobId;
  const savedId = origin?.savedId;
  const savedKeepsIt = !!origin?.savedKeepsIt;
  const inline = origin?.inlineBase64;
  const any = !!origin && !!(jobId || (savedId && savedKeepsIt) || inline);

  // What is already on the phone: one sent inline, or one kept with the sheet.
  useEffect(() => {
    const gen = ++generation.current;
    tried.current = -1;
    setUri(null);
    setState("idle");
    setLocalChecked(false);
    if (any && inline) {
      try {
        const written = writeCache((f) => f.write(inline, { encoding: "base64" }));
        cacheUri.current = written;
        setUri(written);
        setState("ready");
      } catch {
        setState("failed");
      }
      setLocalChecked(true);
    } else if (any && savedId && savedKeepsIt) {
      void keptBacking(savedId).then((kept) => {
        if (generation.current !== gen) return;
        if (kept) {
          setUri(kept);
          setState("ready");
        }
        setLocalChecked(true);
      });
    } else {
      setLocalChecked(true);
    }
    return () => {
      generation.current++;
      deleteQuietly(cacheUri.current);
      cacheUri.current = null;
    };
  }, [any, jobId, savedId, savedKeepsIt, inline, setState]);

  // Fetched when wanted, once per attempt.
  useEffect(() => {
    if (!any || !want || !localChecked || inline || tried.current === attempt) return;
    if (stateRef.current !== "idle" && stateRef.current !== "failed") return;
    tried.current = attempt;
    const gen = generation.current;
    setState("loading");
    void (async () => {
      let bytes: Uint8Array | null = null;
      try {
        if (jobId) {
          try {
            bytes = await transcriptionsApi.backing(jobId);
          } catch (e) {
            // The job's copy has gone: a sheet that keeps its own still has it.
            if (!notFound(e) || !(savedId && savedKeepsIt)) throw e;
          }
        }
        if (!bytes && savedId && savedKeepsIt) bytes = await libraryApi.backing(savedId);
      } catch (e) {
        if (generation.current === gen) setState(notFound(e) ? "gone" : "failed");
        return;
      }
      if (generation.current !== gen) return;
      if (!bytes || bytes.byteLength === 0) {
        setState("gone");
        return;
      }
      const got = bytes;
      const kept = savedId && savedKeepsIt ? await rememberBacking(savedId, got) : null;
      if (generation.current !== gen) return;
      try {
        const played = kept ?? writeCache((f) => f.write(got));
        if (!kept) cacheUri.current = played;
        setUri(played);
        setState("ready");
      } catch {
        setState("failed");
      }
    })();
  }, [any, want, localChecked, inline, attempt, jobId, savedId, savedKeepsIt, setState]);

  const retry = useCallback(() => {
    if (stateRef.current === "failed") setAttempt((a) => a + 1);
  }, []);

  return { uri, state, retry };
}
