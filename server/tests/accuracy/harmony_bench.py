"""Harmony benchmark: our SATB under a hymn tune against the hymn book's own four parts.

    python -m tests.accuracy.harmony_bench                 # dev and test tables, the named hymns
    python -m tests.accuracy.harmony_bench --split test    # the held-out tunes only
    python -m tests.accuracy.harmony_bench --build CACHE   # re-derive the fixture from a CCEH crawl

The yardstick is ``harmony_book.json``: four-part harmonisations from the Christian Classics
Ethereal Hymnary (ccel.org/cceh, public domain: "free to use in any manner"), read from
CCEH's MIDI files.  Those files are exported from Noteworthy Composer scores, two staves of
two voices each (soprano and alto as the treble's chords, tenor and bass as the bass's), so
each staff is split into its upper and lower voice (``split_staff``); the tune's key, time
signature and pickup come from our own tune page (``content/hymns/tunes``), and a tune is kept
only when the MIDI's soprano is that page's melody note for note.  The fixture is the derived
four parts alone, so the bench runs without the crawl.

Our harmoniser is given each book soprano (in the book's key, meter and bar phase) and its
alto, tenor and bass are measured beside the book's:

  motion       per voice: distinct pitches, share of repeated notes, longest run of one
               pitch, mean |interval| and leap share (more than a fourth), range used, and
               contour changes (direction reversals, per note).
  correctness  parallel fifths and octaves between any two voices; hidden fifths and octaves
               on the outer voices (similar motion into one, the soprano leaping); voice
               crossing and overlap; S-A and A-T further apart than an octave; notes outside
               our ranges.  Counted per 100 sonorities (onsets).
  chords       the share of beats on which our chord is the book's (root and quality, V7 as V;
               the book's read off its four parts at the beat).

Each tune is ``dev`` or ``test`` by ``hymn_corpus.split_of`` (the hymn corpus's frozen split);
tune the harmoniser on dev, report test.  Measurement only, never run by ``pytest``;
``tests/test_harmony.py`` reads the fixture for its checks on the named hymns.
"""

from __future__ import annotations

import argparse
import json
import statistics
from dataclasses import dataclass
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent / "harmony_book.json"
VOICES = ("soprano", "alto", "tenor", "bass")
LOWER = ("alto", "tenor", "bass")
# Hymns we know by name, reported one by one (tenor distinct pitches, the tenor in solfa).
NAMED = ("new-britain", "azmon", "old-hundredth", "nicaea", "belmont")
MAX_TUNES = 48
SIMPLE_TIMES = ("4/4", "3/4", "2/2", "3/2", "2/4")


# ── Reading CCEH's MIDI ───────────────────────────────────────────────────────


def _midi_notes(path: Path) -> tuple[list[list[tuple[int, float, float]]], int]:
    """Per track, (pitch, start, end) in quarter beats; and the ticks a beat."""
    import mido

    mid = mido.MidiFile(str(path))
    tpb = mid.ticks_per_beat
    tracks = []
    for track in mid.tracks:
        t, on, notes = 0, {}, []
        for msg in track:
            t += msg.time
            if msg.type == "note_on" and msg.velocity > 0 and msg.channel != 9:
                on.setdefault(msg.note, []).append(t)
            elif msg.type in ("note_off", "note_on") and msg.channel != 9 and on.get(msg.note):
                s = on[msg.note].pop(0)
                notes.append((msg.note, s / tpb, t / tpb))
        if notes:
            tracks.append(sorted(notes, key=lambda n: (n[1], -n[0])))
    return tracks, tpb


def split_staff(notes: list[tuple[int, float, float]], tol: float = 0.06) -> tuple[list, list]:
    """A two-voice staff as its upper and lower voice, each [(pitch, start, end)].

    At each onset: two notes starting are the two voices; one note starting goes to the voice
    that is free (the other is holding), or to both when both are free (a unison written as
    one note).  Notes sound a little shorter than written, so a voice is free once its note
    has ended by ``tol`` beats after the onset.
    """
    upper: list[list] = []
    lower: list[list] = []
    onsets = sorted({round(s, 4) for _p, s, _e in notes})
    for t in onsets:
        starting = sorted({p for p, s, _e in notes if abs(s - t) < 1e-3}, reverse=True)
        ends = {p: max(e for q, s, e in notes if q == p and abs(s - t) < 1e-3) for p in starting}
        free_u = not upper or upper[-1][2] <= t + tol
        free_l = not lower or lower[-1][2] <= t + tol
        if len(starting) >= 2:
            hi, lo = starting[0], starting[-1]
            for v, p in ((upper, hi), (lower, lo)):
                if v and v[-1][2] > t:
                    v[-1][2] = t
                v.append([p, t, ends[p]])
            continue
        p = starting[0]
        if free_u and free_l:
            targets = (upper, lower)
        elif free_u:
            targets = (upper,)
        elif free_l:
            targets = (lower,)
        else:
            targets = (min((upper, lower), key=lambda v: abs(v[-1][0] - p)),)
        for v in targets:
            if v and v[-1][2] > t:
                v[-1][2] = t
            v.append([p, t, ends[p]])
    return upper, lower


def _written(line: list[list], end_of_tune: float) -> list[tuple[int, float, float]]:
    """Sounding lengths back to written ones: a note lasts to the voice's next onset when the
    gap before it is a release (under a quarter of a beat or a third of the note), and the
    last note to the end of the tune."""
    out = []
    for i, (p, s, e) in enumerate(line):
        nxt = line[i + 1][1] if i + 1 < len(line) else end_of_tune
        gap = nxt - e
        end = nxt if gap <= max(0.26, (e - s) / 3) else round(e * 4) / 4
        out.append((int(p), round(s, 4), round(end - s, 4)))
    return out


@dataclass
class BookTune:
    slug: str
    number: str
    split: str
    tonic: int
    mode: str
    time: str
    parts: dict[str, list[tuple[int, float, float]]]  # bar 0 starts at beat 0


def _edits(a: list[int], b: list[int]) -> int:
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i]
        for j in range(1, len(b) + 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1])))
        prev = cur
    return prev[-1]


def _read_tune(slug: str, tune: dict, midi: Path, loose: bool = False) -> tuple[BookTune | None, str]:
    """The book's four parts for one tune page, or (None, why not).

    ``loose`` is for a named hymn our page holds from another source: the MIDI's own
    rhythm and time signature are kept (CCEH's may be in other note values, or another
    version), its pitches need only be the page's within one edit in six, and the pickup is
    the page's scaled by the ratio of the two first notes' lengths.
    """
    import mido

    from tests.accuracy.hymn_corpus import _parse_key, parse_melody, split_of

    melody = parse_melody(tune["melody"], tune["time"], tune.get("pickup") or 0)
    tracks, _tpb = _midi_notes(midi)
    if len(tracks) != 2:
        return None, f"{len(tracks)} staves"
    staves = sorted(tracks, key=lambda ns: -statistics.mean(p for p, _s, _e in ns))
    s, a = split_staff(staves[0])
    t, b = split_staff(staves[1])
    end = max(e for ns in tracks for _p, _s, e in ns)
    end = -(-end * 4 // 1) / 4  # up to the next sixteenth
    want = [n.pitch_midi for n in melody.notes]
    have = [p for p, _s, _e in s]
    shift = have[0] - want[0]
    time = tune["time"]
    if loose:
        if _edits(have, [w + shift for w in want]) > max(1, len(want) // 6):
            return None, "soprano is not the page's melody"
        sig = next((m for tr in mido.MidiFile(str(midi)).tracks for m in tr if m.type == "time_signature"), None)
        if sig is not None:
            time = f"{sig.numerator}/{sig.denominator}"
        bpb = sig.numerator * 4 / sig.denominator if sig is not None else melody.bpb
        first_have = s[1][1] - s[0][1]
        first_want = melody.notes[1].start_beat - melody.notes[0].start_beat
        pickup = melody.pickup * first_have / first_want
        origin = s[0][1] - ((bpb - pickup) % bpb)
    else:
        if len(have) != len(want):
            return None, f"soprano has {len(have)} notes, the page {len(want)}"
        if any(h - w != shift for h, w in zip(have, want)):
            return None, "soprano is not the page's melody"
        origin = s[0][1] - melody.notes[0].start_beat  # MIDI beat of bar 0
        if any(abs((x[1] - origin) - n.start_beat) > 0.05 for x, n in zip(s, melody.notes)):
            return None, "soprano rhythm differs from the page's"
    parts = {}
    for name, line in zip(VOICES, (s, a, t, b)):
        parts[name] = [(p, round(st - origin, 4), d) for p, st, d in _written(line, end)]
    # Voices in order at most onsets, or the staff split went wrong.
    bad = 0
    total = 0
    for x in _sonorities(parts):
        total += 1
        if not (x[0] >= x[1] >= x[2] >= x[3]):
            bad += 1
    if bad > 0.08 * total:
        return None, f"voices out of order at {bad} of {total} onsets"
    tonic, mode = _parse_key(tune["key"])
    return BookTune(slug, midi.stem[:6], split_of(slug), (tonic + shift) % 12, mode, time, parts), ""


def build(cache: Path, out: Path = FIXTURE) -> None:
    """Re-derive ``harmony_book.json`` from a CCEH crawl (``files/*.mid``)."""
    repo = Path(__file__).resolve().parents[3]
    tunes_dir = repo / "content" / "hymns" / "tunes"
    # The named hymns' CCEH numbers, for tunes our pages hold from another source.
    extra = {"nicaea": "000001", "old-hundredth": "000006", "azmon": "000069", "new-britain": "000165"}
    rows, skipped = [], []
    for f in sorted(tunes_dir.glob("*.json")):
        tune = json.loads(f.read_text(encoding="utf-8"))
        slug = f.stem
        src = str(tune.get("importedFrom") or "")
        number = src.split(":", 1)[1] if src.startswith("cceh:") else extra.get(slug)
        if not number or not tune.get("melody") or tune["time"] not in SIMPLE_TIMES:
            continue
        midi = cache / "files" / f"{number}a.mid"
        if not midi.is_file():
            continue
        book, why = _read_tune(slug, tune, midi, loose=not src.startswith("cceh:"))
        if book is None:
            skipped.append((slug, why))
            continue
        rows.append(book)
    named = [r for r in rows if r.slug in NAMED]
    rest = [r for r in rows if r.slug not in NAMED][: MAX_TUNES - len(named)]
    keep = sorted(named + rest, key=lambda r: r.slug)
    data = {
        "source": "Christian Classics Ethereal Hymnary (ccel.org/cceh), four-part MIDI files; public domain "
                  "(\"free to use in any manner\"). Derived by tests/accuracy/harmony_bench.py --build.",
        "format": "each part is 'pitch@start+dur' tokens, MIDI pitch, quarter beats, bar 0 at beat 0",
        "tunes": [
            {"slug": r.slug, "cceh": r.number, "split": r.split, "tonic": r.tonic, "mode": r.mode, "time": r.time,
             "parts": {v: " ".join(f"{p}@{_num(s)}+{_num(d)}" for p, s, d in r.parts[v]) for v in VOICES}}
            for r in keep
        ],
    }
    with out.open("w", encoding="utf-8") as fh:
        fh.write("{\n")
        fh.write(f'  "source": {json.dumps(data["source"])},\n  "format": {json.dumps(data["format"])},\n  "tunes": [\n')
        fh.write(",\n".join("    " + json.dumps(t, separators=(",", ":")) for t in data["tunes"]))
        fh.write("\n  ]\n}\n")
    print(f"kept {len(keep)} of {len(rows)} readable tunes; skipped {len(skipped)}:")
    for slug, why in skipped:
        print(f"  {slug}: {why}")


def _num(x: float) -> str:
    return f"{x:g}"


def load() -> list[BookTune]:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    out = []
    for t in data["tunes"]:
        parts = {}
        for v in VOICES:
            notes = []
            for tok in t["parts"][v].split():
                p, rest = tok.split("@")
                s, d = rest.split("+")
                notes.append((int(p), float(s), float(d)))
            parts[v] = notes
        out.append(BookTune(t["slug"], t["cceh"], t["split"], t["tonic"], t["mode"], t["time"], parts))
    return out


# ── Ours ──────────────────────────────────────────────────────────────────────


def ours(book: BookTune) -> tuple[dict[str, list[tuple[int, float, float]]], list, dict]:
    """Our four parts under the book's soprano: (parts, chord spans, solfa by part)."""
    from app.pipeline import harmony, solfa
    from app.pipeline.transcriber import TranscribedNote

    doh = solfa.doh_pitch_class(book.tonic, book.mode)
    sop = book.parts["soprano"]
    ref = solfa.reference_doh([p for p, _s, _d in sop], doh, book.mode)
    melody = []
    for p, s, d in sop:
        syl, mark, degree = solfa.syllable(p, doh, ref)
        melody.append(TranscribedNote(p, s, d, degree, syl, mark, 1.0))
    res = harmony.harmonise(melody, book.tonic, book.mode, doh_pc=doh, ref_doh=ref, time_signature=book.time)
    parts = {v: [(n.pitch_midi, n.start_beat, n.dur_beats) for n in res.parts[v]] for v in VOICES}
    solfas = {v: [n.solfa + n.octave_mark for n in res.parts[v]] for v in VOICES}
    return parts, res.chords, solfas


def book_solfa(book: BookTune, voice: str) -> list[str]:
    from app.pipeline import solfa

    doh = solfa.doh_pitch_class(book.tonic, book.mode)
    ref = solfa.reference_doh([p for p, _s, _d in book.parts["soprano"]], doh, book.mode)
    out = []
    for p, _s, _d in book.parts[voice]:
        syl, mark, _deg = solfa.syllable(p, doh, ref)
        out.append(syl + mark)
    return out


# ── Measures ──────────────────────────────────────────────────────────────────


def _sonorities(parts: dict[str, list[tuple[int, float, float]]]) -> list[tuple[int, int, int, int]]:
    """(S, A, T, B) at every onset of any voice where all four sound."""
    onsets = sorted({s for v in VOICES for _p, s, _d in parts[v]})
    out = []
    for t in onsets:
        row = []
        for v in VOICES:
            p = next((p for p, s, d in parts[v] if s <= t + 1e-6 < s + d - 1e-6), None)
            if p is None:
                break
            row.append(p)
        else:
            out.append(tuple(row))
    # Consecutive identical sonorities are one (nothing moved).
    return [x for i, x in enumerate(out) if i == 0 or x != out[i - 1]]


def motion(line: list[tuple[int, float, float]]) -> dict[str, float]:
    ps = [p for p, _s, _d in line]
    if len(ps) < 2:
        return {}
    steps = [b - a for a, b in zip(ps, ps[1:])]
    run = best = 1
    for a, b in zip(ps, ps[1:]):
        run = run + 1 if a == b else 1
        best = max(best, run)
    moves = [s for s in steps if s]
    turns = sum(1 for a, b in zip(moves, moves[1:]) if (a > 0) != (b > 0))
    return {
        "distinct": len(set(ps)),
        "repeat": sum(1 for s in steps if s == 0) / len(steps),
        "longest": best,
        "mean_int": statistics.mean(abs(s) for s in steps),
        "leap": sum(1 for s in steps if abs(s) > 5) / len(steps),
        "range": max(ps) - min(ps),
        "contour": turns / len(ps),
        # A leap and straight back (x y x, a third or more away): an arpeggio, not a line.
        "zigzag": sum(1 for x, y, z in zip(ps, ps[1:], ps[2:]) if x == z and abs(y - x) >= 3) / len(ps),
    }


def errors(parts: dict[str, list[tuple[int, float, float]]], tonic: int, mode: str) -> dict[str, float]:
    from app.pipeline import harmony

    rows = _sonorities(parts)
    n = max(len(rows), 1)
    par = hid = cross = over = space = 0
    for prev, cur in zip(rows, rows[1:]):
        for i in range(4):
            for j in range(i + 1, 4):
                if harmony._parallel((prev[i], prev[j]), (cur[i], cur[j])):
                    par += 1
        # Hidden fifths / octaves, outer voices: similar motion into a perfect interval, the soprano leaping.
        ds, db = cur[0] - prev[0], cur[3] - prev[3]
        if ds * db > 0 and abs(ds) > 2 and (cur[0] - cur[3]) % 12 in (0, 7) and (prev[0] - prev[3]) % 12 != (cur[0] - cur[3]) % 12:
            hid += 1
        for i in range(3):
            if cur[i + 1] > prev[i] or cur[i] < prev[i + 1]:
                over += 1
    for x in rows:
        cross += sum(1 for i in range(3) if x[i + 1] > x[i])
        space += (x[0] - x[1] > 12) + (x[1] - x[2] > 12)
    ranges = {"alto": harmony.ALTO_RANGE, "tenor": harmony.TENOR_RANGE, "bass": harmony.BASS_RANGE}
    out_of = sum(1 for v, (lo, hi) in ranges.items() for p, _s, _d in parts[v] if not lo <= p <= hi)
    # Texture, read the same way off both: the triad each sonority spells (``book_chord``),
    # how often its fifth is in the bass (a six-four), and lower-voice notes outside it.
    six_four = nct = 0
    for x in rows:
        spelled = book_chord([p % 12 for p in x], x[3], tonic, mode)
        if spelled is None:
            continue
        root = (tonic + spelled[0]) % 12
        tones = {(root + i) % 12 for i in _QUALITY[spelled[1]]}
        six_four += (x[3] - root) % 12 in (6, 7)
        nct += sum(1 for p in x[1:] if p % 12 not in tones)
    per = 100.0 / n
    return {"parallels": par * per, "hidden": hid * per, "crossing": cross * per, "overlap": over * per,
            "spacing": space * per, "range": out_of * per, "six_four": six_four * per, "nct": nct * per}


_TRIADS = {
    # (root offset from tonic, quality) as our chord names have them; V7 is read as V.
    "major": {"I": (0, "M"), "ii": (2, "m"), "iii": (4, "m"), "IV": (5, "M"), "V": (7, "M"), "V7": (7, "M"),
              "vi": (9, "m"), "vii°": (11, "d")},
    "minor": {"i": (0, "m"), "ii°": (2, "d"), "III": (3, "M"), "iv": (5, "m"), "V": (7, "M"), "V7": (7, "M"),
              "VI": (8, "M"), "VII": (10, "M")},
}
_QUALITY = {"M": (0, 4, 7), "m": (0, 3, 7), "d": (0, 3, 6)}


def book_chord(pcs: list[int], bass: int, tonic: int, mode: str) -> tuple[int, str] | None:
    """The diatonic triad the four sounding pitch classes spell best (bass breaks ties), as (root, quality)."""
    best, arg = 0.0, None
    for root_off, q in sorted(set(_TRIADS[mode].values())):
        chord = {(tonic + root_off + i) % 12 for i in _QUALITY[q]}
        hit = sum(1 for p in pcs if p in chord) - 0.5 * sum(1 for p in pcs if p not in chord)
        hit += 0.25 * (bass % 12 == (tonic + root_off) % 12) + 0.1 * (len(chord & set(pcs)) == 3)
        if hit > best:
            best, arg = hit, (root_off, q)
    return arg


def chord_agreement(book: BookTune, chords: list) -> tuple[float, float, float]:
    """On the beats with a note in every voice: the share where our chord's root and quality
    are the book's, and how often ours and the book's change chord from one beat to the next."""
    end = max(s + d for s, d, _c in chords)
    same = total = 0
    changes = {"ours": 0, "book": 0}
    last: dict[str, object] = {"ours": None, "book": None}
    beat = 0.0
    while beat < end - 1e-6:
        sounding = []
        for v in VOICES:
            p = next((p for p, s, d in book.parts[v] if s <= beat + 1e-6 < s + d - 1e-6), None)
            sounding.append(p)
        mine = next((c for s, d, c in chords if s <= beat + 1e-6 < s + d), None)
        if None not in sounding and mine is not None:
            theirs = book_chord([p % 12 for p in sounding], sounding[3], book.tonic, book.mode)
            total += 1
            same += _TRIADS[book.mode].get(mine) == theirs
            for who, c in (("ours", _TRIADS[book.mode].get(mine)), ("book", theirs)):
                changes[who] += last[who] is not None and c != last[who]
                last[who] = c
        beat += 1.0
    if not total:
        return 0.0, 0.0, 0.0
    return same / total, changes["ours"] / total, changes["book"] / total


# ── Report ────────────────────────────────────────────────────────────────────

MOTION_KEYS = ("distinct", "repeat", "longest", "mean_int", "leap", "range", "contour", "zigzag")
ERROR_KEYS = ("parallels", "hidden", "crossing", "overlap", "spacing", "range", "six_four", "nct")


def measure(tunes: list[BookTune]) -> dict:
    """Mean motion per voice (ours, book), mean error rates (ours, book), chord agreement."""
    acc = {who: {v: {k: [] for k in MOTION_KEYS} for v in LOWER} for who in ("ours", "book")}
    err = {who: {k: [] for k in ERROR_KEYS} for who in ("ours", "book")}
    agree, change_ours, change_book = [], [], []
    for t in tunes:
        mine, chords, _s = ours(t)
        for who, parts in (("ours", mine), ("book", t.parts)):
            for v in LOWER:
                for k, x in motion(parts[v]).items():
                    acc[who][v][k].append(x)
            for k, x in errors(parts, t.tonic, t.mode).items():
                err[who][k].append(x)
        same, ch_ours, ch_book = chord_agreement(t, chords)
        agree.append(same)
        change_ours.append(ch_ours)
        change_book.append(ch_book)
    mean = lambda xs: statistics.mean(xs) if xs else 0.0  # noqa: E731
    return {
        "motion": {who: {v: {k: mean(xs) for k, xs in d.items()} for v, d in vs.items()} for who, vs in acc.items()},
        "errors": {who: {k: mean(xs) for k, xs in d.items()} for who, d in err.items()},
        "chords": mean(agree),
        "changes": {"ours": mean(change_ours), "book": mean(change_book)},
        "n": len(tunes),
    }


def _table(m: dict) -> str:
    lines = [f"  {'':10s}" + "".join(f"{k:>10s}" for k in MOTION_KEYS)]
    for v in LOWER:
        for who in ("ours", "book"):
            row = m["motion"][who][v]
            lines.append(f"  {v[:5] + ' ' + who:10s}" + "".join(f"{row[k]:10.2f}" for k in MOTION_KEYS))
    lines.append("")
    lines.append(f"  {'per 100':10s}" + "".join(f"{k:>10s}" for k in ERROR_KEYS))
    for who in ("ours", "book"):
        row = m["errors"][who]
        lines.append(f"  {who:10s}" + "".join(f"{row[k]:10.2f}" for k in ERROR_KEYS))
    lines.append(f"  chord agreement with the book: {m['chords']:.3f}; chord changes a beat: ours "
                 f"{m['changes']['ours']:.2f}, book {m['changes']['book']:.2f}")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--build", type=Path, help="a CCEH crawl cache (with files/*.mid) to re-derive the fixture from")
    ap.add_argument("--split", choices=("dev", "test"), default="")
    ap.add_argument("--json", action="store_true", help="print the measures as JSON")
    args = ap.parse_args()
    if args.build:
        build(args.build)
        return
    tunes = load()
    report = {}
    for split in ("dev", "test"):
        if args.split and split != args.split:
            continue
        chosen = [t for t in tunes if t.split == split]
        report[split] = measure(chosen)
        if not args.json:
            print(f"── {split}: {len(chosen)} tunes " + "─" * 40)
            print(_table(report[split]))
    named = {}
    for t in tunes:
        if t.slug not in NAMED:
            continue
        mine, _c, sol = ours(t)
        named[t.slug] = {
            "tenor_distinct_ours": len({p for p, _s, _d in mine["tenor"]}),
            "tenor_distinct_book": len({p for p, _s, _d in t.parts["tenor"]}),
            "alto_distinct_ours": len({p for p, _s, _d in mine["alto"]}),
            "alto_distinct_book": len({p for p, _s, _d in t.parts["alto"]}),
            "tenor_ours": " ".join(sol["tenor"][:24]),
            "tenor_book": " ".join(book_solfa(t, "tenor")[:24]),
        }
    pages = {slug: page_parts(slug) for slug in NAMED if page_parts(slug)}
    if args.json:
        print(json.dumps({"splits": report, "named": named, "pages": pages}, indent=1))
        return
    print("── named hymns, under CCEH's soprano " + "─" * 20)
    for slug, row in named.items():
        print(f"  {slug}: tenor {row['tenor_distinct_ours']} pitches (book {row['tenor_distinct_book']}), "
              f"alto {row['alto_distinct_ours']} (book {row['alto_distinct_book']})")
        print(f"    ours  {row['tenor_ours']}")
        print(f"    book  {row['tenor_book']}")
    print("── named hymns, under our hymn page's melody " + "─" * 12)
    for slug, row in pages.items():
        print(f"  {slug}: distinct pitches alto {row['alto_distinct']}, tenor {row['tenor_distinct']}, "
              f"bass {row['bass_distinct']}")
        print(f"    tenor  {row['tenor']}")


def page_parts(slug: str) -> dict | None:
    """Our parts under the melody of our own hymn page for ``slug`` (key, meter and pickup as
    published), or None when the page is not there."""
    from app.pipeline import harmony, solfa
    from app.pipeline.transcriber import TranscribedNote
    from tests.accuracy.hymn_corpus import TUNES_DIR, _parse_key, parse_melody

    path = TUNES_DIR / f"{slug}.json"
    if not path.is_file():
        return None
    tune = json.loads(path.read_text(encoding="utf-8"))
    melody = parse_melody(tune["melody"], tune["time"], tune.get("pickup") or 0)
    tonic, mode = _parse_key(tune["key"])
    doh = solfa.doh_pitch_class(tonic, mode)
    ref = solfa.reference_doh([n.pitch_midi for n in melody.notes], doh, mode)
    notes = []
    for n in melody.notes:
        syl, mark, degree = solfa.syllable(n.pitch_midi, doh, ref)
        notes.append(TranscribedNote(n.pitch_midi, n.start_beat, n.dur_beats, degree, syl, mark, 1.0))
    res = harmony.harmonise(notes, tonic, mode, doh_pc=doh, ref_doh=ref, time_signature=tune["time"])
    out = {f"{v}_distinct": len({n.pitch_midi for n in res.parts[v]}) for v in LOWER}
    out["tenor"] = " ".join(n.solfa + n.octave_mark for n in res.parts["tenor"][:28])
    return out


if __name__ == "__main__":
    main()
