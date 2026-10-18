"""Studio-song benchmark: the linked-song path on produced songs whose notes are known.

    python -m tests.accuracy.report --songs --jobs 3            # both sets, both halves
    python -m tests.accuracy.report --songs --split dev         # tune on this half only
    python -m tests.accuracy.report --songs --split test        # ...and report this one
    python -m tests.accuracy.report --songs --set csd           # the real takes alone
    python -m tests.accuracy.report --songs --stem sim          # no model: simulated stems
    python -m tests.accuracy.report --songs --write-baseline    # song_baseline.json

A linked song (YouTube, Spotify, Apple Music) or an upload with vocal isolation is not a
hum into a phone: it is a studio recording — a trained voice in tune with a band, drums
keeping time, reverb, backing vocals — and it reaches the melody engine as the MDX vocal
stem, with the beat read from the mix and the chords from the instrumental
(``app.jobs.queue._separate_and_transcribe``).  The sung corpus (``report --vocal``) and
Vocadito are solo voices, and ``tests.accuracy.songs`` scores nine short tunes and real
mixes whose reference is an f0 track; here the notes, the doh, the tempo, the meter and the
bar lines of every song are known.  Two sets, each with a dev and a held-out test half:

  csd    47 real studio takes: the Children's Song Dataset (Choi et al. 2020,
         doi:10.5281/zenodo.4785016, CC BY-NC-SA 4.0 — measurement only, fetched on first run
         by range requests from the archive, never committed), one professional singer
         recorded dry to a click, every note annotated on the audio's clock.  One take of each
         English song (``CSD_SKIP``: three modulate), put over a band in time with the click and
         tuned to the singer, pitched up or down a few cents on some (``csd_production``).
         Halves by a hash of the song.  The headline set: real singing, through the model.
  hymns  80 songs made from the published hymn tunes (``tests.accuracy.hymn_corpus``, whose
         frozen halves they keep), sung by this module's synthetic singer (``render_voice``).
         The model hands that singer to the instrumental when a piano plays (2 of 3 songs
         tried), so this set runs on simulated stems; it is what pytest can afford.

Each song draws its production from its name (``Production``; nothing random at run time):
  voice     (hymns) a female or male lead (a man an octave down), lyric syllables (a voiced
            consonant, a stop or a fricative before each note, the vowel changing), scoops,
            glides, vibrato on held notes (20-70 cents at 5-6.5 Hz), fall-offs at phrase ends,
            a few cents of per-note pitching, a melisma on a third of the songs
  band      drums in the tune's meter, bass on the chord roots, and keys: piano chords, a pad,
            or a piano playing the tune in four parts (the tune in the backing too); chords
            from ``harmony.choose_chords``, inner parts from ``harmony.harmonise``
  tuning    band and voice together at A440, or at A442, A432 and others (-32..+14 cents)
  mix       a doubled lead (hymns), backing vocals on the alto (and tenor) part 10 dB under
            the lead, vocal reverb (RT60 0.8-2.6 s), a bus compressor and a limiter, the lead
            -3..+3 dB against the band, one or two bars of intro
The reference is the lead as sung (melisma notes included, the man's octave kept).

Stems.  ``--stem auto`` (the default) separates the real takes with the production model
(``NF_MDX_MODEL_PATH``; cached with the renders under ``~/.cache/notefusion/studio_songs`` or
``--data``) and gives the hymn songs a simulated stem: the vocal bus (lead, double, backing
vocals and their reverb) plus the band 22 dB down as bleed, and the band with the vocals 24 dB
down as the instrumental.  ``--stem mdx`` / ``sim`` puts every song through one or the other.

Lanes.  The Pro lane (``fast=True``) by default, as Pro accounts send links; ``--lane
normal`` is a bought song's.  Either way the queue's own rules: a stem with no voice gives
way to the mixture, and a stem with too few notes to the mixture's sheet when that has more.

Scored on the audio's clock (a note invented in the intro is one extra note, not a shift of
every other).  Columns: notes.f1 (onset within a quarter beat, pitch exact), doh (the sheet's
doh is the song's), read_err (syllable edit distance over the reference length, each side
read in its own key: what the user reads), syl_err (the same in the song's key: the notes
alone), ghosts (accidentals nobody sang), tempo level, meter, pickup, notes in the right bar,
written rhythm.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, replace
from pathlib import Path
from types import SimpleNamespace

import numpy as np

from tests.accuracy import hymn_corpus as hc
from tests.accuracy import metrics
from tests.accuracy.synth import RefNote

SR = 44_100
STEM_SR = 22_050
DEFAULT_DATA = Path.home() / ".cache" / "notefusion" / "studio_songs"
SALT = "notefusion-studio-songs-v1"
# Songs per half, the first by a hash of the slug: 40 + 40 of the hymn corpus's 224 tunes.
PER_SPLIT = 40
# Bumped whenever the renderer changes what a case sounds like, so cached audio is redone.
RENDER_VERSION = {"hymn": 2, "csd": 1}
# Pytest's handful (``tests/test_studio_songs.py``, their opening phrases on simulated stems), dev
# songs all: a man's doubled lead, a woman's 3/4 with a pickup and a melisma, and a hymn whose
# piano plays the tune under the singer.
FAST_SLUGS = ("belmont", "nativity", "regent-square")

Notes = tuple[tuple[int | None, float], ...]


# ── Production ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Production:
    voice: str  # "female" | "male"
    tuning_cents: float  # band and voice together, from A440
    detune_cents: float  # per-note pitching error, RMS
    jitter_cents: float
    vibrato_cents: float
    vibrato_hz: float
    scoop_cents: float
    glide_sec: float
    falloff: bool
    reverb_rt60: float
    reverb_wet_db: float
    double: bool
    backing: str  # "none" | "alto" | "alto_tenor"
    melisma: bool
    keys: str  # "piano" | "pad" | "piano_tune"
    lead_db: float
    intro_bars: int


def _h(*parts: object) -> int:
    return int(hashlib.sha256(":".join(str(p) for p in (SALT, *parts)).encode()).hexdigest()[:12], 16)


def _pick(slug: str, field: str, options: tuple):
    return options[_h(slug, field) % len(options)]


def production_of(slug: str) -> Production:
    return Production(
        voice=_pick(slug, "voice", ("female", "female", "female", "male", "male")),
        tuning_cents=_pick(slug, "tuning", (0.0, 0.0, 0.0, 0.0, 7.85, -31.8, 14.0, -20.0)),
        detune_cents=_pick(slug, "detune", (3.0, 6.0, 9.0, 12.0)),
        jitter_cents=_pick(slug, "jitter", (4.0, 6.0)),
        vibrato_cents=_pick(slug, "vibrato", (20.0, 35.0, 50.0, 70.0)),
        vibrato_hz=_pick(slug, "vibrato_hz", (5.0, 5.5, 6.0, 6.5)),
        scoop_cents=_pick(slug, "scoop", (20.0, 40.0, 60.0)),
        glide_sec=_pick(slug, "glide", (0.05, 0.07, 0.09)),
        falloff=_pick(slug, "falloff", (True, False, False)),
        reverb_rt60=_pick(slug, "rt60", (0.8, 1.3, 1.9, 2.6)),
        reverb_wet_db=_pick(slug, "wet", (-16.0, -12.0, -9.0)),
        double=_pick(slug, "double", (True, True, False, False, False)),
        backing=_pick(slug, "backing", ("none", "none", "none", "none", "none", "alto", "alto", "alto", "alto_tenor",
                                        "alto_tenor")),
        melisma=_pick(slug, "melisma", (True, False, False)),
        keys=_pick(slug, "keys", ("piano", "piano", "pad", "pad", "piano_tune")),
        lead_db=_pick(slug, "lead_db", (-3.0, -1.0, 1.0, 3.0)),
        intro_bars=_pick(slug, "intro", (1, 2)),
    )


# ── Cases ─────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SongCase:
    name: str  # "<slug>__<voice>", or "<take>__csd"
    slug: str  # the hymn tune's slug, or the CSD take ("en031b")
    split: str  # "dev" or "test": the hymn corpus's, or by a hash of the CSD song
    key: str  # as produced ("Bb major")
    tempo_bpm: int  # quarter beats a minute
    time_signature: str
    bar_offset: float  # quarter beat inside bar 0 where the first note sounds
    bpb: float
    notes: Notes  # (pitch | None, dur) from the first note; breaths are rests
    written: tuple[float, ...]  # each sounding note's published length (melisma notes split)
    legato: tuple[bool, ...]  # per sounding note: slurred from the note before (a melisma)
    production: Production
    tags: tuple[str, ...]
    kind: str = "hymn"  # "hymn" (the synthetic singer) or "csd" (a real studio take)
    # A real take's notes as sung: (pitch, onset s, offset s, beat on the bar grid, written beats).
    ref: tuple[tuple[int, float, float, float, float], ...] = ()
    tempo_exact: float = 0.0  # a real take's tempo, unrounded (the band plays at it)


_SCALE = {"major": (0, 2, 4, 5, 7, 9, 11), "minor": (0, 2, 3, 5, 7, 8, 10, 11)}


def _with_melisma(melody: hc.ParsedMelody, tonic: int, mode: str, slug: str) -> tuple[list[hc.ParsedNote], list[bool]]:
    """Every other held note (a beat or more) that leaps a third to the next is sung as two: the
    note for half its length, slurred to the scale tone between, as a singer fills in a third."""
    scale = {(tonic + d) % 12 for d in _SCALE[mode]}
    out: list[hc.ParsedNote] = []
    slurred: list[bool] = []
    eligible = 0
    for i, n in enumerate(melody.notes):
        nxt = melody.notes[i + 1] if i + 1 < len(melody.notes) else None
        step = 0 if nxt is None else nxt.pitch_midi - n.pitch_midi
        joined = nxt is not None and abs(n.start_beat + n.dur_beats - nxt.start_beat) < 1e-9
        if joined and n.dur_beats >= 1.0 and 3 <= abs(step) <= 4:
            eligible += 1
            direction = 1 if step > 0 else -1
            between = [n.pitch_midi + direction * k for k in (1, 2, 3) if 0 < k < abs(step)]
            passing = next((p for p in between if p % 12 in scale), None)
            if passing is not None and (eligible + _h(slug, "melisma_phase")) % 2 == 0:
                half = n.dur_beats / 2
                out += [hc.ParsedNote(n.pitch_midi, n.start_beat, half), hc.ParsedNote(passing, n.start_beat + half, half)]
                slurred += [False, True]
                continue
        out.append(n)
        slurred.append(False)
    return out, slurred


def _cases() -> tuple[SongCase, ...]:
    cases = []
    tunes = hc.load_tunes()
    for split in ("dev", "test"):
        chosen = sorted((t for t in tunes if hc.split_of(t[0]) == split), key=lambda t: _h(t[0], "order"))[:PER_SPLIT]
        for slug, tune, melody, underlay in sorted(chosen, key=lambda t: t[0]):
            if not melody.notes:
                continue
            prod = production_of(slug)
            tonic, mode = hc._parse_key(tune["key"])
            low, high = (45, 67) if prod.voice == "male" else (57, 79)
            shift = hc._transpose_into(melody.notes, (_h(slug, "key") % 11) - 5 - (12 if prod.voice == "male" else 0),
                                       low, high)
            breaths = hc._phrase_ends(melody, underlay)
            notes = list(melody.notes)
            slurred = [False] * len(notes)
            if prod.melisma:
                # Phrase ends move with the note that ends the phrase (the second of a split pair).
                ends_at = {melody.notes[i].start_beat + melody.notes[i].dur_beats for i in breaths}
                notes, slurred = _with_melisma(melody, tonic, mode, slug)
                breaths = {i for i, n in enumerate(notes) if n.start_beat + n.dur_beats in ends_at}
            seq, written = hc._sequence(replace(melody, notes=tuple(notes)), breaths)
            tempo = int(np.clip(round(tune["tempo"] * _pick(slug, "tempo", (0.95, 1.0, 1.05, 1.12, 1.2))), 60, 150))
            start = "pickup" if melody.notes[0].start_beat else "downbeat"
            tags = ("song", split, "hymns", prod.voice, melody.time, start, prod.keys, f"backing:{prod.backing}",
                    f"tuning:{prod.tuning_cents:+.0f}") + (("melisma",) if prod.melisma else ()) + (
                ("double",) if prod.double else ())
            cases.append(SongCase(
                name=f"{slug}__{prod.voice}", slug=slug, split=split, key=hc._key_name(tonic + shift, mode),
                tempo_bpm=tempo, time_signature=melody.time, bar_offset=melody.notes[0].start_beat, bpb=melody.bpb,
                notes=tuple((None if p is None else p + shift, d) for p, d in seq), written=written,
                legato=tuple(slurred), production=prod, tags=tags,
            ))
    return tuple(cases)


CASES: tuple[SongCase, ...] = _cases() if hc.HYMNS_DIR.is_dir() else ()


# ── Real studio takes (CSD) ───────────────────────────────────────────────────
#
# A synthetic singer is only as voice-like as its model, and the separation model is trained
# on real voices: with a piano behind it, it handed this module's singer to the instrumental
# on 2 of 3 songs tried.  So the headline set is real singing: the Children's Song Dataset
# (Choi et al. 2020, doi:10.5281/zenodo.4785016, CC BY-NC-SA 4.0 — measurement only, downloaded
# on first run, never committed): one professional singer recorded dry in a studio to a click,
# each note annotated (onset, offset, MIDI pitch) on the audio's own clock, with the take's
# tempo and time signature.  The English songs, one take of each (the dataset sings every
# song in two keys), get the same band, reverb and mastering as the hymn songs here, in time
# with the click (bar 1 at 0 s, as the dataset's MIDI has it) and tuned to the singer.

CSD_URL = "https://zenodo.org/api/records/4785016/files/CSD.zip/content"
# The doh of each song is the major scale holding its notes, and of several the one whose doh
# the tune ends on.  Two name their doh from the first phrase instead (Butterfly ends on mi;
# the Muffin Man's F#s fit G better than C, and it is s d d r m d d t l in C), given here for
# the take sung in the dataset's first key ("a") and moved by the other take's ``key_diff``;
# three modulate and have no one doh, so they are left out.
CSD_DOH = {"en005": 5, "en031": 0}
CSD_SKIP = ("en025", "en032", "en034")
_MAJOR = frozenset({0, 2, 4, 5, 7, 9, 11})


def ensure_csd(root: Path) -> Path:
    """The English half of CSD under ``root`` (its notes, metadata and audio), fetched by range
    requests out of the 1.85 GB archive so the Korean half is never downloaded."""
    import struct
    import urllib.request
    import zlib
    from concurrent.futures import ThreadPoolExecutor

    english = root / "CSD" / "english"
    if (english / "complete").exists():
        return english

    def get(start: int, end: int) -> bytes:
        for attempt in range(8):
            try:
                request = urllib.request.Request(CSD_URL, headers={"Range": f"bytes={start}-{end}"})
                with urllib.request.urlopen(request, timeout=300) as response:  # noqa: S310 - fixed https URL
                    data = response.read()
                if len(data) == end - start + 1:
                    return data
            except OSError:
                pass
            time.sleep(2 + 3 * attempt)
        raise RuntimeError(f"could not fetch bytes {start}-{end} of {CSD_URL}")

    print(f"fetching CSD (English) into {root} ...", flush=True)
    with urllib.request.urlopen(urllib.request.Request(CSD_URL, method="HEAD"), timeout=60) as response:  # noqa: S310
        total = int(response.headers["Content-Length"])
    tail = get(total - 65536, total - 1)
    i = tail.rfind(b"PK\x05\x06")
    count, cd_size, cd_offset = struct.unpack("<HII", tail[i + 10:i + 20])
    if cd_offset == 0xFFFFFFFF:  # zip64
        j = tail.rfind(b"PK\x06\x06")
        count, cd_size, cd_offset = struct.unpack("<QQQ", tail[j + 32:j + 56])
    directory = get(cd_offset, cd_offset + cd_size - 1)
    # The notes and the metadata, and the audio of the one take of each song the corpus sings.
    takes = {f"en{s:03d}" + ("a" if _h(f"en{s:03d}", "take") % 2 == 0 else "b") for s in range(1, 51)}
    members, p = [], 0
    for _ in range(count):
        method, csize, nlen, xlen, clen = struct.unpack("<H8xI4xHHH", directory[p + 10:p + 34])
        offset = struct.unpack("<I", directory[p + 42:p + 46])[0]
        name = directory[p + 46:p + 46 + nlen].decode("utf-8", "replace")
        p += 46 + nlen + xlen + clen
        wanted = name.endswith((".csv", "metadata.json")) or (name.endswith(".wav") and Path(name).stem in takes)
        if name.startswith("CSD/english/") and wanted:
            members.append((name, method, csize, offset))

    def fetch(member) -> None:
        name, method, csize, offset = member
        dest = root / name
        if dest.exists():
            return
        head = get(offset, offset + 29)
        nlen, xlen = struct.unpack("<HH", head[26:30])
        data = get(offset + 30 + nlen + xlen, offset + 30 + nlen + xlen + csize - 1)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(zlib.decompress(data, -15) if method == 8 else data)

    with ThreadPoolExecutor(6) as pool:
        list(pool.map(fetch, members))
    (english / "complete").write_text("")
    return english


def csd_production(sid: str) -> Production:
    """A real take's production: everything but the singer, who is the take."""
    return Production(
        voice="csd", tuning_cents=_pick(sid, "tuning", (0.0, 0.0, 0.0, 0.0, 7.85, -20.0, 14.0, -14.0)),
        detune_cents=4.0, jitter_cents=4.0, vibrato_cents=20.0, vibrato_hz=5.5, scoop_cents=10.0, glide_sec=0.06,
        falloff=False, reverb_rt60=_pick(sid, "rt60", (0.8, 1.3, 1.9, 2.6)),
        reverb_wet_db=_pick(sid, "wet", (-16.0, -12.0, -9.0)), double=False,
        backing=_pick(sid, "backing", ("none", "none", "none", "alto")), melisma=False,
        keys=_pick(sid, "keys", ("piano", "piano", "pad", "pad", "piano_tune")),
        lead_db=_pick(sid, "lead_db", (-3.0, -1.0, 1.0, 3.0)), intro_bars=0,
    )


def _csd_doh(sid: str, notes: list[tuple[float, float, int]], key_diff: int = 0) -> int:
    """The doh of the song ``sid`` from a take's notes; ``key_diff`` is that take's key against
    the dataset's first take (``CSD_DOH`` is given in the first)."""
    if sid in CSD_DOH:
        return (CSD_DOH[sid] + key_diff) % 12
    weight = np.zeros(12)
    for start, end, pitch in notes:
        weight[pitch % 12] += end - start
    outside = [sum(weight[pc] for pc in range(12) if (pc - root) % 12 not in _MAJOR) for root in range(12)]
    fits = [root for root in range(12) if outside[root] <= min(outside) + 1e-9]
    ends_on = [root for root in fits if notes[-1][2] % 12 == root]
    return (ends_on or fits)[0]


def csd_cases(data: Path) -> tuple[SongCase, ...]:
    import csv

    english = ensure_csd(data / "csd_source")
    meta = json.loads((english / "metadata.json").read_text())
    cases = []
    for song in range(1, 51):
        sid = f"en{song:03d}"
        if sid in CSD_SKIP:
            continue
        take = sid + ("a" if _h(sid, "take") % 2 == 0 else "b")
        split = "test" if _h(sid, "split") % 2 else "dev"
        prod = csd_production(sid)
        with (english / "csv" / f"{take}.csv").open() as fh:
            notes = [(float(r["start"]), float(r["end"]), int(r["pitch"])) for r in csv.DictReader(fh)]
        info = meta[take]
        bpb = hc.beats_per_bar(info["time_signature"])
        spb = 60.0 / float(info["tempo"])
        # Beats on the click's grid (bar 1 at 0 s), to the nearest semiquaver.
        beats = [round(start / spb * 4.0) / 4.0 for start, _end, _p in notes]
        written = [max(0.25, round(end / spb * 4.0) / 4.0 - b) for (_s, end, _p), b in zip(notes, beats)]
        doh = _csd_doh(sid, notes, int(info["key_diff"]) - int(meta[sid + "a"]["key_diff"]))
        start = "pickup" if beats[0] % bpb else "downbeat"
        tags = ("song", split, "csd", info["time_signature"], start, prod.keys, f"backing:{prod.backing}",
                f"tuning:{prod.tuning_cents:+.0f}")
        cases.append(SongCase(
            name=f"{take}__csd", slug=take, split=split, key=hc._key_name(doh, "major"),
            tempo_bpm=int(info["tempo"]), time_signature=info["time_signature"],
            bar_offset=beats[0] % bpb, bpb=bpb, notes=(), written=tuple(written), legato=(False,) * len(notes),
            production=prod, tags=tags, kind="csd",
            ref=tuple((p, s, e, b, w) for (s, e, p), b, w in zip(notes, beats, written)),
            tempo_exact=float(info["tempo"]),
        ))
    return tuple(cases)


SETS = ("csd", "hymns")


def select(split: str = "", name_filter: str = "", slugs: tuple[str, ...] = (), sets: tuple[str, ...] = ("hymns",),
           data: Path = DEFAULT_DATA) -> tuple[SongCase, ...]:
    pool = (csd_cases(data) if "csd" in sets else ()) + (CASES if "hymns" in sets else ())
    return tuple(c for c in pool if (not split or c.split == split) and name_filter in c.name
                 and (not slugs or c.slug in slugs))


def case_fingerprint(case: SongCase) -> str:
    return hashlib.sha256(repr((RENDER_VERSION[case.kind], case)).encode()).hexdigest()[:10]


def corpus_fingerprint(cases: tuple[SongCase, ...] = CASES) -> str:
    digest = hashlib.sha256()
    for case in cases:
        digest.update(case_fingerprint(case).encode())
    return digest.hexdigest()[:16]


# ── Timeline ──────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class _Note:
    pitch: int
    beat: float  # on the tune's bar grid (bar k starts at k * bpb)
    dur: float  # sounding, beats
    written: float
    phrase_start: bool
    phrase_end: bool
    legato: bool


def _tune(case: SongCase) -> list[_Note]:
    if case.kind == "csd":
        # A gap of a quarter second between two notes is a breath: the phrase ends there.
        spb = 60.0 / case.tempo_exact
        out = []
        for i, (pitch, on, off, beat, written) in enumerate(case.ref):
            start = i == 0 or on - case.ref[i - 1][2] > 0.25
            end = i + 1 == len(case.ref) or case.ref[i + 1][1] - off > 0.25
            out.append(_Note(pitch, beat, (off - on) / spb, written, start, end, False))
        return out
    out: list[_Note] = []
    cursor, k = case.bar_offset, 0
    after_rest = True
    for i, (pitch, dur) in enumerate(case.notes):
        if pitch is None:
            after_rest = True
            cursor += dur
            continue
        end = i + 1 >= len(case.notes) or case.notes[i + 1][0] is None
        out.append(_Note(pitch, cursor, dur, case.written[k], after_rest, end, case.legato[k]))
        after_rest = False
        cursor += dur
        k += 1
    return out


def _grid(case: SongCase) -> tuple[float, float]:
    """(seconds per beat, the band beat the tune's bar grid starts on): the intro's full bars
    come first, and a pickup sounds in the last of them.  A real take's bar 1 is at 0 s."""
    if case.kind == "csd":
        return 60.0 / case.tempo_exact, 0.0
    pickup_bar = 1 if case.bar_offset > 0 else 0
    return 60.0 / case.tempo_bpm, (case.production.intro_bars - pickup_bar) * case.bpb


def reference(case: SongCase) -> list[RefNote]:
    if case.kind == "csd":
        first = case.ref[0][3]
        return [RefNote(pitch_midi=p, onset_sec=on, dur_sec=off - on, onset_beat=beat - first, dur_beats=written)
                for p, on, off, beat, written in case.ref]
    spb, origin = _grid(case)
    tune = _tune(case)
    first = tune[0].beat
    return [RefNote(pitch_midi=n.pitch, onset_sec=(n.beat + origin) * spb, dur_sec=n.dur * spb,
                    onset_beat=n.beat - first, dur_beats=n.dur) for n in tune]


# ── The voice ─────────────────────────────────────────────────────────────────

# Vowel formants (Hz, bandwidth), a woman's; a man's sit 15% lower.
_VOWELS = {
    "a": ((800, 80), (1150, 90), (2900, 120)),
    "e": ((400, 70), (1700, 90), (2600, 120)),
    "i": ((300, 60), (2250, 100), (3000, 120)),
    "o": ((450, 70), (800, 80), (2830, 110)),
    "u": ((330, 50), (720, 60), (2500, 160)),
}
_VOWEL_NAMES = tuple(_VOWELS)


@dataclass(frozen=True)
class _Sung:
    start: float  # seconds
    end: float
    midi: float  # intended pitch, before tuning and pitching error
    phrase_start: bool
    phrase_end: bool
    articulation: str  # "onset" (from silence), "legato", "voiced", "stop", "fricative"
    vowel: str


def _walk(rng: np.random.Generator, n: int, rms: float, cutoff_hz: float) -> np.ndarray:
    from scipy import signal

    if rms <= 0 or n == 0:
        return np.zeros(n)
    w = signal.sosfilt(signal.butter(2, cutoff_hz, fs=SR, output="sos"), rng.standard_normal(n))
    w -= w.mean()
    s = float(np.sqrt(np.mean(w ** 2)))
    return w * (rms / s) if s > 0 else w


def _raised(n: int) -> np.ndarray:
    return 0.5 - 0.5 * np.cos(np.pi * np.arange(n) / max(n - 1, 1)) if n > 0 else np.empty(0)


def render_voice(sung: list[_Sung], n: int, p: Production, seed: int, male: bool, vibrato_scale: float = 1.0,
                 detune_scale: float = 1.0) -> np.ndarray:
    """One singer: a harmonic source with vibrato, scoops and glides through vowel formants,
    a consonant before each syllable.  Mono, unnormalised."""
    from scipy import signal

    rng = np.random.default_rng(seed)
    pitch = np.full(n, np.nan)
    env = np.zeros(n)
    noise_env = np.zeros(n)
    noise_kind = np.zeros(n)  # 0 stop burst, 1 fricative
    vowel_w = np.zeros((len(_VOWEL_NAMES), n))
    glide = int(p.glide_sec * SR)
    detunes = np.clip(rng.normal(0.0, p.detune_cents * detune_scale, len(sung)), -40, 40) / 100.0

    for i, note in enumerate(sung):
        s, e = int(note.start * SR), min(n, int(note.end * SR))
        if e - s < 8:
            continue
        target = note.midi + detunes[i]
        seg = np.full(e - s, target)
        t = np.arange(e - s) / SR
        if note.phrase_start or (note.articulation != "legato" and rng.random() < 0.25):
            seg -= (p.scoop_cents / 100.0) * np.exp(-t / 0.035)
        depth = (p.vibrato_cents * vibrato_scale / 100.0) * np.clip((t - 0.18) / 0.25, 0.0, 1.0)
        rate = p.vibrato_hz * (1.0 + 0.04 * rng.standard_normal())
        seg += depth * np.sin(2 * np.pi * rate * t + rng.uniform(0, 2 * np.pi))
        a = np.ones(e - s)
        if note.phrase_end and p.falloff and rng.random() < 0.6:
            k = min(int(0.13 * SR), (e - s) // 3)
            seg[-k:] -= np.linspace(0, 1, k) ** 2 * rng.uniform(1.5, 3.0)
            a[-k:] *= np.linspace(1, 0.15, k)
        if note.phrase_end:
            k = min(int(0.08 * SR), (e - s) // 3)
            a[-k:] *= _raised(k)[::-1]
        if note.articulation == "onset":
            k = min(int(rng.uniform(0.03, 0.06) * SR), (e - s) // 3)
            a[:k] *= _raised(k)
        elif note.articulation == "legato":
            k = min(int(0.04 * SR), (e - s) // 3)
            a[:k] *= 0.85 + 0.15 * _raised(k)
        elif note.articulation == "voiced":
            k = min(int(0.05 * SR), (e - s) // 3)
            a[:k] *= 0.35 + 0.65 * _raised(k)
        pitch[s:e] = seg
        env[s:e] = a
        v = _VOWEL_NAMES.index(note.vowel)
        vowel_w[:, s:e] = 0.0
        vowel_w[v, s:e] = 1.0

        # Glide from the note before when the voice runs on (no stop or fricative between).
        if i > 0 and note.articulation in ("legato", "voiced") and glide > 1:
            prev_end = int(sung[i - 1].end * SR)
            if s - prev_end < int(0.03 * SR) and not np.isnan(pitch[max(0, s - 1)]):
                half = glide // 2
                lo, hi = max(0, s - half), min(e, s + half)
                before = float(pitch[lo]) if not np.isnan(pitch[lo]) else target
                pitch[lo:hi] = before + (seg[hi - s - 1] - before) * _raised(hi - lo)
        # A consonant: a stop silences the voice around the onset and ends in a burst; a
        # fricative replaces the voice with noise just before it.  Singers put the consonant
        # before the beat so the vowel lands on it.
        if note.articulation == "stop":
            gap = int(rng.uniform(0.025, 0.045) * SR)
            lo, hi = max(0, s - int(0.6 * gap)), min(e, s + int(0.4 * gap))
            pitch[lo:hi] = np.nan
            env[lo:hi] = 0.0
            b = int(0.008 * SR)
            noise_env[max(0, hi - b):hi] = 0.5
            noise_kind[max(0, hi - b):hi] = 0
            k = min(int(0.012 * SR), e - hi)
            env[hi:hi + k] *= _raised(k)
        elif note.articulation == "fricative":
            gap = int(rng.uniform(0.05, 0.09) * SR)
            lo, hi = max(0, s - int(0.7 * gap)), min(e, s + int(0.3 * gap))
            pitch[lo:hi] = np.nan
            env[lo:hi] = 0.0
            noise_env[lo:hi] = 0.35 * np.sin(np.pi * np.arange(hi - lo) / max(hi - lo, 1))
            noise_kind[lo:hi] = 1
            k = min(int(0.02 * SR), e - hi)
            env[hi:hi + k] *= _raised(k)

    voiced = ~np.isnan(pitch)
    tuning = p.tuning_cents / 100.0 + _walk(rng, n, p.jitter_cents / 100.0, 3.0)
    f0 = np.where(voiced, 440.0 * 2.0 ** ((np.nan_to_num(pitch, nan=60.0) + tuning - 69.0) / 12.0), 0.0)
    phase = 2 * np.pi * np.cumsum(f0) / SR
    f0_max = float(f0.max()) if voiced.any() else 440.0
    source = np.zeros(n)
    for k in range(1, 40):
        if k * f0_max > 9000:
            break
        source += np.sin(k * phase) / k ** 1.1
    shimmer = 1.0 + _walk(rng, n, 0.04, 6.0)
    source *= env * shimmer
    source += rng.standard_normal(n) * env * 0.01  # breath in the voice

    # Vowel formants, cross-faded over 40 ms at each change.
    smooth = np.ones(int(0.04 * SR)) / int(0.04 * SR)
    scale = 0.85 if male else 1.0
    out = np.zeros(n)
    for v, name in enumerate(_VOWEL_NAMES):
        weight = np.convolve(vowel_w[v], smooth, mode="same")
        if not weight.any():
            continue
        y = np.zeros(n)
        for centre, bw in _VOWELS[name]:
            r = np.exp(-np.pi * bw / SR)
            theta = 2 * np.pi * centre * scale / SR
            y += signal.lfilter([1 - r], [1, -2 * r * np.cos(theta), r * r], source)
        out += weight * y
    # The singer's formant: trained voices carry a peak near 3 kHz.
    out += 0.4 * signal.sosfilt(signal.butter(2, [2600, 3400], btype="band", fs=SR, output="sos"), out)

    noise = rng.standard_normal(n)
    burst = signal.sosfilt(signal.butter(2, [1500, 6000], btype="band", fs=SR, output="sos"), noise)
    hiss = signal.sosfilt(signal.butter(2, [3500, 9000], btype="band", fs=SR, output="sos"), noise)
    level = float(np.sqrt(np.mean(out[voiced] ** 2))) if voiced.any() else 1.0
    out += level * noise_env * np.where(noise_kind > 0, hiss, burst) * 3.0
    return out


def _sung_line(case: SongCase, notes: list[tuple[int, float, float, bool, bool, bool]], spb: float, origin: float,
               salt: str, lyric: bool = True, timing_sd: float = 0.0) -> list[_Sung]:
    """(pitch, beat, dur, phrase_start, phrase_end, legato) -> what the singer does with each."""
    rng = np.random.default_rng(_h(case.slug, salt) % 2 ** 32)
    out: list[_Sung] = []
    vowel = "a"
    for pitch, beat, dur, start, end, legato in notes:
        if legato:
            art = "legato"
        elif start:
            art = "onset"
        elif not lyric:
            art = "voiced"
        else:
            art = ("voiced", "stop", "stop", "fricative", "voiced")[int(rng.integers(5))]
        if not legato:
            vowel = _VOWEL_NAMES[int(rng.integers(5))] if lyric else "u"
        jitter = float(np.clip(rng.normal(0.0, timing_sd), -2 * timing_sd, 2 * timing_sd)) if timing_sd else 0.0
        on = (beat + origin) * spb + jitter
        out.append(_Sung(on, on + dur * spb, float(pitch), start, end, art, vowel))
    return out


# ── The band ──────────────────────────────────────────────────────────────────


def _drum_pattern(time_signature: str, bpb: float) -> tuple[tuple[float, ...], tuple[float, ...]]:
    """(kick beats, snare beats) inside one bar, in quarter beats."""
    return {
        "4/4": ((0.0, 2.0), (1.0, 3.0)), "2/2": ((0.0, 2.0), (1.0, 3.0)), "2/4": ((0.0,), (1.0,)),
        "3/4": ((0.0,), (1.0, 2.0)), "6/8": ((0.0,), (1.5,)), "9/8": ((0.0,), (1.5, 3.0)),
        "3/2": ((0.0,), (2.0, 4.0)), "6/4": ((0.0,), (3.0,)), "8/4": ((0.0, 2.0, 4.0, 6.0), (1.0, 3.0, 5.0, 7.0)),
    }.get(time_signature, ((0.0,), tuple(float(b) for b in range(1, int(bpb)))))


def _pad(midi: float, dur: float) -> np.ndarray:
    n = int((dur + 0.3) * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    for cents in (-6.0, 6.0):
        f0 = 440.0 * 2.0 ** ((midi + cents / 100.0 - 69.0) / 12.0)
        for k in range(1, 9):
            if k * f0 > 6000:
                break
            out += np.sin(2 * np.pi * k * f0 * t) / k
    env = np.clip(t / 0.25, 0, 1) * np.clip((dur + 0.3 - t) / 0.3, 0, 1)
    return 0.25 * out * env


def _add(buf: np.ndarray, x: np.ndarray, start: float) -> None:
    s = max(0, int(start))
    if s < len(buf):
        e = min(len(buf), s + len(x))
        buf[s:e] += x[: e - s]


def _voicing(pcs: tuple[int, ...], low: int = 52) -> list[int]:
    return sorted(low + ((pc - low) % 12) for pc in pcs)


def render_band(case: SongCase, tune: list[_Note], n: int, tuning_cents: float | None = None) -> np.ndarray:
    from app.pipeline import harmony, solfa
    from tests.accuracy import songs as base

    p = case.production
    spb, origin = _grid(case)
    tonic, mode = hc._parse_key(case.key)
    tune_cents = (p.tuning_cents if tuning_cents is None else tuning_cents) / 100.0
    rng = np.random.default_rng(_h(case.slug, "band") % 2 ** 32)
    bpb = case.bpb
    melody = [harmony.MelodyNote(x.pitch, x.beat, x.written) for x in tune]
    spans = harmony.choose_chords(melody, tonic, mode, bpb)
    home = (harmony.MAJOR_CHORDS if mode == "major" else harmony.MINOR_CHORDS)[0].pitch_classes(tonic)
    tune_end = max(x.beat + x.written for x in tune)
    n_bars = int(np.ceil((tune_end + origin) / bpb)) + 1  # an outro bar on the tonic
    piano, pad, bass, kick, snare, hats = (np.zeros(n) for _ in range(6))

    def chord_at(beat: float) -> tuple[int, ...]:
        for s, d, c in spans:
            if s - 1e-6 <= beat < s + d - 1e-6:
                return c.pitch_classes(tonic)
        return home

    kicks, snares = _drum_pattern(case.time_signature, bpb)
    compound = case.time_signature.endswith("/8")
    hit_every = 1.5 if compound else 1.0
    for bar in range(n_bars):
        bar_start = bar * bpb
        for b in np.arange(0.0, bpb - 1e-9, 0.5):
            at = (bar_start + b) * spb * SR + rng.normal(0, 0.003 * SR)
            _add(hats, base._drum("hat", rng) * (0.8 if b % 1 else 1.0), at)
        for b in kicks:
            _add(kick, base._drum("kick", rng), (bar_start + b) * spb * SR)
        for b in snares:
            _add(snare, base._drum("snare", rng) * (0.6 if case.time_signature == "3/4" else 1.0),
                      (bar_start + b) * spb * SR)
        for b in np.arange(0.0, bpb - 1e-9, hit_every):
            beat = bar_start + b - origin  # on the tune's grid
            pcs = chord_at(beat) if beat >= 0 else home
            at = (bar_start + b) * spb * SR
            if b == 0.0 or (not compound and b == 2.0 and bpb == 4.0):
                root = 36 + ((pcs[0] - 36) % 12)
                _add(bass, base._bass(root + tune_cents, hit_every * 2 * spb * 0.9), at)
            if p.keys == "piano":
                for m in _voicing(pcs):
                    _add(piano, base._piano(m + tune_cents, hit_every * spb * 0.9, vel=0.9 if b == 0 else 0.6), at)
    if p.keys == "pad":
        bounds = [(0.0, origin, home)] + [(s + origin, d, c.pitch_classes(tonic)) for s, d, c in spans]
        last = bounds[-1][0] + bounds[-1][1]
        bounds.append((last, n_bars * bpb - last, home))
        for s, d, pcs in bounds:
            if d <= 0:
                continue
            for m in _voicing(pcs, 55):
                _add(pad, _pad(m + tune_cents, d * spb), s * spb * SR)
    if p.keys == "piano_tune":
        # The hymn played in four parts on the piano, as a church pianist accompanies it.
        doh = solfa.doh_pitch_class(tonic, mode)
        notes = [SimpleNamespace(pitch_midi=x.pitch, start_beat=x.beat, dur_beats=x.written, conf=1.0) for x in tune]
        parts = harmony.harmonise(notes, tonic, mode, doh, solfa.reference_doh([x.pitch for x in tune], doh, mode),
                                  case.time_signature)
        for name in ("soprano", "alto", "tenor", "bass"):
            for x in parts.parts[name] if parts else []:
                at = (x.start_beat + origin) * spb * SR
                _add(piano, base._piano(x.pitch_midi + tune_cents, x.dur_beats * spb * 0.95,
                                             vel=0.8 if name == "soprano" else 0.6), at)
        for bar in range(int(np.ceil(origin / bpb))):  # the intro on the tonic
            for m in _voicing(home):
                _add(piano, base._piano(m + tune_cents, bpb * spb * 0.9, vel=0.6), bar * bpb * spb * SR)
    drums = kick + 0.8 * snare + 0.35 * hats
    keys = piano + pad
    return np.stack([0.65 * keys + bass + drums + 0.25 * hats, 0.45 * keys + bass + drums + 0.4 * hats])


# ── Mixing ────────────────────────────────────────────────────────────────────


def _reverb(x: np.ndarray, rt60: float, seed: int) -> np.ndarray:
    """The wet signal alone: decaying filtered noise, a 20 ms pre-delay."""
    from scipy import signal

    rng = np.random.default_rng(seed)
    t = np.arange(int(rt60 * SR)) / SR
    ir = signal.sosfilt(signal.butter(1, 5000, fs=SR, output="sos"), rng.standard_normal(t.size) * np.exp(-6.91 * t / rt60))
    ir[: int(0.02 * SR)] = 0.0
    ir /= np.sqrt(np.sum(ir ** 2))
    return signal.fftconvolve(x, ir)[: len(x)]


def _compress(x: np.ndarray, threshold_db: float = -18.0, ratio: float = 2.5) -> tuple[np.ndarray, np.ndarray]:
    """A bus compressor (RMS over 10 ms blocks, 10 ms attack, 150 ms release), make-up gain and a
    soft limit.  Returns the mastered mix and the linear gain it applied, for the stems."""
    block = int(0.01 * SR)
    mono = x.mean(axis=0)
    n_blocks = int(np.ceil(mono.size / block))
    padded = np.pad(mono, (0, n_blocks * block - mono.size))
    level = 20 * np.log10(np.sqrt(np.mean(padded.reshape(n_blocks, block) ** 2, axis=1)) + 1e-9)
    want = np.minimum(0.0, (threshold_db - level) * (1.0 - 1.0 / ratio))
    gain = np.zeros(n_blocks)
    g = 0.0
    for i, w in enumerate(want):
        g += (w - g) * (0.63 if w < g else 0.065)
        gain[i] = g
    lin = np.repeat(10 ** (gain / 20.0), block)[: mono.size]
    lin *= 0.7 / max(1e-9, float(np.max(np.abs(x * lin))))
    return 0.98 * np.tanh(x * lin * 1.6) / np.tanh(1.6), lin


@dataclass
class Rendered:
    mix: np.ndarray  # (2, n) at 44.1 kHz, mastered
    vocals: np.ndarray  # (2, n): the vocal bus with its reverb, at the mix's gain
    band: np.ndarray  # (2, n) at the mix's gain


def render(case: SongCase, data: Path = DEFAULT_DATA) -> Rendered:
    if case.kind == "csd":
        return _render_csd(case, data)
    p = case.production
    spb, origin = _grid(case)
    tune = _tune(case)
    tune_end = max(x.beat + x.written for x in tune)
    n_bars = int(np.ceil((tune_end + origin) / case.bpb)) + 1
    n = int((n_bars * case.bpb * spb + 2.5) * SR)
    male = p.voice == "male"

    lead_line = [(x.pitch, x.beat, x.dur, x.phrase_start, x.phrase_end, x.legato) for x in tune]
    lead = render_voice(_sung_line(case, lead_line, spb, origin, "lead"), n, p, _h(case.slug, "lead_voice") % 2 ** 32, male)
    left, right = lead.copy(), lead.copy()
    if p.double:
        double = render_voice(_sung_line(case, lead_line, spb, origin, "lead", timing_sd=0.012), n, p,
                              _h(case.slug, "double_voice") % 2 ** 32, male, detune_scale=1.2)
        g = 10 ** (-4.0 / 20.0)
        left += 0.75 * g * double
        right += 0.35 * g * double
    bv = _backing_vocals(case, tune, n, male, _voiced_rms(lead))
    left, right = left + bv[0], right + bv[1]
    dry = np.stack([left, right])
    wet_gain = 10 ** (p.reverb_wet_db / 20.0)  # the IR has unit energy, so this is the tail against the dry voice
    vocals = dry + wet_gain * np.stack([_reverb(left, p.reverb_rt60, _h(case.slug, "rv_l") % 2 ** 32),
                                        _reverb(right, p.reverb_rt60, _h(case.slug, "rv_r") % 2 ** 32)])

    band = render_band(case, tune, n)
    voiced = np.abs(lead) > 0.05 * np.max(np.abs(lead))
    band *= np.sqrt(np.mean(lead[voiced] ** 2)) / max(1e-9, np.sqrt(np.mean(band.mean(axis=0)[voiced] ** 2)))
    band *= 10 ** (-p.lead_db / 20.0)
    mastered, gain = _compress(vocals + band)
    return Rendered(mix=mastered, vocals=vocals * gain, band=band * gain)


def _voiced_rms(x: np.ndarray) -> float:
    """RMS over the samples where ``x`` sounds (above 5% of its peak)."""
    voiced = np.abs(x) > 0.05 * float(np.max(np.abs(x)))
    return float(np.sqrt(np.mean(x[voiced] ** 2))) if voiced.any() else 0.0


def _backing_vocals(case: SongCase, tune: list[_Note], n: int, male: bool, lead_rms: float) -> np.ndarray:
    """(2, n): the alto (and tenor) part ``harmony.harmonise`` writes under the tune, sung on "oo",
    each 10 (11) dB under the lead (``lead_rms``, the lead's ``_voiced_rms``)."""
    from app.pipeline import harmony, solfa

    p = case.production
    spb, origin = _grid(case)
    out = np.zeros((2, n))
    if p.backing == "none":
        return out
    tonic, mode = hc._parse_key(case.key)
    doh = solfa.doh_pitch_class(tonic, mode)
    notes = [SimpleNamespace(pitch_midi=x.pitch, start_beat=x.beat, dur_beats=x.written, conf=1.0) for x in tune]
    parts = harmony.harmonise(notes, tonic, mode, doh, solfa.reference_doh([x.pitch for x in tune], doh, mode),
                              case.time_signature)
    if parts is None:
        return out
    # The parts sit under the tune as harmony writes them against its soprano octave; a man's
    # lead is that tune an octave down, and his backing singers come down with him.
    octave = -int(parts.extra.get("octave_shift", 0))
    for k, name in enumerate(("alto", "tenor") if p.backing == "alto_tenor" else ("alto",)):
        line = []
        for x in parts.parts[name]:
            phrase = next((t for t in tune if abs(t.beat - x.start_beat) < 1e-6), None)
            line.append((x.pitch_midi + octave, x.start_beat, min(x.dur_beats, phrase.dur if phrase else x.dur_beats),
                         bool(phrase and phrase.phrase_start), bool(phrase and phrase.phrase_end), False))
        bv = render_voice(_sung_line(case, line, spb, origin, f"bv_{name}", lyric=False, timing_sd=0.015), n,
                          replace(p, scoop_cents=10.0, falloff=False), _h(case.slug, f"bv_{name}_voice") % 2 ** 32,
                          male, vibrato_scale=0.4)
        g = 10 ** ((-10.0 if k == 0 else -11.0) / 20.0) * lead_rms / max(1e-9, _voiced_rms(bv))
        out[0] += (0.6 if k == 0 else 0.4) * g * bv
        out[1] += (0.4 if k == 0 else 0.6) * g * bv
    return out


def _singer_tuning(y: np.ndarray, case: SongCase) -> float:
    """Cents the take sits from A440: the median over its notes of the sung pitch against the note."""
    import librosa

    y22 = librosa.resample(y, orig_sr=SR, target_sr=STEM_SR)
    f0, _voiced, _p = librosa.pyin(y22, fmin=80.0, fmax=1000.0, sr=STEM_SR, frame_length=2048, hop_length=256)
    times = librosa.frames_to_time(np.arange(f0.size), sr=STEM_SR, hop_length=256)
    deviations = []
    for pitch, on, off, _b, _w in case.ref:
        inside = (times > on + 0.3 * (off - on)) & (times < off - 0.2 * (off - on)) & ~np.isnan(f0)
        if inside.sum() >= 3:
            deviations.append(float(np.median(librosa.hz_to_midi(f0[inside]))) - pitch)
    near = [d for d in deviations if abs(d) < 0.5]
    return 100.0 * float(np.median(near)) if near else 0.0


def _render_csd(case: SongCase, data: Path) -> Rendered:
    """A real take: the singer as recorded, pitched by ``tuning_cents`` (its clock kept: the click's
    tempo stays a whole number, as a song's does), the band tuned to her."""
    import librosa

    p = case.production
    english = ensure_csd(data / "csd_source")
    y, _ = librosa.load(english / "wav" / f"{case.slug}.wav", sr=SR, mono=True)
    if p.tuning_cents:
        y = librosa.effects.pitch_shift(y, sr=SR, n_steps=p.tuning_cents / 100.0, n_fft=4096, hop_length=512)
    y = y.astype(np.float64)
    tune = _tune(case)
    spb, _origin = _grid(case)
    tune_end = max(x.beat + x.written for x in tune)
    n_bars = int(np.ceil(tune_end / case.bpb)) + 1
    n = max(len(y), int((n_bars * case.bpb * spb + 2.5) * SR))
    lead = np.pad(y, (0, n - len(y)))
    tuning = _singer_tuning(lead, case)
    print(f"[studio_songs] {case.name}: the singer sits {tuning:+.0f} cents from A440", flush=True)
    left, right = lead.copy(), lead.copy()
    bv = _backing_vocals(case, tune, n, False, _voiced_rms(lead))
    if bv.any():
        # 10 dB under the take's RMS over its whole length (silences and all).
        bv *= np.sqrt(np.mean(lead ** 2)) / max(1e-9, np.sqrt(np.mean(bv.mean(axis=0) ** 2)))
        bv *= 10 ** (-10.0 / 20.0)
        left, right = left + bv[0], right + bv[1]
    dry = np.stack([left, right])
    wet_gain = 10 ** (p.reverb_wet_db / 20.0)
    vocals = dry + wet_gain * np.stack([_reverb(left, p.reverb_rt60, _h(case.slug, "rv_l") % 2 ** 32),
                                        _reverb(right, p.reverb_rt60, _h(case.slug, "rv_r") % 2 ** 32)])
    band = render_band(case, tune, n, tuning_cents=tuning)
    voiced = np.abs(lead) > 0.05 * np.max(np.abs(lead))
    band *= np.sqrt(np.mean(lead[voiced] ** 2)) / max(1e-9, np.sqrt(np.mean(band.mean(axis=0)[voiced] ** 2)))
    band *= 10 ** (-p.lead_db / 20.0)
    mastered, gain = _compress(vocals + band)
    return Rendered(mix=mastered, vocals=vocals * gain, band=band * gain)


# ── Data ──────────────────────────────────────────────────────────────────────


def case_dir(data: Path, case: SongCase) -> Path:
    return data / f"{case.name}-{case_fingerprint(case)}"


def _to_stem_rate(x: np.ndarray) -> np.ndarray:
    import librosa

    return librosa.resample(np.asarray(x.mean(axis=0) if x.ndim == 2 else x, dtype=np.float32), orig_sr=SR,
                            target_sr=STEM_SR)


def ensure_rendered(data: Path, case: SongCase) -> Path:
    """The mix and the simulated stems.  A real take's mix is written as a link fetch gives it
    (44.1 kHz stereo WAV) for the model; the synthetic singer's, which the model is not run on
    by default, at the rate the transcriber reads (22.05 kHz mono), a quarter of the disk."""
    import soundfile as sf

    folder = case_dir(data, case)
    if (folder / "sim_backing.wav").exists():
        return folder / "mix.wav"
    folder.mkdir(parents=True, exist_ok=True)
    r = render(case, data)
    if case.kind == "csd":
        sf.write(folder / "mix.wav", r.mix.T.astype(np.float32), SR, subtype="PCM_16")
    else:
        sf.write(folder / "mix.wav", _to_stem_rate(r.mix), STEM_SR, subtype="PCM_16")
    vox = _to_stem_rate(r.vocals)
    band = _to_stem_rate(r.band)
    sim_vocals = vox + band * 10 ** (-22.0 / 20.0)
    sim_backing = band + vox * 10 ** (-24.0 / 20.0)
    peak = max(1.0, float(np.max(np.abs(sim_vocals))), float(np.max(np.abs(sim_backing))))
    sf.write(folder / "sim_vocals.wav", sim_vocals / peak, STEM_SR, subtype="PCM_16")
    sf.write(folder / "sim_backing.wav", sim_backing / peak, STEM_SR, subtype="PCM_16")
    return folder / "mix.wav"


def stem_for(case: SongCase, stem: str) -> str:
    """"auto": the model's stem for a real take, the simulated one for the synthetic singer (the
    model hands that singer to the instrumental when a piano plays; see the CSD notes above)."""
    if stem != "auto":
        return stem
    return "mdx" if case.kind == "csd" else "sim"


def ensure_stems(data: Path, case: SongCase, stem: str) -> tuple[Path, Path, Path]:
    """(mix, vocal stem, instrumental) for ``stem`` "mdx", "sim" or "auto" (``stem_for``)."""
    stem = stem_for(case, stem)
    mix = ensure_rendered(data, case)
    folder = mix.parent
    if stem == "sim":
        return mix, folder / "sim_vocals.wav", folder / "sim_backing.wav"
    vocals, backing = folder / "mdx_vocals.wav", folder / "mdx_backing.wav"
    if not backing.exists():
        from app.pipeline import separate

        if not separate.available():
            raise SystemExit(f"no separation model at {separate.model_path()} (set NF_MDX_MODEL_PATH, or --stem sim)")
        started = time.time()
        separate.separate_file(mix, vocals, backing_path=backing)
        print(f"separated {case.name} in {time.time() - started:.0f}s", flush=True)
        # Separated, the mix is read only as the transcriber reads it: keep it at that rate (a
        # quarter of the disk).  Delete the folder to separate it again.
        import librosa
        import soundfile as sf

        y, _ = librosa.load(mix, sr=STEM_SR, mono=True)
        sf.write(mix, y.astype(np.float32), STEM_SR, subtype="PCM_16")
    return mix, vocals, backing


# ── The song path ─────────────────────────────────────────────────────────────


def transcribe_song(mix: Path, vocals: Path, backing: Path, fast: bool = True):
    """What ``queue._separate_and_transcribe`` does with a separated song (melody mode, no key,
    tempo or meter given), with the separation already done.  Returns (result, read)."""
    from app.jobs.queue import _stem_min_notes
    from app.pipeline import separate
    from app.pipeline.transcriber import LowConfidenceError, transcribe

    def read(path: Path, stem: bool):
        return transcribe(path, mode="melody", fast=fast and stem, tempo_source=mix if stem else None,
                          audio_preview=False, chord_source=backing if stem else mix)

    if separate.voice_share_db(vocals, backing) < separate.VOICE_MIN_SHARE_DB:
        return read(mix, False), "mix"
    try:
        result = read(vocals, True)
    except LowConfidenceError:
        result = None
    if result is None or len(result.notes) < _stem_min_notes(mix):
        found = 0 if result is None else len(result.notes)
        try:
            mixture = read(mix, False)
        except LowConfidenceError:
            if result is None:
                raise
            mixture = None
        if mixture is not None and (result is None or len(mixture.notes) > found):
            return mixture, "mix"
    return result, "stem"


# ── Scoring ───────────────────────────────────────────────────────────────────

_SYLLABLE = {0: "d", 1: "de", 2: "r", 3: "ma", 4: "m", 5: "f", 6: "fe", 7: "s", 8: "se", 9: "l", 10: "ta", 11: "t"}


def _doh_of(key: str) -> int:
    from app.pipeline import solfa
    from app.pipeline.transcriber import _parse_key_override

    k = _parse_key_override(key)
    return solfa.doh_pitch_class(k.tonic.pitchClass, k.mode)


def score(case: SongCase, result) -> dict[str, float]:
    from tests.accuracy.runner import _prefixed

    # Both sides on the audio clock, in beats from the start of the file: a song has an intro,
    # and a note the sheet invents there must count as one extra note, not move every other
    # note off its place (the other corpora's metrics anchor both sides at their first note).
    published = reference(case)
    ref = [replace(r, onset_beat=r.onset_sec * case.tempo_bpm / 60.0) for r in published]
    spb = 60.0 / result.tempo
    heard = [replace(n, start_beat=max(0.0, result.beat_origin_sec + n.start_beat * spb) / spb) for n in result.notes]
    flat: dict[str, float] = {}
    flat.update(_prefixed("notes", metrics.note_metrics_seconds(ref, heard, result.tempo, case.tempo_bpm)))
    flat.update(_prefixed("beats", metrics.onset_metrics_beats(ref, heard, result.tempo, case.tempo_bpm)))
    flat.update(_prefixed("key", metrics.key_metrics(case.key, result.key)))
    tempo = metrics.tempo_metrics(case.tempo_bpm, result.tempo)
    flat.update(_prefixed("tempo", tempo))
    flat["tempo.level_right"] = tempo["metrical_factor"] == 1.0
    flat.update(_prefixed("solfa", metrics.solfa_metrics(ref, heard, case.key, result.tempo, case.tempo_bpm)))
    flat.update(_prefixed("seq", metrics.sequence_metrics(ref, heard, case.key)))
    flat.update(metrics.sheet_metrics(published, case.written, case.time_signature, case.bar_offset, case.tempo_bpm,
                                      result.notes, result.time_signature, result.tempo, result.beat_origin_sec))
    # What the user reads: each side's syllables in its own key, so a wrong doh costs every note.
    ref_doh, est_doh = _doh_of(case.key), _doh_of(result.key)
    ref_syl = [_SYLLABLE[(r.pitch_midi - ref_doh) % 12] for r in ref]
    est_syl = [_SYLLABLE[(n.pitch_midi - est_doh) % 12] for n in sorted(result.notes, key=lambda n: n.start_beat)]
    flat["solfa.read_error_rate"] = metrics._edit_distance(ref_syl, est_syl) / len(ref)
    flat["key.doh"] = ref_doh == est_doh
    flat["key.confidence"] = float(result.key_confidence)
    return flat


@dataclass
class SongOutcome:
    name: str
    tags: tuple[str, ...]
    ok: bool
    error: str
    ref_key: str
    est_key: str
    ref_tempo: int
    est_tempo: int
    est_time: str
    n_ref: int
    n_est: int
    read: str  # "stem" or "mix"
    seconds: float
    metrics: dict[str, float]


def run_case(args: tuple[SongCase, Path, str, bool]) -> SongOutcome:
    case, data, stem, fast = args
    started = time.time()
    try:
        mix, vocals, backing = ensure_stems(data, case, stem)
        result, read = transcribe_song(mix, vocals, backing, fast=fast)
    except Exception as exc:  # noqa: BLE001 - a failed case is a datum
        return SongOutcome(case.name, case.tags, False, f"{type(exc).__name__}: {exc}", case.key, "", case.tempo_bpm, 0,
                           "", len(reference(case)), 0, "", round(time.time() - started, 1), {})
    return SongOutcome(case.name, case.tags, True, "", case.key, result.key, case.tempo_bpm, result.tempo,
                       result.time_signature, len(reference(case)), len(result.notes), read,
                       round(time.time() - started, 1), score(case, result))


def run(cases: tuple[SongCase, ...], data: Path = DEFAULT_DATA, stem: str = "auto", fast: bool = True,
        jobs: int = 1) -> list[SongOutcome]:
    """Every case in order.  Renders and separations run first, one at a time (the model takes
    every core); the transcriptions then run across ``jobs`` processes."""
    for case in cases:
        ensure_stems(data, case, stem)
    work = [(case, data, stem, fast) for case in cases]
    if jobs <= 1:
        return [run_case(w) for w in work]
    from concurrent.futures import ProcessPoolExecutor

    with ProcessPoolExecutor(max_workers=jobs) as pool:
        return list(pool.map(run_case, work, chunksize=1))


COLUMNS = ("notes.f1", "key.doh", "solfa.read_error_rate", "seq.syllable_error_rate", "solfa.chromatic_ghosts",
           "tempo.level_right", "meter.exact", "pickup.exact", "bars.in_right_bar", "rhythm.ioi_exact")
SHORT = {"notes.f1": "notes.f1", "key.doh": "doh", "solfa.read_error_rate": "read_err",
         "seq.syllable_error_rate": "syl_err", "solfa.chromatic_ghosts": "ghosts", "tempo.level_right": "level",
         "meter.exact": "meter", "pickup.exact": "pickup", "bars.in_right_bar": "in_bar", "rhythm.ioi_exact": "ioi"}


def groups(outcomes: list[SongOutcome]) -> dict[str, dict[str, float]]:
    """Means per set, per set and split, and per production feature within each."""
    from tests.accuracy.runner import aggregate

    by: dict[str, list] = {}
    for o in outcomes:
        split, kind = o.tags[1], o.tags[2]
        by.setdefault(kind, []).append(o)
        by.setdefault(f"{kind}/{split}", []).append(o)
        for tag in o.tags[3:]:
            by.setdefault(f"{kind}/{split}/{tag}", []).append(o)
    return {name: aggregate(members) for name, members in sorted(by.items())}



if __name__ == "__main__":  # pragma: no cover
    raise SystemExit("run it through the report: python -m tests.accuracy.report --songs")
