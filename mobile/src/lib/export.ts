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
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import type { HymnCell } from "./choir";

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

/**
 * Shares formatted Tonic Solfa notation as a plain text (.txt) file.
 * Perfect for sharing directly to choir WhatsApp groups, email, or notes.
 */
export async function exportSolfa(
  solfaLines: string[],
  title: string,
  meta?: { key?: string; tempo?: number; timeSignature?: string },
): Promise<ExportOutcome> {
  if (!solfaLines || solfaLines.length === 0) {
    return {
      ok: false,
      reason: "empty",
      message: "This transcription has no solfa notation to export.",
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
    const file = new File(Paths.cache, `${safeFileName(title)}-solfa.txt`);
    if (file.exists) file.delete();

    const header = [
      `=== ${title.toUpperCase()} ===`,
      meta?.key ? `Key: ${meta.key}` : null,
      meta?.timeSignature ? `Time: ${meta.timeSignature}` : null,
      meta?.tempo ? `Tempo: ${meta.tempo} BPM` : null,
      "Transcribed with NoteFusion",
      "----------------------------------------",
      "",
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

    const content = `${header}${solfaLines.join("\n")}\n`;
    file.write(content);

    await Sharing.shareAsync(file.uri, {
      mimeType: "text/plain",
      dialogTitle: `Share Tonic Solfa: ${title}`,
      UTI: "public.plain-text",
    });

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: "failed",
      message: e instanceof Error ? e.message : "Could not export solfa text.",
    };
  }
}

/**
 * Shares base64 MIDI payload as a standard .mid file.
 * Lets users open the transcription in DAWs, MIDI players, or notation software.
 */
export async function exportMidi(
  midiBase64: string,
  title: string,
): Promise<ExportOutcome> {
  if (!midiBase64?.trim()) {
    return {
      ok: false,
      reason: "empty",
      message: "This transcription has no MIDI data attached.",
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
    const file = new File(Paths.cache, `${safeFileName(title)}.mid`);
    if (file.exists) file.delete();
    file.write(midiBase64, { encoding: "base64" });

    await Sharing.shareAsync(file.uri, {
      mimeType: "audio/midi",
      dialogTitle: `Export MIDI: ${title}`,
      UTI: "public.midi-audio",
    });

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: "failed",
      message: e instanceof Error ? e.message : "Could not export MIDI file.",
    };
  }
}



/** What the PDF says about the piece above and below the stave. */
export interface PdfMeta {
  title: string;
  /** The acknowledgement line for a linked song, e.g. "Way Maker — Sinach (YouTube)". */
  credit?: string | null;
  key: string;
  tempoBpm: number;
  timeSignature: string;
  /** The solfa lines, printed on their own page after the stave. */
  solfaLines?: readonly string[];
  /** Hymn-book layout — a lyric syllable under each solfa cell — printed instead of the bare lines when the sheet has words. */
  hymn?: HymnCell[][][];
  /** The four parts' solfa, one block per voice. */
  parts?: readonly { name: string; lines: readonly string[] }[];
}

function hymnHtml(rows: HymnCell[][][]): string {
  return rows
    .map(
      (bars) =>
        `<table class="hymn"><tr>${bars
          .map((bar) => `<td class="bar">${bar.map((c) => `<span class="cell"><b>${escapeHtml(c.solfa)}</b><i>${escapeHtml(c.lyric)}</i></span>`).join("")}</td>`)
          .join("")}</tr></table>`,
    )
    .join("");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Shares the engraved stave as an A4 PDF. The SVG is the one the screen shows
 * (`ScoreView.getSvg`), so the paper matches the phone; the header names the piece
 * and the footer credits the song and NoteFusion. A Pro feature — the caller gates it.
 */
export async function exportPdf(svg: string, meta: PdfMeta): Promise<ExportOutcome> {
  if (!svg.trim()) {
    return { ok: false, reason: "empty", message: "The stave has not been drawn yet. Open the Staff view and try again." };
  }
  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, reason: "unavailable", message: "Sharing isn't available on this device." };
  }

  // Let the SVG fill the printable width; OSMD sets absolute pixel dimensions.
  const scaled = svg
    .replace(/<svg([^>]*)\swidth="[^"]*"/, "<svg$1")
    .replace(/<svg([^>]*)\sheight="[^"]*"/, "<svg$1")
    .replace(/<svg/, '<svg style="width:100%;height:auto"');
  const credit = meta.credit ? escapeHtml(meta.credit) : "";
  const hymn = meta.hymn && meta.hymn.length > 0 ? hymnHtml(meta.hymn) : "";
  const solfa = hymn
    ? `<div>${escapeHtml(meta.solfaLines?.[0] ?? "")}</div>${hymn}`
    : (meta.solfaLines ?? []).map((l) => `<div>${escapeHtml(l)}</div>`).join("");
  const parts = (meta.parts ?? [])
    .filter((p) => p.lines.length > 1)
    .map((p) => `<h3>${escapeHtml(p.name)}</h3>${p.lines.slice(1).map((l) => `<div>${escapeHtml(l)}</div>`).join("")}`)
    .join("");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 14mm 12mm 16mm; }
  body { font-family: -apple-system, Roboto, "Segoe UI", sans-serif; color: #0F172A; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; letter-spacing: -0.01em; }
  .sub { font-size: 11px; color: #5D6D82; margin: 0 0 10px; }
  .credit { font-size: 10px; color: #5D6D82; margin: 0 0 12px; }
  .sheet svg { width: 100%; height: auto; }
  .solfa { page-break-before: always; font-family: ui-monospace, Menlo, monospace; font-size: 13px; line-height: 1.9; white-space: pre-wrap; }
  .solfa h2 { font-family: -apple-system, Roboto, sans-serif; font-size: 14px; margin: 0 0 8px; }
  .solfa h3 { font-family: -apple-system, Roboto, sans-serif; font-size: 11px; margin: 14px 0 4px; color: #5D6D82; text-transform: uppercase; letter-spacing: .06em; }
  table.hymn { border-collapse: collapse; margin: 6px 0 10px; width: 100%; }
  table.hymn td.bar { border-left: 1.5px solid #0F172A; padding: 2px 6px; vertical-align: top; white-space: nowrap; }
  table.hymn td.bar:last-child { border-right: 1.5px solid #0F172A; }
  .cell { display: inline-block; min-width: 2.6em; text-align: center; margin-right: 2px; }
  .cell b { display: block; font-weight: 700; font-size: 13px; }
  .cell i { display: block; font-style: normal; font-family: -apple-system, Roboto, sans-serif; font-size: 10px; color: #334155; min-height: 12px; }
  .foot { position: fixed; bottom: 0; left: 0; right: 0; font-size: 9px; color: #94A3B8; }
</style></head><body>
<h1>${escapeHtml(meta.title)}</h1>
<p class="sub">${escapeHtml(meta.key)} · ${meta.tempoBpm} BPM · ${escapeHtml(meta.timeSignature)}</p>
${credit ? `<p class="credit">${credit}</p>` : ""}
<div class="sheet">${scaled}</div>
${solfa ? `<div class="solfa"><h2>Tonic Solfa</h2>${solfa}${parts}</div>` : ""}
<div class="foot">${credit ? credit + " · " : ""}Transcribed with NoteFusion · notefusion.studio</div>
</body></html>`;

  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    const file = new File(Paths.cache, `${safeFileName(meta.title)}.pdf`);
    if (file.exists) file.delete();
    new File(uri).move(file);
    await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle: meta.title });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "failed", message: e instanceof Error ? e.message : "Could not create the PDF." };
  }
}
