/**
 * What Data saver changes, as pure rules (dataSaver.ts holds the switch). Nothing here may cost a
 * transcription its quality: the recording preset is measured (recordingPreset.ts), and a slower
 * poll only delays the moment the screen notices a finish that SignalR and the push report anyway.
 */

/** How often a running job is re-read over HTTP while the record or link screen waits. */
export function jobPollMs(dataSaver: boolean): number {
  return dataSaver ? 5_000 : 2_500;
}

/** How often the send queue looks for a connection, and re-reads jobs it has sent. */
export function outboxTickMs(dataSaver: boolean): number {
  return dataSaver ? 60_000 : 30_000;
}

/** Profile pictures and song artwork: decoration, so not on data saver. */
export function loadsImages(dataSaver: boolean): boolean {
  return !dataSaver;
}
