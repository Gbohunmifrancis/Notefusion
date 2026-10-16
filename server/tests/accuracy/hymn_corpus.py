"""The hymn corpus: the website's published hymn tunes, played and sung, scored against the score.

Every other corpus here is 4/4 from its first bar line, so a pipeline that always writes 4/4
from the first note scores perfect on meter and bars there.  The hymn pages
(``content/hymns``, the Open Hymnal import rendered by ``tools/blog``) carry the exact
published melody of each tune — 3/4, 6/8, 3/2, 6/4, 2/2 as well as 4/4, pickups, dotted
rhythms and semiquavers — so they are the yardstick for the half of a transcription the other
corpora cannot see: the time signature, where the bar lines go, the rhythm and the tempo's
metrical level.

Ground truth is the published tune: its notes and durations (``RefNote``), its time signature
and its pickup.  ``HymnCase.bar_offset`` is the beat inside the first bar where the first note
falls (``bpb - pickup`` with a pickup, 0 without), counted in quarter beats as the blog's
``parseMelody`` counts them (6/8 is three quarter beats a bar).

Read with a Python port of ``tools/blog/lib/solfa.mjs`` ``parseMelody`` (``parse_melody``);
``tests/test_hymn_corpus.py`` checks the port against the blog's own parser when node is
there, and against each hymn's underlay syllable count (which the blog build enforces) when
it is not.

Each tune is rendered twice, once per synth:

  instrument  ``synth.render`` — the instrument corpus's sustained tone, played as written
  sung        ``vocal_synth.render`` in one of the vocal corpus's singing styles (amateurs
              among them), breathing where the words are punctuated: the breath comes out of the
              end of the note before it, so its onset and every bar line stay where they were

at a tempo and a key moved from the published ones by a per-tune amount drawn from the slug
hash (tempo x0.85-1.15, -5..+5 semitones, and about a third of the sung takes an octave down
as a man would sing them).  Nothing is random at run time.

The split.  Each tune is ``dev`` (tune a detector on it) or ``test`` (held out: report it,
never look at it while tuning) by a hash of its slug — frozen by construction, since a slug's
hash never changes and a new hymn joins one side without moving any other.  ``HOLDOUT_SALT``
was fixed before any number was read; it is not a knob.

Only the tunes of published (non-draft) hymns are in it, once each however many texts share a
tune.  ``FAST_SLUGS`` is the handful pytest runs on every commit (``tests/test_hymn_corpus``).
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, replace
from pathlib import Path

from tests.accuracy.synth import RenderOptions
from tests.accuracy.vocal_corpus import STYLES as VOCAL_STYLES
from tests.accuracy.vocal_synth import VocalOptions

REPO_ROOT = Path(__file__).resolve().parents[3]
HYMNS_DIR = REPO_ROOT / "content" / "hymns"
TUNES_DIR = HYMNS_DIR / "tunes"

HOLDOUT_SALT = "notefusion-hymn-split-v1"

# The sung takes' styles, from the vocal corpus: clean, the two untrained singers, syllables,
# a developed vibrato, and the slow drift.
SUNG_STYLES = ("hum_clean", "hum_amateur", "ah_amateur", "da_syllables", "ah_vibrato", "hum_drift")

TEMPO_FACTORS = (0.85, 0.92, 1.0, 1.08, 1.15)

# A handful for pytest: two 4/4 with and without a pickup, a 3/4 with one, a 6/8, a 3/2.
FAST_SLUGS = ("old-hundredth", "new-britain", "st-anne", "adeste-fideles", "duke-street")

Notes = tuple[tuple[int | None, float], ...]


# ── The blog's melody format ─────────────────────────────────────────────────

_LETTER_PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_PC_NAME = ("C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")


def parse_pitch(name: str) -> int:
    """"F#4" / "Bb3" / "C5" -> MIDI (C4 = 60), as ``solfa.mjs`` ``parsePitch``."""
    m = re.fullmatch(r"([A-Ga-g])(#|b|♯|♭)?(-?\d)", name.strip())
    if not m:
        raise ValueError(f"not a pitch: {name!r}")
    acc = 1 if m.group(2) in ("#", "♯") else -1 if m.group(2) in ("b", "♭") else 0
    return (int(m.group(3)) + 1) * 12 + _LETTER_PC[m.group(1).upper()] + acc


def beats_per_bar(time: str) -> float:
    """Quarter beats in a bar: 4/4 -> 4, 6/8 -> 3, 3/2 -> 6 (``choir.js`` ``beatsPerBar``)."""
    n, d = (int(x) for x in str(time).split("/"))
    return n * 4 / d


@dataclass(frozen=True)
class ParsedNote:
    pitch_midi: int
    start_beat: float  # on the bar grid: bar k starts at k * bpb, the first note at ``offset``
    dur_beats: float


@dataclass(frozen=True)
class ParsedMelody:
    notes: tuple[ParsedNote, ...]
    offset: float
    end_beat: float
    bpb: float
    pickup: float
    time: str


def parse_melody(text: str, time: str, pickup: float = 0) -> ParsedMelody:
    """A port of ``tools/blog/lib/solfa.mjs`` ``parseMelody``: the same bars, rests, ties and checks."""
    bpb = beats_per_bar(time)
    raw = [b.strip() for b in str(text).split("|")]
    bars = [b for i, b in enumerate(raw) if b or (0 < i < len(raw) - 1)]
    if not bars:
        raise ValueError("the melody is empty")
    events = []
    for bi, bar in enumerate(bars):
        total = 0.0
        for tok in bar.split():
            m = re.fullmatch(r"([^:]+):(\d*\.?\d+)(~?)", tok)
            if not m:
                raise ValueError(f"bar {bi + 1}: cannot read {tok!r}")
            dur = float(m.group(2))
            if not dur > 0 or abs(dur * 4 - round(dur * 4)) > 1e-9:
                raise ValueError(f"bar {bi + 1}: {tok!r} is not a whole number of quarter beats")
            rest = m.group(1).lower() == "r"
            events.append((None if rest else parse_pitch(m.group(1)), dur, m.group(3) == "~"))
            total += dur
        first, last = bi == 0, bi == len(bars) - 1
        if first and pickup:
            if abs(total - pickup) > 1e-9:
                raise ValueError(f"the pickup bar has {total} beats, not {pickup}")
        elif last and len(bars) > 1:
            last_want = bpb - pickup if pickup else bpb
            if abs(total - last_want) > 1e-9 and abs(total - bpb) > 1e-9:
                raise ValueError(f"the last bar has {total} beats; it should have {last_want}")
        elif abs(total - bpb) > 1e-9:
            raise ValueError(f"bar {bi + 1} has {total} beats, not {bpb}")
    offset = bpb - pickup if pickup else 0.0
    notes: list[list[float]] = []
    t, tie_open = offset, False
    for pitch, dur, tie in events:
        if pitch is None:
            tie_open = False
            t += dur
            continue
        prev = notes[-1] if notes else None
        if tie_open and prev and prev[0] == pitch and abs(prev[1] + prev[2] - t) < 1e-9:
            prev[2] += dur
        else:
            notes.append([pitch, t, dur])
        tie_open = tie
        t += dur
    return ParsedMelody(
        notes=tuple(ParsedNote(int(p), float(s), float(d)) for p, s, d in notes),
        offset=float(offset), end_beat=float(t), bpb=float(bpb), pickup=float(pickup or 0), time=str(time),
    )


# ── Cases ─────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class HymnCase:
    name: str  # "<slug>__instrument" / "<slug>__<style>"
    slug: str
    split: str  # "dev" or "test"
    render: str  # "instrument" or "sung"
    key: str  # the rendered key ("Bb major")
    tempo_bpm: int  # quarter beats a minute, as rendered
    time_signature: str  # the published one
    bar_offset: float  # quarter beat inside bar 0 where the first note sounds
    bpb: float
    notes: Notes  # (pitch | None, dur) laid end to end from the first note
    written: tuple[float, ...]  # each sounding note's written length (the breath comes out of ``notes``)
    options: RenderOptions | VocalOptions
    tags: tuple[str, ...]


def _hash(text: str) -> int:
    return int(hashlib.sha256(text.encode()).hexdigest()[:12], 16)


def split_of(slug: str) -> str:
    return "test" if _hash(HOLDOUT_SALT + ":" + slug) % 2 else "dev"


def _key_name(pc: int, mode: str) -> str:
    return f"{_PC_NAME[pc % 12]} {mode}"


def _parse_key(text: str) -> tuple[int, str]:
    m = re.fullmatch(r"\s*([A-G])(#|b)?\s+(major|minor)\s*", text)
    if not m:
        raise ValueError(f"not a key: {text!r}")
    pc = _LETTER_PC[m.group(1)] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)
    return pc % 12, m.group(3)


def syllabify(lyrics: str) -> list[str]:
    """``choir.js`` ``syllabify``: words split at "-", and each "_" a syllable of its own (a melisma)."""
    out: list[str] = []
    for word in str(lyrics or "").split():
        pieces = [p for p in word.split("-") if p]
        for i, piece in enumerate(pieces):
            for j, h in enumerate(piece.split("_")):
                out.append((h + "-" if i < len(pieces) - 1 else h) if j == 0 else "_")
    return out


def _phrase_ends(melody: ParsedMelody, underlay: str) -> set[int]:
    """Indexes of the notes a singer breathes after: the end of a word the underlay punctuates
    (",", ";", "!"...), carried past any "_" that holds that word's last syllable on."""
    syllables = syllabify(underlay)
    if len(syllables) != len(melody.notes):
        return set()
    out = set()
    for i, syl in enumerate(syllables[:-1]):
        if re.search(r"[,;:.!?]['’\")]*$", syl):
            j = i
            while j + 1 < len(syllables) and syllables[j + 1] == "_":
                j += 1
            out.add(j)
    return out


def _sequence(melody: ParsedMelody, breaths: set[int]) -> tuple[Notes, tuple[float, ...]]:
    """(pitch | None, dur) from the first note on, rests where the score has them, and a breath
    taken out of the end of each note ``breaths`` names (its onset does not move)."""
    seq: list[tuple[int | None, float]] = []
    written: list[float] = []
    cursor = melody.notes[0].start_beat
    for i, n in enumerate(melody.notes):
        if n.start_beat > cursor + 1e-9:
            seq.append((None, round(n.start_beat - cursor, 6)))
        breath = min(0.5, n.dur_beats / 2) if i in breaths else 0.0
        seq.append((n.pitch_midi, round(n.dur_beats - breath, 6)))
        if breath:
            seq.append((None, breath))
        written.append(n.dur_beats)
        cursor = n.start_beat + n.dur_beats
    while seq and seq[-1][0] is None:
        seq.pop()
    return tuple(seq), tuple(written)


def _transpose_into(notes: tuple[ParsedNote, ...], shift: int, low: int, high: int) -> int:
    """``shift`` moved by octaves until the tune lies inside [low, high] (or as near as it gets)."""
    lo = min(n.pitch_midi for n in notes)
    hi = max(n.pitch_midi for n in notes)
    while hi + shift > high and lo + shift - 12 >= low - 2:
        shift -= 12
    while lo + shift < low and hi + shift + 12 <= high + 2:
        shift += 12
    return shift


def load_tunes(hymns_dir: Path = HYMNS_DIR) -> list[tuple[str, dict, ParsedMelody, str]]:
    """(slug, tune json, parsed, underlay) for every tune a published hymn is sung to, sorted by
    slug; the underlay is the first such hymn's (by file name)."""
    used: dict[str, str] = {}
    for f in sorted(hymns_dir.glob("*.json")):
        h = json.loads(f.read_text(encoding="utf-8"))
        if not h.get("draft"):
            used.setdefault(h["tune"], h.get("underlay") or "")
    out = []
    for slug in sorted(used):
        t = json.loads((hymns_dir / "tunes" / f"{slug}.json").read_text(encoding="utf-8"))
        if not t.get("melody"):
            continue
        out.append((slug, t, parse_melody(t["melody"], t["time"], t.get("pickup") or 0), used[slug]))
    return out


def _cases() -> tuple[HymnCase, ...]:
    cases = []
    for slug, tune, melody, underlay in load_tunes():
        if not melody.notes:
            continue
        h = _hash(slug)
        tonic, mode = _parse_key(tune["key"])
        split = split_of(slug)
        bar_offset = melody.notes[0].start_beat
        start = "pickup" if bar_offset else "downbeat"
        common = dict(slug=slug, split=split, time_signature=melody.time, bar_offset=bar_offset, bpb=melody.bpb)

        # Instrument: published register moved -4..+4, tempo x0.85-1.15.
        shift = _transpose_into(melody.notes, (h % 9) - 4, 55, 81)
        tempo = int(round(tune["tempo"] * TEMPO_FACTORS[(h // 9) % len(TEMPO_FACTORS)]))
        seq, written = _sequence(melody, set())
        cases.append(HymnCase(
            name=f"{slug}__instrument", render="instrument", key=_key_name(tonic + shift, mode), tempo_bpm=tempo,
            notes=tuple((None if p is None else p + shift, d) for p, d in seq), written=written,
            options=RenderOptions(lead_in_sec=0.4), tags=("hymn", split, "instrument", melody.time, start), **common,
        ))

        # Sung: another key and tempo, one of the singing styles, a breath at each line end.
        g = h // 45
        style = SUNG_STYLES[g % len(SUNG_STYLES)]
        low_voice = (g // len(SUNG_STYLES)) % 3 == 0
        shift = _transpose_into(melody.notes, ((g // 18) % 11) - 5 - (12 if low_voice else 0),
                                43 if low_voice else 55, 67 if low_voice else 79)
        tempo = int(round(tune["tempo"] * TEMPO_FACTORS[(g // 198) % len(TEMPO_FACTORS)]))
        seq, written = _sequence(melody, _phrase_ends(melody, underlay))
        cases.append(HymnCase(
            name=f"{slug}__{style}", render="sung", key=_key_name(tonic + shift, mode), tempo_bpm=tempo,
            notes=tuple((None if p is None else p + shift, d) for p, d in seq), written=written,
            options=replace(VOCAL_STYLES[style]), tags=("hymn", split, "sung", melody.time, start, style), **common,
        ))
    return tuple(cases)


# Empty where the repository's content/ is not beside server/ (the worker's image).
CASES: tuple[HymnCase, ...] = _cases() if HYMNS_DIR.is_dir() else ()


def select(split: str = "", render: str = "", slugs: tuple[str, ...] = ()) -> tuple[HymnCase, ...]:
    return tuple(
        c for c in CASES
        if (not split or c.split == split) and (not render or c.render == render) and (not slugs or c.slug in slugs)
    )


def hymn_corpus_fingerprint(cases: tuple[HymnCase, ...] = CASES) -> str:
    digest = hashlib.sha256()
    for c in cases:
        digest.update(repr((c.name, c.split, c.key, c.tempo_bpm, c.time_signature, c.bar_offset, c.notes, c.options)).encode())
    return digest.hexdigest()[:16]
