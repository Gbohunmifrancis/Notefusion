"""The studio-song benchmark is built as it says, and a few of its songs go through the song path.

``python -m tests.accuracy.report --songs`` runs it in full: the real studio takes (CSD) through
the vocal-separation model, the synthetic singer's hymns on simulated stems.  Here, without the
model or a download: the corpus keeps the hymn corpus's frozen halves, every song's production
is drawn from its name, the reference sits where the band puts it, the CSD dohs are read as
the module says, and the opening phrases of ``FAST_SLUGS`` (dev songs) come back through
``transcribe_song`` on their simulated stems with the doh right and the notes heard.
"""

from dataclasses import replace

import pytest

from tests.accuracy import hymn_corpus as hc
from tests.accuracy import studio_songs as ss

pytestmark = pytest.mark.skipif(not ss.CASES, reason="content/hymns is not beside server/")


def test_the_hymn_songs_keep_the_hymn_corpus_halves_and_draw_their_production_from_their_name():
    assert len(ss.CASES) == 2 * ss.PER_SPLIT
    assert {c.split for c in ss.CASES} == {"dev", "test"}
    assert all(c.split == hc.split_of(c.slug) for c in ss.CASES)
    assert sum(c.split == "dev" for c in ss.CASES) == ss.PER_SPLIT
    assert set(ss.FAST_SLUGS) <= {c.slug for c in ss.CASES if c.split == "dev"}
    # Pinned: a change to the salt or a table would re-produce every song, and a baseline
    # recorded on the old ones would be compared with different audio.
    assert ss.production_of("new-britain") == ss.production_of("new-britain")
    assert (ss.production_of("new-britain").voice, ss.production_of("new-britain").keys) == ("female", "piano")
    assert ss.corpus_fingerprint(ss.CASES) == ss.corpus_fingerprint(ss._cases())


def test_the_reference_is_the_lead_as_the_band_places_it():
    case = next(c for c in ss.CASES if c.slug == "new-britain")
    ref = ss.reference(case)
    spb, origin = ss._grid(case)
    # 3/4 with a two-beat pickup: the tune's first full bar is the band's second.
    assert case.time_signature == "3/4" and case.bar_offset == 2.0 and case.production.intro_bars == 2
    assert ref[0].onset_sec == pytest.approx((case.bar_offset + origin) * spb)
    assert origin == case.bpb  # one intro bar before the pickup's bar
    assert ref[0].onset_beat == 0.0 and len(ref) == len(case.written)


def test_a_melisma_is_sung_as_two_notes_and_written_so():
    case = next(c for c in ss.CASES if c.production.melisma and any(c.legato))
    i = case.legato.index(True)
    ref = ss.reference(case)
    assert ref[i].onset_sec == pytest.approx(ref[i - 1].onset_sec + ref[i - 1].dur_sec)
    assert abs(ref[i].pitch_midi - ref[i - 1].pitch_midi) in (1, 2)


def test_a_csd_songs_doh_is_the_scale_its_notes_lie_in_and_end_on():
    # C D E G A: C, F and G major all hold it; it ends on G, so G.
    pentatonic = [(i * 0.5, i * 0.5 + 0.4, p) for i, p in enumerate((60, 62, 64, 67, 69, 67, 64, 62, 67))]
    assert ss._csd_doh("en999", pentatonic) == 7
    # One scale only: that one, wherever it ends.
    assert ss._csd_doh("en999", [(i, i + 0.9, p) for i, p in enumerate((62, 64, 66, 67, 69, 71, 73, 69))]) == 2
    # The dataset's two named exceptions win, in whichever key the take is sung.
    assert ss._csd_doh("en005", pentatonic) == 5
    assert ss._csd_doh("en031", pentatonic, key_diff=3) == 3


def _head(case: ss.SongCase, notes: int) -> ss.SongCase:
    """The song's first ``notes`` notes (and the rests between them): its opening phrases."""
    seq, sounding = [], 0
    for pitch, dur in case.notes:
        if pitch is not None:
            if sounding == notes:
                break
            sounding += 1
        seq.append((pitch, dur))
    return replace(case, name=f"{case.name}_head{notes}", notes=tuple(seq), written=case.written[:sounding],
                   legato=case.legato[:sounding])


# (notes.f1 at least, syllables read wrong per note at most): a little under what the first
# twenty notes measured when this was written (0.789/0.15, 0.810/0.10, 0.773/0.30).
FLOORS = {
    "belmont": (0.75, 0.20),
    "nativity": (0.77, 0.15),
    "regent-square": (0.73, 0.35),
}


@pytest.mark.parametrize("slug", sorted(FLOORS))
def test_the_opening_of_a_song_comes_back_through_the_song_path(slug, tmp_path):
    case = _head(next(c for c in ss.CASES if c.slug == slug), 20)
    mix, vocals, backing = ss.ensure_stems(tmp_path, case, "sim")
    result, read = ss.transcribe_song(mix, vocals, backing)
    scores = ss.score(case, result)
    f1_floor, error_ceiling = FLOORS[slug]
    assert read == "stem"
    assert scores["key.doh"]
    assert scores["notes.f1"] >= f1_floor
    assert scores["solfa.read_error_rate"] <= error_ceiling
