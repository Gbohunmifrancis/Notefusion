// A Standard MIDI File reader, for the CCEH importer (cceh.mjs). The file is data: its bytes are read
// here and never handed to anything that plays or runs it. Only what a hymn score needs is kept:
// notes (track, channel, pitch, start and end in ticks), time and key signatures, tempo and track names.

/**
 * Reads a MIDI file (Buffer / Uint8Array). Returns {format, division, tracks: [{index, name, notes}], timeSigs,
 * keySigs, tempos, copyright, texts}: notes are {track, channel, pitch, start, end, velocity} in ticks.
 */
export function parseMidi(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let p = 0;
  const str = (n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(b[p + i]); return s; };
  const u32 = () => { const v = (b[p] << 24 >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3]; p += 4; return v; };
  const u16 = () => { const v = (b[p] << 8) + b[p + 1]; p += 2; return v; };
  if (b.length < 14 || str(4) !== "MThd") throw new Error("not a MIDI file (no MThd header)");
  p = 4;
  const headerLen = u32();
  const format = u16(), nTracks = u16(), division = u16();
  if (division & 0x8000) throw new Error("SMPTE time division is not supported");
  p = 8 + headerLen;
  const tracks = [], timeSigs = [], keySigs = [], tempos = [], copyright = [], texts = [];
  for (let t = 0; t < nTracks && p + 8 <= b.length; t++) {
    if (str(4) !== "MTrk") throw new Error(`track ${t + 1}: no MTrk chunk`);
    p += 4;
    const len = u32();
    const end = Math.min(b.length, p + len);
    const track = { index: t, name: "", notes: [] };
    const open = new Map(); // "ch:pitch" → [note…] (a stack: the same key struck again before release)
    let tick = 0, status = 0;
    const vlq = () => { let v = 0; for (let i = 0; i < 4; i++) { const c = b[p++]; v = (v << 7) | (c & 0x7f); if (!(c & 0x80)) break; } return v; };
    while (p < end) {
      tick += vlq();
      let s = b[p];
      if (s & 0x80) { p++; if (s < 0xf0) status = s; } else s = status; // running status
      if (s === 0xff) {
        const type = b[p++], n = vlq(), data = b.subarray(p, p + n);
        p += n;
        if (type === 0x2f) break;
        if (type === 0x03 && !track.name) track.name = String.fromCharCode(...data).trim();
        else if (type === 0x02) copyright.push(String.fromCharCode(...data).trim());
        else if (type === 0x01) texts.push(String.fromCharCode(...data).trim());
        else if (type === 0x58 && n >= 2) timeSigs.push({ tick, num: data[0], den: 2 ** data[1] });
        else if (type === 0x59 && n >= 2) keySigs.push({ tick, sf: data[0] > 127 ? data[0] - 256 : data[0], minor: data[1] === 1 });
        else if (type === 0x51 && n === 3) tempos.push({ tick, usPerQuarter: (data[0] << 16) + (data[1] << 8) + data[2] });
        continue;
      }
      if (s === 0xf0 || s === 0xf7) { const n = vlq(); p += n; continue; }
      const kind = s & 0xf0, ch = s & 0x0f;
      if (kind === 0xc0 || kind === 0xd0) { p += 1; continue; }
      const d1 = b[p++], d2 = b[p++];
      if (kind === 0x90 && d2 > 0) {
        const note = { track: t, channel: ch, pitch: d1, start: tick, end: null, velocity: d2 };
        const k = `${ch}:${d1}`;
        if (!open.has(k)) open.set(k, []);
        open.get(k).push(note);
        track.notes.push(note);
      } else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
        const stack = open.get(`${ch}:${d1}`);
        if (stack && stack.length) stack.shift().end = tick;
      }
    }
    for (const stack of open.values()) for (const n of stack) if (n.end == null) n.end = tick;
    p = end;
    tracks.push(track);
  }
  return { format, division, tracks, timeSigs, keySigs, tempos, copyright, texts };
}
