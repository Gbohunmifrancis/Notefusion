/**
 * The link-info call and the section fields of a linked job, as the API now speaks them.
 *
 * TODO(api area): this is a local shim. `src/api/types.ts` and `src/api/endpoints.ts` are owned
 * by the api area and, in this worktree, do not yet carry `LinkInfoDto`, the
 * `POST /api/transcriptions/link/info` call, `startSeconds`/`endSeconds` on `submitLink` or
 * the section fields on `TranscriptionSource`. Once they do, point `LinkScreen`,
 * `useJobPolling` and `ResultScreen` at them and delete this file.
 */

import { api } from "../api/client";
import type { SubmitOptions } from "../api/endpoints";
import type { TranscriptionJob, TranscriptionSource } from "../api/types";

/** Mirrors the C# `LinkInfoDto`: what the link points at, and how much of it this account may take. */
export interface LinkInfo {
  provider: "youtube" | "spotify" | "apple_music" | string;
  url: string;
  title: string;
  artist: string;
  thumbnailUrl?: string | null;
  /** The whole song's length in seconds; null when the provider does not say. */
  durationSeconds: number | null;
  /** The caller's allowance in seconds: 60 on a free account, 360 on Pro. */
  maxSeconds: number;
}

/** The section fields `TranscriptionSource` gains: what was fetched, and the song's full length. */
export interface SourceSection {
  startSeconds?: number | null;
  endSeconds?: number | null;
  durationSeconds?: number | null;
}

export type LinkSubmitOptions = Pick<SubmitOptions, "mode" | "key" | "tempo" | "keyboardTranspose"> & {
  startSeconds?: number;
  endSeconds?: number;
};

export const linkInfoApi = {
  /** Title, artist, artwork and length behind a song link, before anything is fetched. */
  get: (url: string) =>
    api.post<LinkInfo>("/api/transcriptions/link/info", { url }, { timeout: 20_000 }).then((r) => r.data),

  /** `transcriptionsApi.submitLink` with the chosen section; forwarded as start_seconds/end_seconds. */
  submit: (url: string, opts: LinkSubmitOptions) =>
    api
      .post<TranscriptionJob>(
        "/api/transcriptions/link",
        {
          url,
          mode: opts.mode,
          key: opts.key,
          tempo: opts.tempo,
          keyboardTranspose: opts.keyboardTranspose || undefined,
          startSeconds: opts.startSeconds,
          endSeconds: opts.endSeconds,
          audioPreview: false,
        },
        { timeout: 30_000 },
      )
      .then((r) => r.data),
};

/** The section fields of a job's source, read off the wire whether or not the DTO type names them yet. */
export function sectionFields(source: TranscriptionSource): SourceSection {
  return source as TranscriptionSource & SourceSection;
}
