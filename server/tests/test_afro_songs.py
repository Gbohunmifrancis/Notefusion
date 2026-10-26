"""The Afrobeats benchmark is built as it says: the songs are composed from their names, the lines
move as the style's do, and the reference is what the lead and the group's reply sing.

``python -m tests.accuracy.report --songs --set afro`` runs it in full (afro_report.json, against
afro_baseline.json); here only the composition, which is cheap.
"""

from collections import Counter

from tests.accuracy import afro_songs as afro
from tests.accuracy import studio_songs as ss


def test_forty_songs_in_two_halves_and_three_styles_drawn_from_their_names():
    cases = afro.cases()
    assert len(cases) == afro.N_SONGS == 40
    assert Counter(c.split for c in cases) == {"dev": 20, "test": 20}
    assert {c.tags[5] for c in cases} == {"afrobeats", "amapiano", "highlife"}
    assert all(c.kind == "afro" and c.tags[2] == "afro" and c.time_signature == "4/4" for c in cases)
    # Pinned: the same song every time, so a baseline is compared with the same audio.
    assert afro.compose("afro00") == afro.compose("afro00")
    assert ss.corpus_fingerprint(cases) == ss.corpus_fingerprint(afro.cases())
    assert ss.select(sets=("afro",)) == cases


def test_the_lines_move_as_the_style_does():
    notes = [n for c in afro.cases() for n in afro.compose(c.slug).notes]
    # On the sixteenths, never overlapping, half of them starting off the eighth-note grid.
    for c in afro.cases():
        comp = afro.compose(c.slug)
        assert all(a[1] + a[2] <= b[1] for a, b in zip(comp.notes, comp.notes[1:])), c.name
        assert all(40 <= n[0] <= 82 for n in comp.notes), c.name
        tonic, mode = comp.tonic, comp.mode
        scale = {(tonic + d) % 12 for d in ((0, 2, 3, 5, 7, 8, 10) if mode == "minor" else (0, 2, 4, 5, 7, 9, 11))}
        assert all(n[0] % 12 in scale for n in comp.notes), c.name
    off = sum(1 for n in notes if n[1] % 2) / len(notes)
    assert 0.35 <= off <= 0.65
    # Call and response, runs, auto-tune and ad-libs each on some songs, not all.
    tags = Counter(t for c in afro.cases() for t in c.tags)
    for tag in ("response", "melisma", "autotune", "adlibs", "talking_drum"):
        assert 0 < tags[tag] < afro.N_SONGS, tag


def test_the_reference_is_the_lead_and_the_reply_as_written():
    case = next(c for c in afro.cases() if c.tags[8] == "response")
    comp = afro.compose(case.slug)
    ref = ss.reference(case)
    assert len(ref) == len(comp.notes) == len(case.written)
    assert any(n[4] for n in comp.notes)  # the reply is in the reference
    first = comp.notes[0][1]
    assert case.bar_offset == (first % 16) * afro.SIXTEENTH
    assert [r.dur_beats for r in ref] == [n[2] * afro.SIXTEENTH for n in comp.notes]
