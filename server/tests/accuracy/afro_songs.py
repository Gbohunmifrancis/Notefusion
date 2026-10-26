"""Afrobeats benchmark: songs in the styles of Afrobeats, amapiano and highlife, whose notes are known.

    python -m tests.accuracy.report --songs --set afro --jobs 3           # all 40, both halves
    python -m tests.accuracy.report --songs --set afro --split dev        # tune on this half only
    python -m tests.accuracy.report --songs --set afro --stem mdx         # through the separation model
    python -m tests.accuracy.report --songs --set afro --write-baseline   # afro_baseline.json

The studio songs (``tests.accuracy.studio_songs``) are hymn tunes and children's songs over piano,
pad and a rock kit: square phrases on the beat. The music people bring from Nigeria and Ghana is
not that, and nothing measured how the song path reads it. Here each song is composed from its
name (``compose``; nothing random at run time) the way the style writes a vocal line, and played
by the style's band, so the notes, the doh, the tempo and the bar lines are known:

  rhythm    phrases that start off the beat (on the "e" or the "a"), notes on the sixteenths,
            the dotted-eighth groupings of the 3-3-2 feel, repeated-note chants, a held note that
            lands off the beat to end the phrase, a breath between phrases
  pitch     the minor or major pentatonic with the odd other scale tone, a held or phrase-final
            note on a tone of the bar's chord, a run of sixteenths into the last note (melisma)
  harmony   the loops the style lives on, one chord a bar: i-VI-III-VII, i-iv-VI-VII, IV-V-iii-vi,
            I-V-vi-IV, ii-V-I, two-chord vamps
  voice     the synthetic singer of the studio songs (``studio_songs.render_voice``): wide scoops
            and slides, light vibrato, or auto-tune (no vibrato, no pitching error, quick snaps);
            some songs doubled
  group     call and response: in some songs the third phrase is answered by a group singing the
            reply in unison with a third under it (the reply is the tune; the third is not), and
            ad-libs ("eh!", "yeah") between phrases, which are not
  band      afrobeats: kick 1, 2&, 3, 4& under claps on 2 and 4, rim on the 3-3-2, shaker
            sixteenths, a syncopated bass, keys on the off-beats, a picked guitar;
            amapiano: four on the floor, the log drum (a pitched, bending bass hit) for the bass,
            a pad with sevenths, shaker; highlife: an off-beat guitar arpeggio, bell on the
            3-3-2, a walking bass, and on half the songs a talking drum bending through the
            voice's own range between the phrases

Forty songs, 20 dev and 20 test by index. The reference is the lead line and the group's reply
as written; it is scored as the studio songs are (``studio_songs.score``). With ``--stem auto``
(the default) the synthetic singer gets the simulated stem, as the hymn songs do; ``--stem mdx``
puts the mix through the separation model, which is where the log drum, the talking drum and the
guitar would leak into the voice. The real thing (recordings whose melodies a musician has
written out) is the next step; this set is what can be run on every change.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np

from tests.accuracy import hymn_corpus as hc
from tests.accuracy import studio_songs as ss

N_SONGS = 40
STYLES = ("afrobeats", "afrobeats", "amapiano", "highlife")
SIXTEENTH = 0.25  # beats

# Chord loops, one chord a bar: (semitones above the tonic, "M" major / "m" minor).
LOOPS = {
    "minor": (
        ((0, "m"), (8, "M"), (3, "M"), (10, "M")),  # i VI III VII
        ((0, "m"), (5, "m"), (8, "M"), (10, "M")),  # i iv VI VII
        ((0, "m"), (3, "M"), (5, "m"), (10, "M")),  # i III iv VII
        ((0, "m"), (5, "m")),  # i iv vamp
        ((0, "m"), (10, "M"), (8, "M"), (10, "M")),  # i VII VI VII
    ),
    "major": (
        ((5, "M"), (7, "M"), (4, "m"), (9, "m")),  # IV V iii vi
        ((0, "M"), (7, "M"), (9, "m"), (5, "M")),  # I V vi IV
        ((2, "m"), (7, "M"), (0, "M"), (0, "M")),  # ii V I I
        ((0, "M"), (5, "M")),  # I IV vamp
        ((9, "m"), (5, "M"), (0, "M"), (7, "M")),  # vi IV I V
    ),
}
_PENTATONIC = {"minor": (0, 3, 5, 7, 10), "major": (0, 2, 4, 7, 9)}
_OTHER = {"minor": (2, 8), "major": (5, 11)}  # the scale's other tones, used now and then
VOCAL_BARS = 8  # four two-bar phrases


def _h(*parts: object) -> int:
    return ss._h("afro", *parts)


def _pick(slug: str, field: str, options: tuple):
    return options[_h(slug, field) % len(options)]


def _chord_pcs(tonic: int, chord: tuple[int, str]) -> tuple[int, ...]:
    root = (tonic + chord[0]) % 12
    return (root, (root + (4 if chord[1] == "M" else 3)) % 12, (root + 7) % 12)


# ── Composition ───────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Composition:
    style: str
    tonic: int
    mode: str
    tempo: int
    loop: tuple[tuple[int, str], ...]
    # Every sounding note of the reference: (pitch, start in sixteenths from bar 0 of the tune,
    # written length in sixteenths, slurred from the note before, sung by the group).
    notes: tuple[tuple[int, int, int, bool, bool], ...]
    response: bool  # the third phrase is answered by a group
    adlibs: bool
    talking_drum: bool
    autotune: bool


def _rhythm(rng: np.random.Generator, span: int, start: int) -> list[tuple[int, int]]:
    """(onset, length) in sixteenths inside a phrase of ``span``: off-beat starts, sixteenths and
    dotted eighths, a chant of repeated notes now and then, a held note off the beat to end, and
    at least two sixteenths of breath before the span ends."""
    out: list[tuple[int, int]] = []
    pos = start
    end_by = span - 2
    while True:
        held = int(rng.choice((3, 4, 5, 6)))
        if pos + held > end_by or (out and pos >= end_by - 8 and rng.random() < 0.5):
            break
        if rng.random() < 0.18:  # a chant: three or four of the same short length
            step = int(rng.choice((1, 2)))
            count = int(rng.choice((3, 4)))
            if pos + step * count + 3 > end_by:
                break
            out += [(pos + k * step, step) for k in range(count)]
            pos += step * count
            continue
        length = int(rng.choice((1, 2, 2, 3, 3, 4)))
        if pos + length + 3 > end_by:
            break
        out.append((pos, length))
        pos += length
        if rng.random() < 0.12:  # a sixteenth's breath inside the phrase
            pos += 1
    # The last note: held, starting off the beat when it can, ending before the breath.
    room = end_by - pos
    if room >= 3:
        if pos % 2 == 0 and room >= 4 and rng.random() < 0.6:
            pos += 1  # pushed onto the "e" or the "a"
            room -= 1
        out.append((pos, int(min(room, rng.choice((3, 4, 5, 6))))))
    return out


def _pitches(rng: np.random.Generator, rhythm: list[tuple[int, int]], tonic: int, mode: str,
             chords: list[tuple[int, ...]], low: int, high: int, start_pitch: int) -> list[int]:
    """A walk on the pentatonic (the scale's other tones now and then); a long or phrase-final
    note lands on a tone of its bar's chord; a chant repeats its pitch."""
    pool = sorted(m for m in range(low, high + 1) if (m - tonic) % 12 in _PENTATONIC[mode])
    extra = [m for m in range(low, high + 1) if (m - tonic) % 12 in _OTHER[mode]]
    out: list[int] = []
    current = min(pool, key=lambda m: abs(m - start_pitch))
    previous_len = None
    for i, (onset, length) in enumerate(rhythm):
        chord = chords[onset // 16]
        chant = previous_len is not None and length == previous_len and length <= 2 and rng.random() < 0.55
        if not chant:
            k = min(range(len(pool)), key=lambda i: abs(pool[i] - current))  # a chord or passing tone may sit between
            step = int(rng.choice((-2, -1, -1, -1, 0, 1, 1, 1, 2, 3, -3)))
            current = pool[int(np.clip(k + step, 0, len(pool) - 1))]
            if extra and length <= 2 and rng.random() < 0.08:  # a passing scale tone off the pentatonic
                current = min(extra, key=lambda m: abs(m - current))
            if length >= 3 or i == len(rhythm) - 1:
                tones = [m for m in range(low, high + 1) if m % 12 in chord]
                current = min(tones, key=lambda m: (abs(m - current), m))
        out.append(current)
        previous_len = length
    return out


def compose(slug: str) -> Composition:
    """The song called ``slug``, the same every time."""
    rng = np.random.default_rng(_h(slug, "compose") % 2 ** 32)
    style = _pick(slug, "style", STYLES)
    mode = _pick(slug, "mode", ("minor", "minor", "minor", "major", "major"))
    tonic = _h(slug, "tonic") % 12
    tempo = {"afrobeats": int(rng.integers(96, 113)), "amapiano": int(rng.integers(108, 116)),
             "highlife": int(rng.integers(118, 133))}[style]
    loop = LOOPS[mode][_h(slug, "loop") % len(LOOPS[mode])]
    chords = [_chord_pcs(tonic, loop[b % len(loop)]) for b in range(VOCAL_BARS)]
    male = _pick(slug, "voice", ("female", "female", "male")) == "male"
    centre = 54 if male else 66
    # The tonic nearest the voice's middle, so the line sits in the voice whatever the key.
    home = min((centre - 12 + ((tonic - centre) % 12) + 12 * k for k in range(3)), key=lambda m: abs(m - centre))
    low, high = home - 5, home + 9
    response = _pick(slug, "response", (True, True, False))
    melisma = _pick(slug, "melisma", (True, False))
    notes: list[tuple[int, int, int, bool, bool]] = []
    pitch = home + int(rng.choice((0, 3, 7))) if mode == "minor" else home + int(rng.choice((0, 4, 7)))
    for phrase in range(VOCAL_BARS // 2):
        base = phrase * 32
        start = int(rng.choice((0, 1, 2, 2, 3, 4, 6)))
        spans = [(start, 32)]
        group = [False]
        if response and phrase == 2:
            spans = [(start, 16), (int(rng.choice((0, 1, 2))) + 16, 32)]  # the call, then the reply
            group = [False, True]
        for (s, e), sung_by_group in zip(spans, group):
            rhythm = [(base + s + o, d) for o, d in _rhythm(rng, e - s, 0)]
            if not rhythm:
                continue
            line = _pitches(rng, rhythm, tonic, mode, chords, low, high, pitch)
            for (o, d), p in zip(rhythm, line):
                notes.append((p, o, d, False, sung_by_group))
            pitch = line[-1]
        if melisma:
            # A run of sixteenths into the phrase's last note: the note before it is cut to make room.
            last = notes[-1]
            if last[2] >= 4 and not last[4]:
                pool = sorted({m for m in range(low, high + 1) if (m - tonic) % 12 in _PENTATONIC[mode]})
                k = pool.index(last[0]) if last[0] in pool else min(range(len(pool)), key=lambda i: abs(pool[i] - last[0]))
                above = [pool[min(len(pool) - 1, k + 2)], pool[min(len(pool) - 1, k + 1)]]
                run = [(above[0], last[1], 1, False, False), (above[1], last[1] + 1, 1, True, False),
                       (last[0], last[1] + 2, last[2] - 2, True, False)]
                notes[-1:] = run
    # A note's onset is never inside the note before (a chant at a phrase's edge).
    clean: list[tuple[int, int, int, bool, bool]] = []
    for n in notes:
        if clean and n[1] < clean[-1][1] + clean[-1][2]:
            continue
        clean.append(n)
    return Composition(style=style, tonic=tonic, mode=mode, tempo=tempo, loop=loop, notes=tuple(clean),
                       response=response, adlibs=_pick(slug, "adlibs", (True, False)),
                       talking_drum=style == "highlife" and _pick(slug, "talking", (True, False)),
                       autotune=_pick(slug, "autotune", (True, False, False)))


def production_of(slug: str, comp: Composition) -> ss.Production:
    p = ss.Production(
        voice=_pick(slug, "voice", ("female", "female", "male")),
        tuning_cents=_pick(slug, "tuning", (0.0, 0.0, 0.0, 0.0, 10.0, -15.0)),
        detune_cents=_pick(slug, "detune", (3.0, 5.0, 8.0)),
        jitter_cents=_pick(slug, "jitter", (3.0, 5.0)),
        vibrato_cents=_pick(slug, "vibrato", (10.0, 20.0, 30.0)),
        vibrato_hz=_pick(slug, "vibrato_hz", (5.5, 6.0, 6.5)),
        scoop_cents=_pick(slug, "scoop", (40.0, 80.0, 120.0)),
        glide_sec=_pick(slug, "glide", (0.05, 0.08, 0.11)),
        falloff=_pick(slug, "falloff", (True, True, False)),
        reverb_rt60=_pick(slug, "rt60", (0.8, 1.1, 1.5)),
        reverb_wet_db=_pick(slug, "wet", (-15.0, -12.0, -10.0)),
        double=_pick(slug, "double", (True, False, False)),
        backing="response" if comp.response else "none",
        melisma=any(n[3] for n in comp.notes),
        keys=comp.style,
        lead_db=_pick(slug, "lead_db", (-2.0, 0.0, 2.0)),
        intro_bars=_pick(slug, "intro", (2, 3)),
    )
    if comp.autotune:
        p = replace(p, detune_cents=0.0, jitter_cents=1.0, vibrato_cents=0.0, scoop_cents=0.0, glide_sec=0.025,
                    falloff=False)
    return p


def _case(index: int) -> ss.SongCase:
    slug = f"afro{index:02d}"
    comp = compose(slug)
    prod = production_of(slug, comp)
    split = "dev" if index % 2 == 0 else "test"
    first = comp.notes[0][1]
    seq: list[tuple[int | None, float]] = []
    cursor = first
    for pitch, onset, length, _legato, _group in comp.notes:
        if onset > cursor:
            seq.append((None, (onset - cursor) * SIXTEENTH))
        seq.append((pitch, length * SIXTEENTH))
        cursor = onset + length
    bar_offset = (first % 16) * SIXTEENTH
    tags = ("song", split, "afro", prod.voice, "4/4", comp.style, comp.mode,
            "autotune" if comp.autotune else "natural", "response" if comp.response else "solo") + (
        ("adlibs",) if comp.adlibs else ()) + (("melisma",) if prod.melisma else ()) + (
        ("talking_drum",) if comp.talking_drum else ()) + (("double",) if prod.double else ())
    return ss.SongCase(
        name=f"{slug}__{comp.style}", slug=slug, split=split, key=hc._key_name(comp.tonic, comp.mode),
        tempo_bpm=comp.tempo, time_signature="4/4", bar_offset=bar_offset, bpb=4.0, notes=tuple(seq),
        written=tuple(n[2] * SIXTEENTH for n in comp.notes), legato=tuple(n[3] for n in comp.notes),
        production=prod, tags=tags, kind="afro",
    )


def cases() -> tuple[ss.SongCase, ...]:
    return tuple(_case(i) for i in range(N_SONGS))


# ── The band ──────────────────────────────────────────────────────────────────

SR = ss.SR


def _hz(midi: float) -> float:
    return 440.0 * 2.0 ** ((midi - 69.0) / 12.0)


def _log_drum(midi: float, dur: float) -> np.ndarray:
    """Amapiano's log drum: a round, pitched hit whose pitch drops a few semitones as it sounds."""
    n = int((dur + 0.15) * SR)
    t = np.arange(n) / SR
    bend = 3.0 * np.exp(-t / 0.05)
    f = _hz(midi) * 2.0 ** (bend / 12.0)
    phase = 2 * np.pi * np.cumsum(f) / SR
    out = np.sin(phase) + 0.45 * np.sin(2 * phase) + 0.2 * np.sin(3 * phase)
    return out * np.exp(-t / max(0.12, 0.5 * dur)) * np.clip(t / 0.003, 0, 1)


def _talking_drum(midi: float, dur: float, bend: float) -> np.ndarray:
    """A talking drum: an inharmonic membrane whose pitch glides ``bend`` semitones as it rings."""
    n = int((dur + 0.1) * SR)
    t = np.arange(n) / SR
    glide = bend * np.clip(t / max(0.05, 0.7 * dur), 0, 1)
    f = _hz(midi) * 2.0 ** (glide / 12.0)
    phase = 2 * np.pi * np.cumsum(f) / SR
    out = np.sin(phase) + 0.5 * np.sin(1.59 * phase) + 0.3 * np.sin(2.14 * phase)
    return 0.8 * out * np.exp(-t / 0.18) * np.clip(t / 0.002, 0, 1)


def _pluck(midi: float, dur: float, rng: np.random.Generator) -> np.ndarray:
    """A picked guitar string (Karplus-Strong)."""
    n = int((dur + 0.2) * SR)
    period = max(2, int(round(SR / _hz(midi))))
    buf = rng.uniform(-1, 1, period)
    out = np.empty(n)
    for i in range(n):
        j = i % period
        out[i] = buf[j]
        buf[j] = 0.996 * 0.5 * (buf[j] + buf[(j + 1) % period])
    stop = min(n, int(dur * SR))
    out[stop:] *= np.linspace(1, 0, n - stop)
    return 0.6 * out


def _bell(rng: np.random.Generator) -> np.ndarray:
    t = np.arange(int(0.15 * SR)) / SR
    f = 1250.0
    return 0.3 * (np.sin(2 * np.pi * f * t) + 0.6 * np.sin(2 * np.pi * 2.76 * f * t)) * np.exp(-t / 0.05)


def render_band(case: ss.SongCase, comp: Composition, n: int) -> np.ndarray:
    from tests.accuracy import songs as base

    p = case.production
    spb, origin = ss._grid(case)
    cents = p.tuning_cents / 100.0
    rng = np.random.default_rng(_h(case.slug, "band") % 2 ** 32)
    n_bars = int(np.ceil(n / SR / spb / 4.0))
    kick, clap, perc, bass, keys, guitar, talk = (np.zeros(n) for _ in range(7))
    tune_bar0 = origin / 4.0  # the band bar the tune's bar 0 is

    def at(bar: int, beat: float) -> float:
        return (bar * 4.0 + beat) * spb * SR + rng.normal(0, 0.002 * SR)

    for bar in range(n_bars):
        chord = comp.loop[int(bar - tune_bar0) % len(comp.loop)]
        pcs = _chord_pcs(comp.tonic, chord)
        root = 36 + ((pcs[0] - 36) % 12)
        fifth = root + 7
        if comp.style == "amapiano":
            for b in (0.0, 1.0, 2.0, 3.0):
                ss._add(kick, base._drum("kick", rng), at(bar, b))
            for b, m in ((0.75, root), (1.5, root), (2.25, fifth), (3.0, root + 12), (3.5, root)):
                ss._add(bass, 0.9 * _log_drum(m + cents, 0.45 * spb * 2), at(bar, b))
        elif comp.style == "afrobeats":
            for b in (0.0, 1.5, 2.0, 3.5):
                ss._add(kick, base._drum("kick", rng), at(bar, b))
            for b, m, d in ((0.0, root, 0.5), (0.75, root, 0.25), (1.5, fifth, 0.5), (2.5, root, 0.5), (3.25, root + 12, 0.5)):
                ss._add(bass, base._bass(m + cents, d * spb), at(bar, b))
            for b in (0.5, 1.5, 2.5, 3.5):  # keys stabs on the off-beats
                for m in ss._voicing(pcs, 60):
                    ss._add(keys, base._piano(m + cents, 0.3 * spb, vel=0.5), at(bar, b))
            for b, k in ((0.25, 0), (0.75, 1), (1.25, 2), (2.25, 1), (2.75, 0), (3.25, 2)):
                m = ss._voicing(pcs, 64)[k]
                ss._add(guitar, 0.6 * _pluck(m + cents, 0.25 * spb, rng), at(bar, b))
        else:  # highlife
            for b in (0.0, 2.0):
                ss._add(kick, base._drum("kick", rng), at(bar, b))
            for b, m in ((0.0, root), (1.0, root + 4 if chord[1] == "M" else root + 3), (2.0, fifth), (3.0, root + 12)):
                ss._add(bass, base._bass(m + cents, 0.9 * spb), at(bar, b))
            voiced = ss._voicing(pcs, 62)
            for k, b in enumerate(np.arange(0.25, 4.0, 0.5)):  # the off-beat arpeggio
                m = voiced[k % 3] + (12 if k % 4 == 3 else 0)
                ss._add(guitar, _pluck(m + cents, 0.45 * spb, rng), at(bar, b))
            for b in (0.0, 0.75, 1.5, 2.0, 2.75, 3.5):
                ss._add(perc, _bell(rng), at(bar, b))
        if comp.style != "highlife":
            for b in (1.0, 3.0):
                ss._add(clap, base._drum("snare", rng), at(bar, b))
            for b in (0.0, 0.75, 1.5, 2.0, 2.75, 3.5):  # rim on the 3-3-2
                ss._add(perc, 0.5 * base._drum("hat", rng), at(bar, b))
        for b in np.arange(0.0, 4.0, 0.25):  # shaker sixteenths, the "e" and "a" lighter
            ss._add(perc, base._drum("hat", rng) * (1.0 if b % 0.5 == 0 else 0.55), at(bar, b))
        if comp.style == "amapiano":
            span = 4.0 * spb
            for m in ss._voicing(pcs, 55) + [55 + ((pcs[0] + (11 if chord[1] == "M" else 10) - 55) % 12)]:
                ss._add(keys, 0.7 * ss._pad(m + cents, span), bar * 4.0 * spb * SR)
    if comp.talking_drum:
        # Between the phrases, where the voice rests: a few bending strokes in the voice's own range.
        for phrase in range(VOCAL_BARS // 2):
            bar = int(tune_bar0) + phrase * 2 + 1
            for b, bend in ((2.75, 2.0), (3.0, -1.5), (3.5, 3.0)):
                m = 55 + (comp.tonic - 55) % 12
                ss._add(talk, _talking_drum(m + cents, 0.3 * spb, bend), at(bar, b))
    drums = kick + 0.7 * clap + 0.4 * perc
    tuned = bass + 0.5 * keys + 0.5 * guitar + 0.7 * talk
    return np.stack([drums + tuned + 0.15 * perc, drums + tuned - 0.1 * perc])


# ── The voices ────────────────────────────────────────────────────────────────


def render(case: ss.SongCase) -> ss.Rendered:
    """The song: the lead (and its double), the group's reply with a third under it, ad-libs, the
    band, reverb and mastering as the studio songs have them."""
    comp = compose(case.slug)
    p = case.production
    spb, origin = ss._grid(case)
    tune = ss._tune(case)
    n_bars = int(np.ceil((max(x.beat + x.written for x in tune) + origin) / case.bpb)) + 1
    n = int((n_bars * case.bpb * spb + 2.5) * SR)
    male = p.voice == "male"
    sung_by_group = [n_[4] for n_ in comp.notes]
    line = [(x.pitch, x.beat, x.dur, x.phrase_start, x.phrase_end, x.legato) for x in tune]
    lead_line = [x for x, g in zip(line, sung_by_group) if not g]
    group_line = [x for x, g in zip(line, sung_by_group) if g]

    lead = ss.render_voice(ss._sung_line(case, lead_line, spb, origin, "lead"), n, p,
                           _h(case.slug, "lead_voice") % 2 ** 32, male)
    left, right = lead.copy(), lead.copy()
    lead_rms = ss._voiced_rms(lead)
    if p.double:
        double = ss.render_voice(ss._sung_line(case, lead_line, spb, origin, "lead", timing_sd=0.012), n, p,
                                 _h(case.slug, "double_voice") % 2 ** 32, male, detune_scale=1.2)
        g = 10 ** (-4.0 / 20.0)
        left += 0.75 * g * double
        right += 0.35 * g * double
    if group_line:
        # The reply: two singers in unison, a third under it (the scale's), a little loose in time.
        scale = {(comp.tonic + d) % 12 for d in ((0, 2, 3, 5, 7, 8, 10) if comp.mode == "minor" else (0, 2, 4, 5, 7, 9, 11))}
        under = [(next((m for m in (x[0] - 3, x[0] - 4) if m % 12 in scale), x[0] - 3),) + x[1:] for x in group_line]
        for k, (voices, gain_db, pan) in enumerate(((group_line, -1.0, 0.3), (group_line, -3.0, 0.7), (under, -7.0, 0.5))):
            v = ss.render_voice(ss._sung_line(case, voices, spb, origin, f"group{k}", timing_sd=0.018), n,
                                replace(p, scoop_cents=30.0), _h(case.slug, f"group_voice{k}") % 2 ** 32,
                                male if k != 1 else not male, vibrato_scale=0.5, detune_scale=1.5)
            g = 10 ** (gain_db / 20.0) * lead_rms / max(1e-9, ss._voiced_rms(v))
            left += (1 - pan) * g * v
            right += pan * g * v
    if comp.adlibs:
        # Between the phrases: a short high "eh!" or "yeah" that slides, 9 dB under the lead. Not the tune.
        rng = np.random.default_rng(_h(case.slug, "adlibs") % 2 ** 32)
        shouts = []
        for i, x in enumerate(tune[:-1]):
            gap = tune[i + 1].beat - (x.beat + x.dur)
            if gap >= 1.0:
                pitch = x.pitch + int(rng.choice((7, 9, 12)))
                shouts.append((pitch, x.beat + x.dur + 0.25, min(0.75, gap - 0.5), True, True, False))
        if shouts:
            ad = ss.render_voice(ss._sung_line(case, shouts, spb, origin, "adlib"), n,
                                 replace(p, scoop_cents=150.0, falloff=True), _h(case.slug, "adlib_voice") % 2 ** 32, male)
            g = 10 ** (-9.0 / 20.0) * lead_rms / max(1e-9, ss._voiced_rms(ad))
            left += 0.4 * g * ad
            right += 0.6 * g * ad
    dry = np.stack([left, right])
    wet_gain = 10 ** (p.reverb_wet_db / 20.0)
    vocals = dry + wet_gain * np.stack([ss._reverb(left, p.reverb_rt60, _h(case.slug, "rv_l") % 2 ** 32),
                                        ss._reverb(right, p.reverb_rt60, _h(case.slug, "rv_r") % 2 ** 32)])
    band = render_band(case, comp, n)
    voiced = np.abs(lead) > 0.05 * np.max(np.abs(lead))
    band *= np.sqrt(np.mean(lead[voiced] ** 2)) / max(1e-9, np.sqrt(np.mean(band.mean(axis=0)[voiced] ** 2)))
    band *= 10 ** (-p.lead_db / 20.0)
    mastered, gain = ss._compress(vocals + band)
    return ss.Rendered(mix=mastered, vocals=vocals * gain, band=band * gain)
