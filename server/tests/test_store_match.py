"""A store song is taken from the right YouTube upload, or from none (tests/accuracy/store_match.py)."""

from tests.accuracy import store_match


def test_no_store_song_is_taken_from_another_song_or_recording():
    tally, notes = store_match.score()
    assert tally["wrong"] == 0, "\n".join(notes)
    assert tally["guessed"] == 0, "\n".join(notes)
    assert tally["right"] + tally["refused"] == len(store_match.cases()), "\n".join(notes)
