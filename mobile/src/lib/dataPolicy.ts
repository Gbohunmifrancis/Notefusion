/**
 * What Data saver changes, as pure rules (dataSaver.ts holds the switch). Nothing here may cost a
 * transcription its quality: the recording preset is measured (recordingPreset.ts), and a slower
 * read only delays the moment the screen notices a finish the push reports anyway.
 */

/**
 * How often a running job is read over HTTP when its live stream cannot be held (jobStream.ts): the stream
 * says everything as it happens, so this only runs after three streams in a row have failed.
 */
export function jobFallbackPollMs(dataSaver: boolean): number {
  return dataSaver ? 30_000 : 15_000;
}

/** How often the send queue looks for a connection, and re-reads jobs it has sent, while it holds unfinished takes. */
export function outboxTickMs(dataSaver: boolean): number {
  return dataSaver ? 60_000 : 30_000;
}

/** Profile pictures and song artwork: decoration, so not on data saver. */
export function loadsImages(dataSaver: boolean): boolean {
  return !dataSaver;
}
