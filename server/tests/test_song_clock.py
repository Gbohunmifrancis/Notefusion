"""A separated song's sheet, played over the song's own backing, lands on the recording's beats.

The clients place each note at ``audioTimeOfBeat(start_beat)``: ``beat_times_sec`` interpolated
when the result has it, else ``beat_origin_sec + start_beat * 60 / tempo``
(``tests.accuracy.song_clock.audio_time_of_beat`` is that function).  ``transcriber._beat_map``
builds the map from where each written note was heard; here on notes sung by a simulated band's
clock (no audio), and once through the song path on a rendered song whose band drifts.
"""

import numpy as np
import pytest

from app.pipeline.transcriber import _beat_map, _snap_offsets
from tests.accuracy import song_clock as sc

STEP = 0.5  # the default grid: eighths


def _sung(bpm_per_beat: np.ndarray, positions, noise_sec: float, seed: int = 1):
    """Notes sung on the band's ``positions`` (in the band's beats) and written as the transcriber
    writes them: the beats counted at the one tempo that fits the band's whole clock, each onset
    heard with ``noise_sec`` of error and rounded to the grid, one note a slot.  Returns
    (origin, bpm, heard pairs, written beats, true onsets)."""
    clock = sc.Clock.of(bpm_per_beat)
    # As the song path counts them: the tempo that fits every tracked beat of the band, from a
    # beat 0 at the first note (``_steady_bpm``, ``_beat_origin``).
    slope = float(np.polyfit(np.arange(len(bpm_per_beat) + 1), clock.starts, 1)[0])
    bpm, origin = 60.0 / slope, clock(positions[0])
    rng = np.random.default_rng(seed)
    heard, written, true = [], [], []
    for p in positions:
        onset = clock(p)
        h = (onset + rng.normal(0.0, noise_sec) - origin) / slope
        w = round(h / STEP) * STEP
        if written and w <= written[-1]:
            continue  # the slot is taken; ``_one_note_per_slot`` would move or fold it
        heard.append((w, h))
        written.append(w)
        true.append(onset)
    return origin, bpm, heard, np.array(written), np.array(true)


def _errors_ms(beat_times, origin, tempo, written, true):
    return np.abs(sc.audio_time_of_beat(written, beat_times, origin, tempo) - true) * 1000.0


def _drifting(beats: int = 320, drift: float = 0.04, rit: bool = False) -> np.ndarray:
    return sc.tempo_curve("drift_rit" if rit else "drift", beats, 100.0, drift)


def _melody_positions(beats: int) -> list[float]:
    """Crotchets with a quaver pair every other bar and a rest every fourth: a hymn-like line."""
    out, b = [], 0.0
    while b < beats - 2:
        bar = int(b // 4)
        if bar % 4 == 3:
            b += 4.0
            continue
        out.append(b)
        if bar % 2 and b % 4 == 2:
            out.append(b + 0.5)
        b += 1.0
    return out


def test_a_steady_song_maps_on_the_line_at_the_tempo_its_beats_were_counted_at():
    """Heard exactly where written: the map is the line at ``bpm``, not at the whole number the
    result's ``tempo`` rounds it to, three quarters of a second out by three minutes at 97.4."""
    bpm, origin = 97.4, 1.234
    heard = [(float(b), float(b)) for b in range(0, 290, 2)]
    times = _beat_map(origin, bpm, heard, 290.0, STEP)
    assert len(times) == 291
    assert times == pytest.approx([origin + i * 60.0 / bpm for i in range(291)], abs=0.0006)
    assert all(t == round(t, 3) for t in times)
    rounded_line = origin + 288 * 60.0 / round(bpm)
    assert rounded_line - times[288] > 0.7


def test_the_map_covers_every_note_and_always_increases():
    """Whatever the heard positions -- out of order, far off, a lone note -- every entry is later
    than the one before and there is one for every beat up to the last note's end, so no note
    of the sheet is ever left without a time."""
    rng = np.random.default_rng(7)
    written = np.sort(rng.choice(np.arange(0, 120, 0.5), size=90, replace=False))
    heard = list(zip(written, written + rng.uniform(-1.5, 1.5, written.size)))
    for step in (STEP, None):
        times = _beat_map(-0.4, 88.0, heard, float(written[-1]) + 1.5, step)
        assert len(times) - 1 >= written[-1] + 1.5
        assert np.all(np.diff(times) > 0)
        assert np.all(np.isfinite(sc.audio_time_of_beat(written, times, -0.4, 88)))
    assert _beat_map(2.0, 120.0, [(3.0, 3.1)], 4.0, STEP) == pytest.approx([2.05, 2.55, 3.05, 3.55, 4.05])
    assert _beat_map(2.0, 120.0, [], 2.0, STEP) == [2.0, 2.5, 3.0]


@pytest.mark.parametrize("rit", [False, True])
def test_a_band_that_drifts_is_followed_to_the_last_note(rit):
    """The band goes from 96 to 104 BPM over the song (and slows to 70% over its last two bars):
    rounded to a grid counted at one tempo, its notes are written up to a quarter of a beat from
    where they were sung, and the line puts them there, even at the exact tempo; the map puts
    them back, to the last note.  Its worst is where the band crosses a step's edge between a
    quaver and the next beat: written half a beat apart and sung a whole beat apart, the two
    pull the one beat between them both ways (60-95 ms, over seeds)."""
    tempo = _drifting(rit=rit)
    origin, bpm, heard, written, true = _sung(tempo, _melody_positions(len(tempo)), noise_sec=0.015)
    times = _beat_map(origin, bpm, heard, float(written[-1]) + 1.0, STEP)
    mapped = _errors_ms(times, origin, round(bpm), written, true)
    line = _errors_ms(None, origin, bpm, written, true)
    assert np.percentile(line, 95) > 100.0
    assert np.percentile(mapped, 95) < 40.0
    assert mapped.max() < 100.0


def test_the_onsets_own_error_is_taken_out_where_the_band_keeps_a_beat():
    """A steady band: every note was written on its own beat, and the heard onsets carry only the
    pitch tracker's error.  Fitted to the onsets alone the map would play that error back; read
    through the neighbours, who agree the band is on the grid, every note keeps its slot."""
    tempo = np.full(320, 100.0)
    origin, bpm, heard, written, true = _sung(tempo, _melody_positions(320), noise_sec=0.025)
    snapped = _errors_ms(_beat_map(origin, bpm, heard, written[-1] + 1.0, STEP), origin, 100, written, true)
    onsets = _errors_ms(_beat_map(origin, bpm, heard, written[-1] + 1.0, None), origin, 100, written, true)
    assert np.percentile(snapped, 95) < 0.5 * np.percentile(onsets, 95)
    assert np.percentile(snapped, 95) < 20.0


def test_a_note_off_the_agreed_phase_is_snapped_only_when_it_is_near_it():
    """Twenty neighbours agree the band sits 0.1 of a beat late.  A note heard 0.05 off that is
    snapped onto it; one heard most of a quarter-beat off (a note pushed ahead on purpose) keeps
    where it was heard; and a note written a whole step from its neighbours' phase (moved to a
    free slot) is the same phase."""
    written = np.arange(0.0, 21.0)
    offset = np.full(21, 0.1)
    offset[5], offset[10], offset[15] = 0.15, 0.1 + 0.2, 0.1 - STEP
    out = _snap_offsets(written, offset, STEP)
    assert out[5] == pytest.approx(0.1, abs=0.02)
    assert out[10] == pytest.approx(0.3)
    assert out[15] == pytest.approx(0.1 - STEP, abs=0.02)
    assert np.delete(out, [5, 10, 15]) == pytest.approx(0.1, abs=0.02)


def test_neighbours_that_disagree_leave_a_note_where_it_was_heard():
    """Every other note half a step from the one before: no lean of the band lines them up, so
    nothing is moved, not even onto the grid."""
    written = np.arange(0.0, 21.0)
    offset = np.where(np.arange(21) % 2 == 0, 0.2, -0.05)
    assert _snap_offsets(written, offset, STEP) == pytest.approx(offset)


def test_where_the_band_keeps_the_counted_grid_a_note_keeps_its_written_slot():
    """The neighbours agree the band is 0.02 of a beat off the grid, within the onsets' own error:
    the grid, fitted to every onset in the song, is the better reading, and the note is played on
    the line however far its own onset strayed."""
    written = np.arange(0.0, 21.0)
    offset = 0.02 + np.random.default_rng(5).normal(0.0, 0.03, 21)
    offset[10] = 0.12
    assert _snap_offsets(written, offset, STEP) == pytest.approx(np.zeros(21))


def test_beat_zero_is_the_first_bar_and_a_pickup_comes_before_it():
    """The pickup convention of ``beat_origin_sec``: a tune starting on the last beat of a 4/4 bar
    has its first note on beat 3, and beat 0 is a bar line before any note -- at the origin."""
    origin, bpm = -0.35, 90.0
    heard = [(3.0 + k, 3.0 + k) for k in range(12)]
    times = _beat_map(origin, bpm, heard, 15.0, STEP)
    assert times[0] == pytest.approx(origin, abs=0.0006)
    assert sc.audio_time_of_beat(np.array([3.0]), times, origin, 90)[0] == pytest.approx(origin + 2.0, abs=0.001)


def test_the_clients_extrapolate_with_the_first_and_last_intervals():
    times = [1.0, 1.5, 2.1, 2.8]
    at = sc.audio_time_of_beat(np.array([-1.0, 0.5, 2.5, 4.0]), times, 0.0, 120)
    assert at == pytest.approx([0.5, 1.25, 2.45, 3.5])
    assert sc.audio_time_of_beat(np.array([2.0]), None, 1.0, 120)[0] == pytest.approx(2.0)


def test_a_drifting_song_lands_on_its_own_beats_through_the_song_path():
    """Regression: a minute of song whose band drifts 6% and slows into its last bars, through
    the song path as the queue runs a separated song (stem for the notes, mix for the beat).  The
    whole-number tempo line misses by a quarter beat (210 ms at the 95th when written);
    ``beat_times_sec`` puts the notes back where they were sung (23 ms), to the last note.
    About 20 s."""
    song = sc.render("drift_rit", minutes=1.0, drift=0.06)
    result, bpm, heard = sc.transcribe(song)
    row = sc.measure(song, result, bpm, heard)
    assert row["paired"] >= 0.9 * row["notes_sung"]
    assert row["map_increasing"] and row["map_covers_last_note"]
    assert row["notes_playable"] == len(result.notes)
    assert all(t == round(t, 3) for t in result.beat_times_sec)
    assert row["wire"]["p95_ms"] > 100.0
    assert row["map"]["p95_ms"] <= 60.0
    assert row["map_last30s"]["max_ms"] <= 100.0
