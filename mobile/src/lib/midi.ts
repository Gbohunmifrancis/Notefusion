/**
 * The sheet as a Standard MIDI File, made on the phone from the notes on screen (note fixes, a transposition, the
 * tempo, meter and key chosen), as the MusicXML export is (`lib/musicxml`). The worker's own MIDI is the recording as
 * first heard, so a MIDI export used to ignore every one of those. Pure, and without imports so its test runs on
 * Node's own type stripping (`midi.test.ts`).
 */

/** Ticks per quarter-note beat; the wire's `startBeat` and `durBeats` are quarter notes. */
export const TICKS_PER_BEAT = 480;

export interface MidiNote {
  pitchMidi: number;
  /** Quarter notes from the start. */
  startBeat: number;
  /** Length in quarter notes. */
  durBeats: number;
}

export interface MidiTrack {
  /** The track's name in a sequencer ("Tune", "Alto"); plain ASCII. */
  name: string;
  notes: readonly MidiNote[];
}

export interface MidiSheet {
  tempoBpm: number;
  /** "3/4"; anything unreadable is written as 4/4. */
  timeSignature: string;
  /** The key signature: sharps positive, flats negative. */
  fifths: number;
  minor: boolean;
  tracks: readonly MidiTrack[];
}

/** A number as MIDI's variable-length quantity: seven bits a byte, high bit set on all but the last. */
export function vlq(value: number): number[] {
  let v = Math.max(0, Math.floor(value));
  const out = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return out;
}

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const ascii = (s: string) => Array.from(s.replace(/[^\x20-\x7e]/g, "?"), (c) => c.charCodeAt(0));

function chunk(type: string, data: number[]): number[] {
  return [...ascii(type), ...u32(data.length), ...data];
}

/** Numerator and the denominator's power of two; 4/4 for anything MIDI cannot say. */
function meter(timeSignature: string): [number, number] {
  const [num, den] = timeSignature.split("/").map(Number);
  const power = den ? Math.log2(den) : NaN;
  if (!num || num < 1 || num > 255 || !Number.isInteger(num) || !Number.isInteger(power) || power < 0 || power > 6) return [4, 2];
  return [num, power];
}

/** Tempo, meter and key, at the start: the conductor track every sequencer reads first. */
function conductor(sheet: MidiSheet): number[] {
  const bpm = Number.isFinite(sheet.tempoBpm) && sheet.tempoBpm > 0 ? sheet.tempoBpm : 120;
  const micros = Math.min(0xffffff, Math.round(60_000_000 / bpm));
  const [num, power] = meter(sheet.timeSignature);
  const fifths = Math.max(-7, Math.min(7, Math.round(sheet.fifths) || 0));
  return [
    0, 0xff, 0x51, 0x03, (micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff,
    0, 0xff, 0x58, 0x04, num, power, 24, 8,
    0, 0xff, 0x59, 0x02, fifths & 0xff, sheet.minor ? 1 : 0,
    0, 0xff, 0x2f, 0x00,
  ];
}

/** One voice on its own channel: its name, a piano, then every note as an on and an off. */
function voice(track: MidiTrack, channel: number): number[] {
  const name = ascii(track.name);
  const events: { tick: number; off: boolean; pitch: number }[] = [];
  for (const n of track.notes) {
    if (!Number.isFinite(n.startBeat) || !Number.isFinite(n.durBeats)) continue;
    const pitch = Math.max(0, Math.min(127, Math.round(n.pitchMidi)));
    const on = Math.max(0, Math.round(n.startBeat * TICKS_PER_BEAT));
    const off = Math.max(on + 1, Math.round((n.startBeat + n.durBeats) * TICKS_PER_BEAT));
    events.push({ tick: on, off: false, pitch }, { tick: off, off: true, pitch });
  }
  // In time order, and at the same tick a note ends before the next begins, so a repeated pitch is re-struck.
  events.sort((a, b) => a.tick - b.tick || Number(b.off) - Number(a.off));
  const data = [0, 0xff, 0x03, ...vlq(name.length), ...name, 0, 0xc0 | channel, 0];
  let at = 0;
  for (const e of events) {
    data.push(...vlq(e.tick - at), (e.off ? 0x80 : 0x90) | channel, e.pitch, e.off ? 0x40 : 0x50);
    at = e.tick;
  }
  data.push(0, 0xff, 0x2f, 0x00);
  return data;
}

/** The whole file: a conductor track, then one track per voice (channels 0 up; never 9, the drums). */
export function midiBytes(sheet: MidiSheet): Uint8Array {
  const tracks = sheet.tracks.slice(0, 9);
  const bytes = [
    ...chunk("MThd", [...u16(1), ...u16(tracks.length + 1), ...u16(TICKS_PER_BEAT)]),
    ...chunk("MTrk", conductor(sheet)),
    ...tracks.flatMap((t, i) => chunk("MTrk", voice(t, i))),
  ];
  return Uint8Array.from(bytes);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** `midiBytes` as base64, the form the share sheet's file is written from. */
export function midiBase64(sheet: MidiSheet): string {
  const bytes = midiBytes(sheet);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    out += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]!;
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)]! : "=";
    out += i + 2 < bytes.length ? B64[c & 63]! : "=";
  }
  return out;
}
