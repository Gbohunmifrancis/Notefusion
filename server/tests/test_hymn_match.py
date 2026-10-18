"""Hymn recognition (``app.pipeline.hymn_match``): real library melodies sung transposed, at another
tempo, with wrong, missed and extra notes, in part or over several verses, are found; ordinary songs are
not; and the offer is the published score — rhythm, bars, pickup and meter — in the key that was sung.

Symbolic throughout (note lists, no audio), so it runs in milliseconds a query.
"""

import json
import random
from types import SimpleNamespace

import numpy as np
import pytest

from app.api.schemas import ResultDto
from app.pipeline import hymn_match as hm
from app.pipeline.transcriber import _parse_key_override

INDEX = hm.default_index()
SCORES = [e for e in INDEX.entries if e.kind == "score"]
BY_SLUG = {e.slug: e for e in INDEX.entries}
AT = {e.slug: i for i, e in enumerate(INDEX.entries)}


def _same_tune(a: str, b: str) -> bool:
    return a == b or INDEX.same_tune(AT[a], AT[b])


def _sing(notes, rng, *, transpose=0, tempo=1.0, wrong=0.0, drop=0.0, extra=0.0):
    """A rendition: moved, slowed or hurried, a share of notes wrong, missed or added, on a half-beat grid."""
    out = []
    for p, s, d in notes:
        if rng.random() < drop:
            continue
        q = p + transpose + (rng.choice([-2, -1, 1, 2]) if rng.random() < wrong else 0)
        out.append((q, s, d))
        if rng.random() < extra:
            out.append((q + rng.choice([-2, -1, 1, 2]), s + 0.75 * d, 0.25 * d))
    return [(p, round(s * tempo * 2) / 2, max(0.5, round(d * tempo * 2) / 2)) for p, s, d in out]


def _from_zero(notes):
    s0 = notes[0][1]
    return [(p, s - s0, d) for p, s, d in notes]


# ── The index ─────────────────────────────────────────────────────────────────


def test_the_index_holds_every_published_hymn_with_its_source_and_credit():
    raw = json.loads(hm.INDEX_PATH.read_text(encoding="utf-8"))
    assert raw["version"] == 1
    assert len(SCORES) >= 200
    for e in INDEX.entries:
        assert e.source and e.licence and e.credit and e.url.startswith("https://")
        assert e.kind in ("score", "incipit")
    ag = BY_SLUG["amazing-grace"]
    assert (ag.key, ag.time, ag.pickup) == ("G major", "3/4", 1.0)
    assert ag.notes[0] == (62, 2.0, 1.0)  # the pickup on the last beat of the first bar


# ── Found ─────────────────────────────────────────────────────────────────────


def test_a_clean_rendition_is_found_in_any_key_and_tempo_with_its_transposition_and_pace():
    ag = BY_SLUG["amazing-grace"]
    take = [(p + 5, s * 1.5, d * 1.5) for p, s, d in ag.notes]
    m = hm.match(take, seconds_per_unit=60 / 90)
    assert m is not None and m.entry.slug == "amazing-grace"
    assert m.transpose == 5
    # 1.5 take beats a hymn beat at 90 a minute: one hymn beat a second, so 60 to the minute.
    assert m.seconds_per_beat == pytest.approx(1.0, rel=0.05)


def test_every_hymn_is_found_from_a_clean_transposed_rendition():
    rng = random.Random(1)
    missed = []
    for e in SCORES:
        t = rng.randint(-6, 6)
        m = hm.match(_sing(e.notes, rng, transpose=t, tempo=rng.uniform(0.7, 1.5)))
        if m is not None:
            assert _same_tune(m.entry.slug, e.slug), (e.slug, m.entry.slug)
            if m.entry.slug == e.slug:
                assert m.transpose == t, e.slug
        elif len(hm.contour(e.notes).pitches) >= 20:
            missed.append(e.slug)
    # A tune of fewer than twenty notes is too little evidence in one verse; two verses of it are enough.
    assert missed == []
    short = BY_SLUG["lord-jesus-think-on-me"]
    end = short.notes[-1][1] + short.notes[-1][2] + 1
    two = [(p + 2, s + k * end, d) for k in range(2) for p, s, d in short.notes]
    assert hm.match(two).entry.slug == "lord-jesus-think-on-me"


def test_noisy_partial_and_multi_verse_renditions_are_found_and_never_misnamed():
    # Every tune, each sung from its own seed, so a tune added to the index never changes another's takes
    # (a random 60 drawn from the whole index reshuffled on every import). Measured on 2026-10-16 at 371
    # tunes: noisy 0.86, partial 0.91, verses 0.997, none misnamed; the same at 352 before that import.
    sample = SCORES
    found = {"noisy": 0, "partial": 0, "verses": 0}
    for e in sample:
        rng = random.Random(e.slug)
        t = rng.randint(-6, 6)
        n = len(e.notes)
        a = rng.randint(0, n // 3)
        takes = {
            # One wrong note in twelve, one in twenty missed and one in twenty extra.
            "noisy": _sing(e.notes, rng, transpose=t, tempo=rng.uniform(0.7, 1.5), wrong=0.08, drop=0.05, extra=0.05),
            # Sixty per cent of the tune, starting anywhere in its first third (mid-verse, or the refrain).
            "partial": _sing(_from_zero(e.notes[a:a + int(0.6 * n)]), rng, transpose=t, wrong=0.05),
            # Three verses, a breath between them.
            "verses": _sing([(p, s + k * (e.notes[-1][1] + e.notes[-1][2] + 1), d)
                             for k in range(3) for p, s, d in e.notes], rng, transpose=t, wrong=0.08, drop=0.05),
        }
        for kind, take in takes.items():
            m = hm.match(take)
            if m is not None:
                assert _same_tune(m.entry.slug, e.slug), (kind, e.slug, m.entry.slug)
                found[kind] += 1
    assert found["noisy"] >= 0.83 * len(sample)
    assert found["partial"] >= 0.75 * len(sample)
    assert found["verses"] >= 0.95 * len(sample)


def test_the_accuracy_corpus_hymn_tunes_are_recognised():
    from tests.accuracy.vocal_corpus import TUNES

    def notes(seq):
        t, out = 0.0, []
        for p, d in seq:
            if p is not None:
                out.append((p, t, d))
            t += d
        return out

    assert hm.match(notes(TUNES["amazing_grace"][2])).entry.slug == "amazing-grace"
    assert hm.match(notes(TUNES["greensleeves"][2])).entry.slug == "what-child-is-this"  # GREENSLEEVES


# ── Not found ─────────────────────────────────────────────────────────────────


def test_the_accuracy_corpora_non_hymn_melodies_match_nothing():
    from tests.accuracy import corpus
    from tests.accuracy.vocal_corpus import TUNES

    def notes(seq):
        t, out = 0.0, []
        for p, d in seq:
            if p is not None:
                out.append((p, t, d))
            t += d
        return out

    hymn_tunes = {"amazing_grace", "greensleeves", "ode_to_joy"}  # Amazing Grace, What Child Is This, Joyful Joyful
    for name, (_, _, seq) in TUNES.items():
        if name not in hymn_tunes:
            for reps in (1, 3):
                assert hm.match(notes(seq * reps)) is None, name
    for case in corpus.CASES:
        assert hm.match(notes(case.notes)) is None, case.name


def test_real_singers_songs_from_vocadito_match_nothing():
    # Clip 37 is "Aloha 'Oe", whose chorus is the Hawaiian melody HE LIVES ON HIGH is set to (31 of the
    # take's 37 notes in order): it may be offered that tune, and only that one.
    shared = {"37": "tune-he-lives-on-high"}
    frozen = json.loads((hm.INDEX_PATH.parent.parent.parent / "tests" / "accuracy" / "vocadito_frozen.json").read_text())
    for clip, ann in frozen["clips"].items():
        for who in ("A1", "A2"):
            if who in ann:
                found = hm.match([(p, i, 1.0) for i, p in enumerate(ann[who]["written"])])
                if clip in shared and found is not None:
                    assert found.entry.slug == shared[clip], (clip, who, found.entry.slug)
                else:
                    assert found is None, (clip, who)


def test_random_melodies_moving_like_hymns_match_nothing():
    rng = random.Random(3)
    follows: dict[int, list[int]] = {}
    for e in SCORES:
        ivs = list(hm.contour(e.notes).intervals)
        for a, b in zip(ivs, ivs[1:]):
            follows.setdefault(a, []).append(b)
    lengths = [d for e in SCORES for _, _, d in e.notes]
    for _ in range(150):
        ivs = [rng.choice(list(follows))]
        while len(ivs) < rng.randint(20, 90):
            ivs.append(rng.choice(follows.get(ivs[-1]) or list(follows)))
        p, t, take = 64, 0.0, []
        for x in [0] + ivs:
            p = max(45, min(84, p + x))
            d = rng.choice(lengths)
            take.append((p, t, d))
            t += d
        assert hm.match(take) is None


def test_too_short_a_take_is_never_matched():
    ag = BY_SLUG["amazing-grace"]
    assert hm.match(ag.notes[:8]) is None


# ── The offer ─────────────────────────────────────────────────────────────────


def _result(notes, key="A major", tempo=96):
    return SimpleNamespace(
        notes=[SimpleNamespace(pitch_midi=p, start_beat=s, dur_beats=d) for p, s, d in notes], key=key, tempo=tempo)


def test_the_offer_is_the_published_score_in_the_sung_key():
    ag = BY_SLUG["amazing-grace"]
    # Sung a tone above the hymnbook's G, in 4/4 as the worker writes it.
    offer = hm.offer(_result(_sing(ag.notes, random.Random(4), transpose=2, tempo=1.3), key="A major"))
    assert offer["slug"] == "amazing-grace" and offer["kind"] == "score"
    assert (offer["key"], offer["time_signature"], offer["pickup"]) == ("A major", "3/4", 1.0)
    assert offer["credit"] == ag.credit and offer["source"] and offer["licence"]
    assert [(n["pitch_midi"], n["start_beat"], n["dur_beats"]) for n in offer["notes"]] == [
        (p + 2, s, d) for p, s, d in ag.notes]
    assert [n["solfa"] + n["octave_mark"] for n in offer["notes"][:4]] == ["s,", "d", "m", "d"]
    assert offer["solfa_lines"][0] == "Doh is A"
    assert 50 <= offer["tempo"] <= 110
    assert offer["lyrics"].startswith("A-maz-ing")
    xml = offer["musicxml"]
    assert "<beats>3</beats>" in xml and "<fifths>3</fifths>" in xml
    assert '<measure implicit="yes" number="0">' in xml  # the pickup bar
    # It goes over the wire as the API expects it.
    wire = ResultDto.model_validate({
        "key": "A major", "key_confidence": 0.5, "tempo": 96, "time_signature": "4/4", "musicxml": "<s/>",
        "midi_base64": "", "notes": [], "solfa_lines": [], "overall_confidence": 0.5, "hymn_match": offer,
    }).model_dump(by_alias=True)
    assert wire["hymnMatch"]["timeSignature"] == "3/4"
    assert wire["hymnMatch"]["solfaLines"][0] == "Doh is A"
    assert wire["hymnMatch"]["musicxml"] == xml


def test_a_man_singing_the_hymn_is_offered_the_book_at_its_own_octave_in_his_key():
    ag = BY_SLUG["amazing-grace"]
    # Sung a tone above the book's G, an octave down: the take sits around D3-D4.
    take = _sing(ag.notes, random.Random(4), transpose=2 - 12, tempo=1.3)
    offer = hm.offer(_result(take, key="A major"))
    assert offer is not None and offer["slug"] == "amazing-grace" and offer["key"] == "A major"
    # The book's pitches moved to A (up a tone), not the octave he sang them in.
    assert [n["pitch_midi"] for n in offer["notes"]] == [p + 2 for p, _s, _d in ag.notes]
    assert [n["solfa"] + n["octave_mark"] for n in offer["notes"][:4]] == ["s,", "d", "m", "d"]
    # A key a fifth up is reached the nearer way, a fourth down: still the book's octave.
    offer = hm.offer(_result(_sing(ag.notes, random.Random(4), transpose=7 - 12, tempo=1.3), key="D major"))
    assert offer["key"] == "D major"
    assert [n["pitch_midi"] for n in offer["notes"]] == [p - 5 for p, _s, _d in ag.notes]


def test_the_sung_key_keeps_the_transcriptions_spelling_or_takes_the_plainer_signature():
    assert hm.sung_key("G major", 2, "A major") == "A major"
    assert hm.sung_key("G major", -6, "C# major") == "C# major"  # the same doh, as it was named
    assert hm.sung_key("G major", -6, None) == "Db major"
    assert hm.sung_key("E minor", 1, "G major") == "F minor"
    assert _parse_key_override(hm.sung_key("Eb major", 3, None)).tonic.pitchClass == 6


def test_no_offer_for_an_ordinary_song():
    rng = random.Random(5)
    take = [(60 + rng.choice([0, 2, 4, 5, 7, 9]), i * 0.5, 0.5) for i in range(40)]
    assert hm.offer(_result(take)) is None


# ── Related tunes ─────────────────────────────────────────────────────────────


def _family(opening, tails):
    """Tunes that share ``opening`` and then go their own ways, as a hymn tune's relatives do."""
    entries = []
    for k, tail in enumerate(tails):
        notes, t = [], 0.0
        for p in list(opening) + list(tail):
            notes.append((p, t, 1.0))
            t += 1.0
        entries.append(hm.Entry(kind="score", slug=f"relative-{k}", title=f"Relative {k}", tune=f"RELATIVE {k}",
                                url="https://example.org", source="test", licence="test", credit="test", notes=tuple(notes)))
    return entries


def test_a_note_for_note_take_wins_over_a_tune_that_shares_its_phrases_but_not_one_as_exact():
    rng = random.Random(12)
    opening = [60, 64, 62, 67, 65, 69, 67, 72, 71, 67, 64, 65, 62, 60, 59, 62]  # in no hymn we hold
    a_tail = [rng.choice([60, 62, 64, 67, 69, 71, 72, 74]) for _ in range(30)]
    b_tail = [rng.choice([60, 62, 64, 67, 69, 71, 72, 74]) for _ in range(30)]
    # B sings A's opening with two notes changed: a relative, not a copy.
    b_open = list(opening)
    b_open[5], b_open[12] = 71, 69
    a, b = _family(opening, [a_tail])[0], _family(b_open, [b_tail])[0]
    b = hm.Entry(**{**b.__dict__, "slug": "relative-b", "tune": "RELATIVE B"})
    index = hm.HymnIndex(list(INDEX.entries) + [a, b])
    take = [(p + 3, i * 1.0, 1.0) for i, p in enumerate(opening)]
    m, figures = hm.match(take, index=index, explain=True)
    assert m is not None and m.entry.slug == "relative-0", str(figures)


def test_a_take_both_relatives_sing_note_for_note_is_ambiguous_and_declined():
    rng = random.Random(13)
    opening = [60, 64, 62, 67, 65, 69, 67, 72, 71, 67, 64, 65, 62, 60, 59, 62, 64, 60]  # in no hymn we hold
    tails = [[rng.choice([60, 62, 64, 67, 69, 71, 72, 74]) for _ in range(40)] for _ in range(2)]
    index = hm.HymnIndex(list(INDEX.entries) + _family(opening, tails))
    assert not index.same_tune(len(INDEX.entries), len(INDEX.entries) + 1)
    take = [(p - 2, i * 1.0, 1.0) for i, p in enumerate(opening)]
    assert hm.match(take) is None  # the library alone does not know the opening
    assert hm.match(take, index=index) is None


# ── Recognition only ──────────────────────────────────────────────────────────


def _with_incipit(slug: str, notes_in_incipit: int = 18) -> hm.HymnIndex:
    """The library with one hymn's score swapped for an incipit: its opening phrase, a title and a link."""
    e = BY_SLUG[slug]
    incipit = hm.Entry(kind="incipit", slug=f"{slug}-incipit", title=e.title, tune=e.tune, url="https://example.org/tune",
                       source="Example Hymnary", licence="Index data", credit="Incipit from Example Hymnary.",
                       notes=tuple(_from_zero(list(e.notes[:notes_in_incipit]))))
    return hm.HymnIndex([x for x in INDEX.entries if x.slug != slug] + [incipit])


def test_an_incipit_names_the_hymn_from_its_opening_and_never_offers_a_score():
    index = _with_incipit("amazing-grace")
    ag = BY_SLUG["amazing-grace"]
    take = _sing(_from_zero(list(ag.notes[:24])), random.Random(6), transpose=3, tempo=1.2)
    offer = hm.offer(_result(take), index=index)
    assert offer is not None and offer["kind"] == "incipit" and offer["slug"] == "amazing-grace-incipit"
    assert "notes" not in offer and "musicxml" not in offer
    assert offer["url"] == "https://example.org/tune" and offer["source"] == "Example Hymnary"


def test_an_incipit_is_not_matched_from_the_middle_of_the_tune_or_by_another_song():
    index = _with_incipit("amazing-grace")
    ag = BY_SLUG["amazing-grace"]
    middle = _from_zero(list(ag.notes[18:32]))
    m = hm.match(middle, index=index)
    assert m is None or m.entry.kind != "incipit"
    rng = random.Random(7)
    for _ in range(40):
        take = [(60 + rng.choice([0, 2, 4, 5, 7, 9, 11, 12]), i * 1.0, 1.0) for i in range(24)]
        m = hm.match(take, index=index)
        assert m is None or m.entry.kind != "incipit"


# ── Scale ─────────────────────────────────────────────────────────────────────


def test_the_prefilter_keeps_the_true_hymn_among_ten_thousand_entries():
    rng = random.Random(8)
    fakes = []
    for i in range(10_000 - len(INDEX.entries)):
        p, t, notes = 60, 0.0, []
        for _ in range(rng.randint(30, 80)):
            p = max(48, min(84, p + rng.choice([-4, -3, -2, -1, 1, 2, 3, 4, 5, -5, 0])))
            d = rng.choice([0.5, 1.0, 1.0, 2.0])
            notes.append((p, t, d))
            t += d
        fakes.append(hm.Entry(kind="score", slug=f"fake-{i}", title="Fake", tune="", url="https://example.org",
                              source="test", licence="test", credit="test", notes=tuple(notes)))
    big = hm.HymnIndex(list(INDEX.entries) + fakes)
    ag = BY_SLUG["amazing-grace"]
    take = _sing(ag.notes, random.Random(9), transpose=4, tempo=1.2, wrong=0.05)
    assert BY_SLUG["amazing-grace"] in [big.entries[i] for i in big.prefilter(hm.contour(take))]
    m = hm.match(take, index=big)
    assert m is not None and m.entry.slug == "amazing-grace"


# ── The queue's hook ──────────────────────────────────────────────────────────


def test_the_queue_offers_a_hymn_after_a_melody_only(monkeypatch):
    from app.jobs import queue as q

    ag = BY_SLUG["amazing-grace"]
    take = _sing(ag.notes, random.Random(10), transpose=2)

    def job(mode_parts=None):
        result = _result(take)
        result.parts = mode_parts
        result.hymn_match = None
        return SimpleNamespace(id="abcdef123456", result=result)

    j = job()
    q._offer_hymn(j, "melody")
    assert j.result.hymn_match["slug"] == "amazing-grace"
    for mode, parts in (("choir", None), ("chords", None), ("melody", {"alto": {}})):
        j = job(parts)
        q._offer_hymn(j, mode)
        assert j.result.hymn_match is None, mode

    monkeypatch.setenv("NF_HYMN_MATCH", "0")
    j = job()
    q._offer_hymn(j, "melody")
    assert j.result.hymn_match is None
    monkeypatch.delenv("NF_HYMN_MATCH")

    def boom(_result):
        raise RuntimeError("index unreadable")

    monkeypatch.setattr(hm, "offer", boom)
    j = job()
    q._offer_hymn(j, "melody")  # never fails the job
    assert j.result.hymn_match is None


def test_matching_is_fast():
    import time

    ag = BY_SLUG["amazing-grace"]
    take = _sing([(p, s + k * 40, d) for k in range(3) for p, s, d in ag.notes], random.Random(11), wrong=0.05)
    t0 = time.perf_counter()
    hm.match(take)
    assert time.perf_counter() - t0 < 2.0
    assert np.isfinite(hm.match(take).confidence)
