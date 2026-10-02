"""Tests for the transcriber helper functions added in the accuracy-improvement pass.

These helpers are pure functions with no ML dependencies — they run fast and
cover the post-processing logic that sits between Basic Pitch inference and the
music21 score assembly:

  _normalise_key_name     music21 flat/lowercase → standard C# KeyParser format
  _merge_onsets           fuse same-pitch fragments that are too close together
  _bend_semitones         Basic Pitch's 1/3-semitone bend bins as a semitone offset
  _dedup_simultaneous     drop exact pitch+onset duplicates from polyphonic mode
  _adaptive_amplitude_floor  per-clip dynamic threshold from p75 of amplitudes
  _refine_pitches         correct pitch errors against a pyin f0 contour, octaves or all
  _pyin_contour           the contour itself, and every way it can decline to produce one
  _grid_residual          how far onsets sit from the grid they will be quantized onto
  _grid_bpm               the tempo that puts those onsets on the grid, tappably
  _estimate_tempo_and_beats  a tap-in override wins the BPM but still recovers phase
  _profile_z_scores       one key profile's standardised opinion of all 24 keys
  _key_from_identity      (pitch class, mode) back to a music21 Key
  _key_spelling           pitch class -> note name, as the key signature implies
  _respell_to_key         that spelling applied to a stream, without moving a pitch
  _key_confidence_from_margin  winner-over-runner-up lead, capped on short clips
  _detect_key             the five-profile vote, and its fallbacks

No audio files and no ML models: the two pyin functions are covered by substituting a
synthetic contour and by monkeypatching ``librosa.load``/``librosa.pyin``/``beat_track``,
so the pitch and tempo decisions are tested without a tracker in the loop.  The key
helpers run on bare music21 streams, which cost nothing and are what the profiles read
anyway.
"""

from pathlib import Path

import numpy as np
import pytest
from app.pipeline import transcriber
from app.pipeline.transcriber import (
    ADAPTIVE_FACTOR,
    CONF_WEIGHT_AMP,
    CONF_WEIGHT_ONSET,
    CONTOUR_BINS_PER_SEMITONE,
    F0_MERGE_SEMITONES,
    KEY_CONFIDENCE_CAP_LOW,
    KEY_MARGIN_FULL,
    MIN_AMPLITUDE_MELODY,
    MIN_AMPLITUDE_POLY,
    MIN_NOTES_FOR_KEY,
    Event,
    _MAX_GRID_SLIP_STEPS,
    _adaptive_amplitude_floor,
    _beat_origin,
    _bend_semitones,
    _blend_confidence,
    _dedup_simultaneous,
    _grid_bpm,
    _grid_residual,
    _key_confidence_from_margin,
    _key_from_identity,
    _key_spelling,
    _merge_contour_gaps,
    _merge_onsets,
    _normalise_key_name,
    _onset_bpm,
    _respell_to_key,
    get_basic_pitch_model,
)

# ── _normalise_key_name ───────────────────────────────────────────────────────


class TestNormaliseKeyName:
    """music21 returns two forms that C#'s KeyParser historically rejected:
       1. Dash-flat notation: "B-" instead of "Bb".
       2. Lowercase tonic for minor keys: "a minor" instead of "A minor".
    Both must be normalised before the key string is stored or returned to the client.
    """

    # Dash-flat → b-flat conversion
    @pytest.mark.parametrize(
        "raw, expected",
        [
            ("B- major", "Bb major"),
            ("E- major", "Eb major"),
            ("A- major", "Ab major"),
            ("D- major", "Db major"),
            ("G- major", "Gb major"),
            ("C- major", "Cb major"),
            ("F- major", "Fb major"),
            ("B- minor", "Bb minor"),
            ("E- minor", "Eb minor"),
            ("A- minor", "Ab minor"),
        ],
    )
    def test_converts_dash_flat_to_b_flat(self, raw, expected):
        assert _normalise_key_name(raw) == expected

    # Lowercase tonic capitalisation (music21 minor keys)
    @pytest.mark.parametrize(
        "raw, expected",
        [
            ("a minor", "A minor"),
            ("e minor", "E minor"),
            ("d minor", "D minor"),
            ("g minor", "G minor"),
            ("b minor", "B minor"),
            ("f# minor", "F# minor"),
            ("c# minor", "C# minor"),
            ("bb minor", "Bb minor"),  # dash-flat + lowercase, double transform
            ("b- minor", "Bb minor"),
            ("e- minor", "Eb minor"),
        ],
    )
    def test_capitalises_lowercase_tonic(self, raw, expected):
        assert _normalise_key_name(raw) == expected

    # Major keys are already capitalised by music21; verify they pass through cleanly
    @pytest.mark.parametrize(
        "raw",
        [
            "C major",
            "G major",
            "D major",
            "A major",
            "E major",
            "F major",
            "Bb major",
            "F# major",
        ],
    )
    def test_leaves_already_normalised_major_keys_unchanged(self, raw):
        assert _normalise_key_name(raw) == raw

    # Sharp keys — sharps must not be disturbed
    @pytest.mark.parametrize(
        "raw, expected",
        [
            ("F# major", "F# major"),
            ("C# major", "C# major"),
            ("f# minor", "F# minor"),
            ("c# minor", "C# minor"),
        ],
    )
    def test_preserves_sharps(self, raw, expected):
        assert _normalise_key_name(raw) == expected

    # Bare tonic without mode string
    @pytest.mark.parametrize(
        "raw, expected",
        [
            ("C", "C"),
            ("b-", "Bb"),
            ("f#", "F#"),
            ("a", "A"),
        ],
    )
    def test_handles_bare_tonic_without_mode(self, raw, expected):
        assert _normalise_key_name(raw) == expected

    # Edge cases
    def test_empty_string_returns_empty(self):
        assert _normalise_key_name("") == ""

    def test_whitespace_string_returns_empty(self):
        # strip() removes leading/trailing whitespace; split returns []
        result = _normalise_key_name("   ")
        assert result == ""

    def test_single_tonic_with_only_whitespace_normalised(self):
        assert _normalise_key_name("  C major  ") == "C major"


# ── _merge_onsets ─────────────────────────────────────────────────────────────


class TestBendSemitones:
    """Basic Pitch's bend bins, converted to a semitone offset from the notated pitch."""

    def test_no_bends_means_no_offset(self):
        # None is what drop_overlapping_pitch_bends leaves behind; [] is a note whose
        # span held no contour frames.  Both mean "the pitch is the best estimate".
        assert _bend_semitones(None) == 0.0
        assert _bend_semitones([]) == 0.0

    def test_bins_convert_at_three_to_the_semitone(self):
        assert _bend_semitones([3]) == pytest.approx(1.0)
        assert _bend_semitones([-3]) == pytest.approx(-1.0)
        assert _bend_semitones([1]) == pytest.approx(1.0 / 3.0)

    def test_the_bins_are_already_centred_on_the_notated_pitch(self):
        """A zero bend is no offset — there is no bin-index correction to undo.

        ``get_pitch_bends`` subtracts ``pb_shift`` so the array is relative to the
        note's own contour bin, and that bin is exactly ``3 * pitch - 63`` for every
        MIDI pitch, so the rounding in ``midi_pitch_to_contour_bin`` never actually
        rounds.  Worth pinning: an earlier reading of this assumed a one-bin offset,
        which would have biased every f0 by a third of a semitone.
        """
        assert _bend_semitones([0, 0, 0]) == 0.0
        assert Event(0.0, 0.5, 60, 0.8, _bend_semitones([0])).f0 == pytest.approx(60.0)

    def test_the_mean_is_taken_not_the_median(self):
        # A monotonic run through the boundary: mean 1.0 bin, median 0.0 bins.  Chosen
        # because a fragment shorter than one vibrato cycle sits on the slope, where
        # the median is just its midpoint sample.
        assert _bend_semitones([-1, 0, 4]) == pytest.approx(1.0 / 3.0)

    def test_f0_defaults_to_the_notated_pitch(self):
        assert Event(0.0, 0.5, 67, 0.8).f0 == 67.0
        assert Event(0.0, 0.5, 67, 0.8).bend_semitones == 0.0

    def test_a_bin_is_a_third_of_a_semitone(self):
        assert CONTOUR_BINS_PER_SEMITONE == 3.0


class TestMergeOnsets:
    """Fragments separated by a gap smaller than gap_sec whose f0 agree are fused.

    Events are ``Event(start_sec, end_sec, pitch_midi, amplitude, bend_semitones)`` —
    the four values Basic Pitch reports plus the mean of the bend array it also returns
    and the pipeline used to discard.
    """

    def test_two_same_pitch_notes_within_gap_are_merged(self):
        # gap = 0.15 - 0.10 = 0.05 < 0.08 → should merge
        events = [Event(0.0, 0.10, 60, 0.8), Event(0.15, 0.25, 60, 0.7)]
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 1
        assert result[0].start == pytest.approx(0.0)
        assert result[0].end == pytest.approx(0.25)
        assert result[0].pitch == 60
        assert result[0].amp == pytest.approx(0.8)  # louder of the two

    def test_merged_event_takes_higher_amplitude(self):
        # Second event is louder
        events = [Event(0.0, 0.10, 60, 0.5), Event(0.14, 0.25, 60, 0.9)]
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 1
        assert result[0].amp == pytest.approx(0.9)

    def test_gap_exactly_at_threshold_is_not_merged(self):
        # The comparison is `gap < gap_sec`, so a gap equal to the threshold
        # must NOT merge. Testing that boundary needs values whose subtraction
        # is exact in binary floating point: 0.18 - 0.10 is 0.0799999...,
        # which slips under a 0.08 threshold and merges. 0.25/0.375/0.125 are
        # all powers-of-two fractions, so gap == gap_sec exactly.
        events = [Event(0.0, 0.25, 60, 0.8), Event(0.375, 0.475, 60, 0.7)]
        result = _merge_onsets(events, gap_sec=0.125)
        assert len(result) == 2

    def test_gap_larger_than_threshold_is_not_merged(self):
        events = [Event(0.0, 0.10, 60, 0.8), Event(0.25, 0.35, 60, 0.7)]
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 2

    def test_different_pitch_notes_are_never_merged(self):
        # Different pitch: always two separate events regardless of gap
        events = [Event(0.0, 0.10, 60, 0.8), Event(0.14, 0.24, 61, 0.7)]
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 2

    def test_three_adjacent_same_pitch_fragments_all_merge(self):
        # Chain: AB merge → then (AB)C merge in second pass
        events = [
            Event(0.0, 0.05, 60, 0.6),
            Event(0.08, 0.13, 60, 0.8),
            Event(0.16, 0.21, 60, 0.7),
        ]
        result = _merge_onsets(events, gap_sec=0.06)
        assert len(result) == 1
        assert result[0].start == pytest.approx(0.0)
        assert result[0].end == pytest.approx(0.21)
        assert result[0].amp == pytest.approx(0.8)  # peak amplitude

    def test_mixed_same_and_different_pitches(self):
        # 60-60 merge; 61 stays separate
        events = [
            Event(0.0, 0.10, 60, 0.8),
            Event(0.14, 0.24, 60, 0.7),
            Event(0.30, 0.40, 61, 0.9),
        ]
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 2
        assert result[0].pitch == 60
        assert result[1].pitch == 61

    # ── the f0 tolerance ──────────────────────────────────────────────────────
    # Every test above builds Events without bends, which is the point: for those the
    # tolerance test is arithmetically the old exact-equality test, so they still pin
    # the original semantics.  These add what the bends buy.

    def test_fragments_a_semitone_apart_merge_when_their_f0_agree(self):
        """The vibrato case: rounded pitches differ, the fundamentals do not.

        A wobble sitting just under the boundary between 60 and 61 is reported by
        Basic Pitch as alternating 60/61 fragments.  Their f0 are 60.5 and 60.6 — a
        tenth of a semitone apart — so they are one note, and the old test could not
        say so because rounding had already thrown the evidence away.
        """
        events = [
            Event(0.0, 0.10, 60, 0.8, 0.5),  # f0 60.5
            Event(0.14, 0.24, 61, 0.7, -0.4),  # f0 60.6
        ]
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 1
        assert result[0].start == pytest.approx(0.0)
        assert result[0].end == pytest.approx(0.24)
        assert result[0].pitch == 60  # the louder fragment's, kept wholesale

    def test_a_genuine_semitone_step_still_never_merges(self):
        """Two notes really a semitone apart have f0 a semitone apart, so they stay.

        This is the guard the struck tolerant-merge failed and the reason the constant
        is under 1.0.  Both events are centred, as a clean legato step is.
        """
        events = [Event(0.0, 0.10, 60, 0.8, 0.0), Event(0.14, 0.24, 61, 0.7, 0.0)]
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 2

    def test_same_rounded_pitch_but_f0_far_apart_no_longer_merges(self):
        """The change cuts both ways, deliberately.

        Two events that round to 60 but whose fundamentals are 59.7 and 60.4 are 0.7
        apart — over the tolerance — so they are read as two notes where the old test
        called them one.  Measured on the corpus this is a net win: it avoids four
        genuine-step fusions for the cost of six fragment merges.
        """
        events = [
            Event(0.0, 0.10, 60, 0.8, -0.3),  # f0 59.7
            Event(0.14, 0.24, 60, 0.7, 0.4),  # f0 60.4
        ]
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 2

    def test_the_tolerance_boundary_is_inclusive(self):
        """``<=``, so a difference of exactly F0_MERGE_SEMITONES merges."""
        exact = [Event(0.0, 0.10, 60, 0.8, 0.0), Event(0.125, 0.25, 60, 0.7, F0_MERGE_SEMITONES)]
        assert len(_merge_onsets(exact, gap_sec=0.08)) == 1

    def test_a_tolerance_under_one_cannot_reach_bend_free_neighbours(self):
        """Why 0.5 is safe: distinct integer pitches are at least 1.0 apart in f0.

        Pinning the inequality rather than the constant, so raising F0_MERGE_SEMITONES
        to 1.0 or beyond — which would silently start fusing adjacent semitones on
        clips Basic Pitch reported no bends for — fails here.
        """
        assert F0_MERGE_SEMITONES < 1.0

    def test_empty_input_returns_empty(self):
        assert _merge_onsets([], gap_sec=0.08) == []

    def test_single_event_returned_unchanged(self):
        events = [Event(0.0, 0.5, 60, 0.8)]
        result = _merge_onsets(events, gap_sec=0.08)
        assert result == events

    def test_overlapping_events_negative_gap_not_merged(self):
        # Overlapping events (gap < 0) should not be merged — only genuine gaps
        events = [Event(0.0, 0.20, 60, 0.8), Event(0.10, 0.30, 60, 0.7)]  # gap = -0.10
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 2


# ── _merge_contour_gaps ───────────────────────────────────────────────────────


class TestMergeContourGaps:
    def _contour(self, values, probs=0.9, hop=0.01):
        midi = np.asarray(values, dtype=float)
        return (
            np.arange(midi.size, dtype=float) * hop,
            midi,
            np.full(midi.size, probs, dtype=float),
        )

    def test_fuses_same_pitch_fragments_across_a_continuously_voiced_gap(self):
        events = [Event(0.0, 0.10, 60, 0.8), Event(0.15, 0.25, 60, 0.7)]
        result = _merge_contour_gaps(events, *self._contour([60.0] * 30))
        assert len(result) == 1
        assert (result[0].start, result[0].end, result[0].pitch) == (0.0, 0.25, 60)

    def test_rejects_a_contour_that_leaves_the_note_pitch(self):
        events = [Event(0.0, 0.10, 60, 0.8), Event(0.15, 0.25, 60, 0.7)]
        contour = self._contour([60.0] * 12 + [61.5] * 6 + [60.0] * 12)
        assert len(_merge_contour_gaps(events, *contour)) == 2

    def test_rejects_unvoiced_dropouts(self):
        events = [Event(0.0, 0.10, 60, 0.8), Event(0.15, 0.25, 60, 0.7)]
        contour = self._contour([60.0] * 12 + [np.nan] * 6 + [60.0] * 12)
        assert len(_merge_contour_gaps(events, *contour)) == 2

    def test_rejects_a_gap_longer_than_the_dropout_budget(self):
        events = [Event(0.0, 0.10, 60, 0.8), Event(0.40, 0.50, 60, 0.7)]
        assert len(_merge_contour_gaps(events, *self._contour([60.0] * 60))) == 2

    def test_malformed_contour_is_a_safe_noop(self):
        events = [Event(0.0, 0.10, 60, 0.8), Event(0.15, 0.25, 60, 0.7)]
        assert _merge_contour_gaps(events, np.array([0.0]), np.array([]), np.array([])) == events


# ── Basic Pitch model reuse ───────────────────────────────────────────────────


class TestBasicPitchModelReuse:
    def test_accessor_returns_the_existing_warmed_model(self, monkeypatch):
        sentinel = object()
        monkeypatch.setattr(transcriber, "_BASIC_PITCH_MODEL", sentinel)
        assert get_basic_pitch_model() is sentinel
        assert get_basic_pitch_model() is sentinel


# ── _dedup_simultaneous ───────────────────────────────────────────────────────


class TestDedupSimultaneous:
    """Exact pitch + onset duplicates from polyphonic harmonic energy are removed;
    the louder of the two is kept."""

    def test_identical_events_reduces_to_one(self):
        events = [
            Event(0.0, 0.5, 60, 0.8),
            Event(0.0, 0.5, 60, 0.6),  # same pitch, same onset → duplicate
        ]
        result = _dedup_simultaneous(events)
        assert len(result) == 1

    def test_louder_duplicate_is_kept(self):
        events = [
            Event(0.0, 0.5, 60, 0.5),
            Event(0.0, 0.5, 60, 0.9),  # louder
        ]
        result = _dedup_simultaneous(events)
        assert result[0].amp == pytest.approx(0.9)

    def test_different_pitches_at_same_onset_are_kept(self):
        events = [
            Event(0.0, 0.5, 60, 0.8),
            Event(0.0, 0.5, 64, 0.7),  # different pitch → not a duplicate
        ]
        result = _dedup_simultaneous(events)
        assert len(result) == 2

    def test_same_pitch_different_onset_are_kept(self):
        events = [
            Event(0.0, 0.5, 60, 0.8),
            Event(0.51, 0.9, 60, 0.7),  # different onset → not a duplicate
        ]
        result = _dedup_simultaneous(events)
        assert len(result) == 2

    def test_onset_tolerance_rounds_to_three_decimal_places(self):
        # Onsets that differ by less than 0.001 s are treated as simultaneous
        events = [
            Event(0.0000, 0.5, 60, 0.8),
            Event(0.0004, 0.5, 60, 0.6),  # rounded both → 0.000 → same key
        ]
        result = _dedup_simultaneous(events)
        assert len(result) == 1

    def test_no_duplicates_returned_unchanged(self):
        events = [
            Event(0.0, 0.5, 60, 0.8),
            Event(0.5, 1.0, 62, 0.7),
            Event(1.0, 1.5, 64, 0.9),
        ]
        result = _dedup_simultaneous(events)
        assert len(result) == 3

    def test_empty_list_returns_empty(self):
        assert _dedup_simultaneous([]) == []

    def test_single_event_returned_unchanged(self):
        events = [Event(0.0, 0.5, 60, 0.8)]
        assert _dedup_simultaneous(events) == events

    def test_chord_with_one_duplicate_deduped_correctly(self):
        # Three notes in a chord; one pitch appears twice
        events = [
            Event(0.0, 0.5, 60, 0.8),  # C
            Event(0.0, 0.5, 64, 0.7),  # E
            Event(0.0, 0.5, 67, 0.9),  # G
            Event(0.0, 0.5, 60, 0.5),  # C duplicate (quieter)
        ]
        result = _dedup_simultaneous(events)
        assert len(result) == 3
        pitches = [e.pitch for e in result]
        assert sorted(pitches) == [60, 64, 67]


# ── _adaptive_amplitude_floor ─────────────────────────────────────────────────


class TestAdaptiveAmplitudeFloor:
    """The adaptive floor = max(base_constant, ADAPTIVE_FACTOR × p75(amps)).
    This prevents a fixed threshold from silencing quiet/distant recordings.
    """

    def test_quiet_clip_uses_base_floor(self):
        # All amplitudes very low → p75 * factor < base → base wins
        events = [Event(0, 1, 60, 0.01), Event(1, 2, 60, 0.02), Event(2, 3, 60, 0.01)]
        floor = _adaptive_amplitude_floor(events, base=MIN_AMPLITUDE_MELODY)
        assert floor == pytest.approx(MIN_AMPLITUDE_MELODY)

    def test_loud_clip_raises_floor_above_base(self):
        # All amplitudes near 1.0 → p75 * factor >> base → adaptive wins
        events = [Event(i, i + 1, 60, 0.95) for i in range(10)]
        floor = _adaptive_amplitude_floor(events, base=MIN_AMPLITUDE_MELODY)
        expected = ADAPTIVE_FACTOR * 0.95
        assert floor == pytest.approx(expected, abs=0.01)
        assert floor > MIN_AMPLITUDE_MELODY

    def test_empty_events_returns_base(self):
        floor = _adaptive_amplitude_floor([], base=MIN_AMPLITUDE_POLY)
        assert floor == pytest.approx(MIN_AMPLITUDE_POLY)

    def test_single_event_uses_its_amplitude_or_base(self):
        # One event at 0.1 → p75 = 0.1; ADAPTIVE_FACTOR * 0.1 vs base
        events = [Event(0.0, 0.5, 60, 0.10)]
        floor = _adaptive_amplitude_floor(events, base=MIN_AMPLITUDE_MELODY)
        adaptive = ADAPTIVE_FACTOR * 0.10
        assert floor == pytest.approx(max(MIN_AMPLITUDE_MELODY, adaptive))

    def test_floor_is_never_below_base(self):
        # Even with zero-amplitude events, floor must stay at base
        events = [Event(i, i + 1, 60, 0.0) for i in range(5)]
        floor = _adaptive_amplitude_floor(events, base=0.30)
        assert floor >= 0.30

    def test_mixed_amplitude_uses_75th_percentile(self):
        import numpy as np

        # Known amplitudes; we know their p75
        amps = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
        events = [Event(float(i), float(i + 1), 60, a) for i, a in enumerate(amps)]
        p75 = float(np.percentile(amps, 75))
        expected_floor = max(MIN_AMPLITUDE_MELODY, ADAPTIVE_FACTOR * p75)
        result = _adaptive_amplitude_floor(events, base=MIN_AMPLITUDE_MELODY)
        assert result == pytest.approx(expected_floor, abs=1e-6)


# ── _beat_origin ──────────────────────────────────────────────────────────────


class TestBeatOrigin:
    """Which instant becomes beat 0 — the fix for leading silence / count-ins.

    Basic Pitch times notes from the start of the *file*, so without this the
    whole melody is pushed off the barline by however much silence precedes it.
    """

    def test_beat_at_onset_is_used_verbatim(self):
        beats = np.array([0.0, 0.5, 1.0, 1.5])
        assert _beat_origin(beats, first_onset=1.0, bpm=120.0) == pytest.approx(1.0)

    def test_last_beat_before_onset_wins(self):
        # 120 BPM → half a beat is 0.25 s; the onset sits 0.1 s after beat 1.0.
        beats = np.array([0.0, 0.5, 1.0, 1.5])
        assert _beat_origin(beats, first_onset=1.1, bpm=120.0) == pytest.approx(1.0)

    def test_leading_silence_is_removed(self):
        # The lead_in_800ms corpus case: 800 ms of silence at 96 BPM, so beats
        # every 0.625 s.  The beat at 0.625 s is 0.175 s before the onset — well
        # inside the half-beat window (0.3125 s) — so the melody starts a sixth
        # of a beat in rather than 1.28 beats in.
        beats = np.array([0.0, 0.625, 1.25, 1.875, 2.5])
        origin = _beat_origin(beats, first_onset=0.8, bpm=96.0)
        assert origin == pytest.approx(0.625)
        assert (0.8 - origin) * (96.0 / 60.0) < 0.3  # under a third of a beat

    def test_distant_beat_is_rejected_in_favour_of_the_onset(self):
        # Nearest earlier beat is 0.9 s back — more than half a beat at 120 BPM,
        # so it describes a different beat.  Anchor to the onset instead.
        beats = np.array([0.0, 1.0])
        assert _beat_origin(beats, first_onset=1.9, bpm=120.0) == pytest.approx(1.9)

    def test_no_beats_anchors_the_first_note_to_beat_zero(self):
        # Empty beat array = tracking failed.  Anchoring to the onset still beats
        # preserving the silence, which is what the un-fixed pipeline did.
        assert _beat_origin(np.empty(0), first_onset=0.8, bpm=96.0) == pytest.approx(0.8)

    def test_all_beats_after_the_onset_anchors_to_the_onset(self):
        beats = np.array([1.0, 1.5, 2.0])
        assert _beat_origin(beats, first_onset=0.4, bpm=120.0) == pytest.approx(0.4)

    def test_origin_never_follows_the_first_onset(self):
        # The pipeline relies on this: it is why clamping the inserted offset at
        # 0.0 can never collapse two notes onto beat 0.
        beats = np.array([0.0, 0.3, 0.61, 0.94, 1.2])
        for onset in (0.0, 0.31, 0.62, 1.0, 1.25):
            assert _beat_origin(beats, first_onset=onset, bpm=100.0) <= onset + 1e-9

    def test_half_beat_window_scales_with_tempo(self):
        # Same geometry, two tempi: 0.4 s back is inside half a beat at 60 BPM
        # (0.5 s) but outside it at 180 BPM (0.167 s).
        beats = np.array([0.0, 1.0])
        assert _beat_origin(beats, first_onset=1.4, bpm=60.0) == pytest.approx(1.0)
        assert _beat_origin(beats, first_onset=1.4, bpm=180.0) == pytest.approx(1.4)


# ── _onset_bpm ────────────────────────────────────────────────────────────────


class TestOnsetBpm:
    """Fallback tempo estimate, used only after librosa beat tracking fails."""

    def test_even_onsets_give_the_matching_bpm(self):
        # One note every 0.5 s → 120 BPM.
        events = [Event(i * 0.5, i * 0.5 + 0.4, 60, 0.5) for i in range(6)]
        assert _onset_bpm(events) == pytest.approx(120.0)

    def test_too_few_onsets_returns_zero(self):
        events = [Event(0.0, 0.4, 60, 0.5), Event(0.5, 0.9, 62, 0.5), Event(1.0, 1.4, 64, 0.5)]
        assert _onset_bpm(events) == 0.0

    def test_all_gaps_below_the_glitch_threshold_returns_zero(self):
        # Every IOI is 20 ms — filtered out as glitches, leaving nothing to take
        # a median of.  Returning 0.0 sends the caller to the 100 BPM default
        # instead of propagating a NaN into music21.
        events = [Event(i * 0.02, i * 0.02 + 0.01, 60, 0.5) for i in range(8)]
        assert _onset_bpm(events) == 0.0


# ── _grid_residual and _grid_bpm ──────────────────────────────────────────────

# The eighth grid that ``quantize_divisors`` actually ships.
EIGHTHS = (2,)


def _events_at(spacing_sec: float, count: int) -> list[Event]:
    """*count* notes starting every *spacing_sec*, each filling 80 % of its slot."""
    return [
        Event(i * spacing_sec, i * spacing_sec + 0.8 * spacing_sec, 60 + i, 0.5)
        for i in range(count)
    ]


class TestGridResidual:
    """Distance from the onsets to the grid, in grid steps and in seconds."""

    def test_onsets_on_the_grid_score_zero(self):
        # Quarter notes at 96 BPM are two eighth steps apart — no rounding to do.
        onsets = np.array([e.start for e in _events_at(0.625, 8)])
        assert _grid_residual(onsets, 96.0, EIGHTHS) == pytest.approx((0.0, 0.0))

    def test_onsets_exactly_between_grid_positions_score_the_worst_possible(self):
        # Sixteenths against an eighth grid: every other onset falls dead centre
        # between two steps, which is the 0.5 ceiling on a single note.
        onsets = np.array([e.start for e in _events_at(0.17045, 8)])
        steps, _ = _grid_residual(onsets, 88.0, EIGHTHS)
        assert steps == pytest.approx(0.25, abs=0.01)

    def test_the_best_fitting_divisor_wins(self):
        # Triplet eighths at 96 BPM fit a divisor of 3 exactly and a divisor of 4 not
        # at all.  music21's quantize snaps each note to whichever offered grid suits
        # it, so the residual has to follow the same rule.
        onsets = np.array([e.start for e in _events_at(0.20833, 7)])
        assert _grid_residual(onsets, 96.0, (4,))[0] > _MAX_GRID_SLIP_STEPS
        assert _grid_residual(onsets, 96.0, (4, 3))[0] == pytest.approx(0.0, abs=0.01)

    def test_steps_worsen_with_tempo_but_seconds_do_not(self):
        """The reason ``_grid_bpm`` filters on one unit and ranks on the other.

        A fixed jitter is a larger fraction of a step at a faster tempo, so the step
        figure cannot be compared across candidates — ranking on it walks the tempo
        down towards nothing.  In seconds the same performance scores the same at
        either metrical level, which is what lets the tempo preference decide.
        """
        jittered = np.array([0.0, 0.63, 1.24, 1.88, 2.49])
        fast_steps, fast_sec = _grid_residual(jittered, 96.0, EIGHTHS)
        slow_steps, slow_sec = _grid_residual(jittered, 48.0, EIGHTHS)
        assert fast_steps > slow_steps
        assert fast_sec == pytest.approx(slow_sec, abs=0.002)


class TestGridBpm:
    """The tempo under which the onsets land on the grid and a person could tap."""

    def test_even_quarters_beat_librosas_prior(self):
        # The corpus defect this exists for: librosa reports 117 — its own ~120 BPM
        # prior — for a clip of even quarters at 96, and at 117 a quarter measures
        # 1.219 beats and snaps alternately to 1.0 and 1.5.
        assert _grid_bpm(_events_at(0.625, 8), 117.0, EIGHTHS) == pytest.approx(96.0)

    def test_the_tappable_metrical_level_wins_among_equal_fits(self):
        # 48, 96, 144 and 192 all put these onsets exactly on the grid; the one
        # nearest 100 BPM is the one a person would tap.
        assert _grid_bpm(_events_at(0.625, 8), 0.0, EIGHTHS) == pytest.approx(96.0)

    def test_sixteenths_are_read_as_eighths_one_level_up(self):
        """An eighth grid cannot hold a sixteenth, so the answer is the level that can.

        Sixteenths at 88 BPM are the same music as eighths at 176, and only the
        second is representable — which is why the metrical level cannot be folded
        into a fixed band before scoring.
        """
        assert _grid_bpm(_events_at(0.17045, 12), 0.0, EIGHTHS) == pytest.approx(
            176.0, abs=1.0
        )

    def test_librosas_estimate_is_admitted_as_a_candidate(self):
        # Onsets on eighth steps of 100 BPM, but unevenly spaced, so the median
        # inter-onset interval alone never proposes 100.  Without the tracker in the
        # candidate set the answer would be 200, which fits just as exactly.
        events = [
            Event(t, t + 0.2, 60, 0.5) for t in (0.0, 0.3, 0.9, 1.2, 1.8, 2.1, 2.7)
        ]
        assert _grid_bpm(events, 100.0, EIGHTHS) == pytest.approx(100.0)
        assert _grid_bpm(events, 0.0, EIGHTHS) == pytest.approx(200.0)

    def test_jitter_within_tolerance_still_finds_the_tempo(self):
        """Real onsets are never exact; ±20 ms of it must not cost the answer.

        This is the case that decided the ranking unit.  Ranked in grid steps the
        chooser answered 48 BPM here — half the truth — because the jitter is a
        smaller fraction of a step down there, and it kept halving for as long as the
        candidates allowed.  Ranked in seconds 96 and 48 tie, and the tempo
        preference breaks the tie the way a person would.
        """
        events = [
            Event(t, t + 0.5, 60, 0.5)
            for t in (0.0, 0.643, 1.232, 1.881, 2.503, 3.135, 3.762)
        ]
        assert _grid_bpm(events, 0.0, EIGHTHS) == pytest.approx(96.0, abs=1.0)

    def test_an_exact_fit_above_the_notated_ceiling_is_refused(self):
        """A perfect fit at an absurd tempo is still an absurd answer.

        Onsets every 100 ms land exactly on the eighth grid of 300 BPM, and on the
        fragmented vibrato clips that is a real hazard: the median inter-onset
        interval there is a vibrato fragment rather than a note, and a grid that
        fine fits almost anything.  Nothing inside the notatable range fits these,
        so the helper declines and librosa's estimate stands.
        """
        assert _grid_bpm(_events_at(0.1, 12), 0.0, EIGHTHS) == 0.0

    def test_too_few_onsets_declines(self):
        assert _grid_bpm(_events_at(0.625, 3), 96.0, EIGHTHS) == 0.0

    def test_all_gaps_below_the_glitch_threshold_declines(self):
        events = [Event(i * 0.02, i * 0.02 + 0.01, 60, 0.5) for i in range(8)]
        assert _grid_bpm(events, 96.0, EIGHTHS) == 0.0

    def test_onsets_too_uneven_to_fit_any_grid_decline(self):
        """The corpus's own worst case, and the reason declining is a real path.

        On ``fast_sixteenths_c_major`` the detected onsets sit ~38 ms from evenly
        spaced — 22 % of a 174 ms note, and triple Basic Pitch's frame hop.  No tempo
        makes that commensurate, so every candidate is refused and librosa's estimate
        stands.  Pinned because it is tempting to read a decline as a miss and widen
        the filter until something passes; widening it far enough to admit these would
        also admit the wrong metrical levels the filter exists to reject.
        """
        events = [
            Event(t, t + 0.12, 60, 0.5)
            for t in (0.0, 0.212, 0.351, 0.542, 0.689, 0.911, 1.043, 1.254)
        ]
        assert _grid_bpm(events, 0.0, EIGHTHS) == 0.0


# ── decoded-WAV lifetime (defect 2) ───────────────────────────────────────────

class TestDecodedWavLifetime:
    """The decoded WAV must outlive inference, not be unlinked straight after it.

    This is the whole of defect 2: tempo estimation ran *after* the converted file
    was deleted, so it reopened the original .m4a, which librosa has no backend for
    on a slim container — and the clip silently came back at the 100 BPM fallback.
    The accuracy corpus cannot catch this because every case is already a .wav, so
    the conversion branch never runs there; this is the coverage.
    """

    def test_converted_wav_still_exists_while_the_pipeline_runs(self, monkeypatch, tmp_path):
        converted = tmp_path / "converted.wav"
        converted.write_bytes(b"placeholder")
        seen: dict = {}
        
        dummy_res = transcriber.TranscriptionResult("C", 1.0, 120, "4/4", "", "", [])

        def fake_inner(wav_path, mode, key_override, tempo_override, **kwargs):
            seen["path"] = wav_path
            seen["exists"] = wav_path.exists()
            return dummy_res

        monkeypatch.setattr(transcriber, "_ensure_wav_path", lambda path: (converted, True))
        monkeypatch.setattr(transcriber, "_transcribe_wav", fake_inner)

        assert transcriber.transcribe(tmp_path / "upload.m4a") == dummy_res
        assert seen["path"] == converted  # the pipeline is handed the decoded file
        assert seen["exists"] is True  # ...and it is still readable
        assert not converted.exists()  # deleted exactly once, by transcribe()

    def test_converted_wav_is_deleted_even_when_the_pipeline_raises(self, monkeypatch, tmp_path):
        converted = tmp_path / "converted.wav"
        converted.write_bytes(b"placeholder")

        def boom(*args, **kwargs):
            raise transcriber.LowConfidenceError("no notes")

        monkeypatch.setattr(transcriber, "_ensure_wav_path", lambda path: (converted, True))
        monkeypatch.setattr(transcriber, "_transcribe_wav", boom)

        with pytest.raises(transcriber.LowConfidenceError):
            transcriber.transcribe(tmp_path / "upload.m4a")
        assert not converted.exists()

    def test_the_harmony_flag_reaches_the_pipeline(self, monkeypatch, tmp_path):
        # It once stopped at transcribe(): _transcribe_wav read a name nobody passed, so every
        # job crashed at step 10b whether or not parts were asked for.
        upload = tmp_path / "upload.wav"
        upload.write_bytes(b"placeholder")
        seen: dict = {}
        dummy_res = transcriber.TranscriptionResult("C", 1.0, 120, "4/4", "", "", [])

        def fake_wav(wav_path, mode, key_override, tempo_override, **kwargs):
            seen["harmony"] = kwargs.get("harmony", "missing")
            return dummy_res

        monkeypatch.setattr(transcriber, "_ensure_wav_path", lambda path: (upload, False))
        monkeypatch.setattr(transcriber, "_transcribe_wav", fake_wav)

        transcriber.transcribe(upload)
        assert seen["harmony"] is False
        transcriber.transcribe(upload, harmony=True)
        assert seen["harmony"] is True

    def test_a_wav_upload_is_never_deleted_here(self, monkeypatch, tmp_path):
        # _ensure_wav_path hands a .wav straight back, so the caller still owns it —
        # JobQueue._run unlinks the upload for privacy (TRD par. 9).
        upload = tmp_path / "upload.wav"
        upload.write_bytes(b"placeholder")
        
        dummy_res = transcriber.TranscriptionResult("C", 1.0, 120, "4/4", "", "", [])

        monkeypatch.setattr(transcriber, "_ensure_wav_path", lambda path: (upload, False))
        monkeypatch.setattr(transcriber, "_transcribe_wav", lambda *args, **kwargs: dummy_res)

        assert transcriber.transcribe(upload) == dummy_res
        assert upload.exists()


# ── _refine_pitches (defect 6) ────────────────────────────────────────────────


def _contour(midi_values, voiced_prob=0.9, hop_sec=0.01):
    """A fake pyin contour: (frame times, MIDI with NaN where unvoiced, voiced prob)."""
    midi = np.array(midi_values, dtype=float)
    return (
        np.arange(midi.size) * hop_sec,
        midi,
        np.full(midi.size, voiced_prob, dtype=float),
    )


class TestRefinePitches:
    """With ``NF_PYIN_SEMITONE`` off, only whole-octave disagreements are acted on.

    Basic Pitch locks onto the second harmonic often enough to matter (measured: 9 of
    15 events on the clean control case were a whole octave high), and the argument for
    stopping at octaves was that a fragment shorter than one vibrato cycle has a median
    biased toward wherever in the cycle it sits — so pyin looked *not* trustworthy to
    the semitone here.  A sub-semitone bias cannot manufacture or hide a twelve-semitone
    gap, which is what made the octave decision safe where a general "believe pyin"
    would not be.  These tests pin that boundary from both sides; measurement later
    retired the argument, and ``TestRefinePitchesSemitone`` pins the other setting.
    """

    def _refine(self, monkeypatch, events, contour):
        # Explicitly off: this class pins the narrower rule, which is no longer the
        # default, and test_a_fourteen_semitone_disagreement_is_left_alone is exactly
        # where the two settings disagree.
        monkeypatch.setenv("NF_PYIN_SEMITONE", "0")
        monkeypatch.setattr(transcriber, "_pyin_contour", lambda path: contour)
        return transcriber._refine_pitches(events, Path("unused.wav"))

    def test_a_whole_octave_too_high_is_pulled_down(self, monkeypatch):
        events = [Event(0.0, 0.10, 72, 0.6)]
        result = self._refine(monkeypatch, events, _contour([60.0] * 12))
        assert [e.pitch for e in result] == [60]

    def test_two_octaves_are_corrected_too(self, monkeypatch):
        # The overtone can be the 4th harmonic, not just the 2nd.
        events = [Event(0.0, 0.10, 84, 0.6)]
        result = self._refine(monkeypatch, events, _contour([60.0] * 12))
        assert [e.pitch for e in result] == [60]

    def test_agreement_leaves_the_pitch_alone(self, monkeypatch):
        events = [Event(0.0, 0.10, 60, 0.6)]
        result = self._refine(monkeypatch, events, _contour([60.2] * 12))
        assert [e.pitch for e in result] == [60]

    def test_a_fourteen_semitone_disagreement_is_left_alone(self, monkeypatch):
        # 14 rounds to one octave, but the 2-semitone remainder exceeds
        # PYIN_OCTAVE_TOLERANCE — this is not an octave error, so it is not ours to
        # "fix".  Guarding the remainder is what keeps a genuine wrong-note detection
        # from being silently moved to a different wrong note.
        events = [Event(0.0, 0.10, 60, 0.6)]
        result = self._refine(monkeypatch, events, _contour([74.0] * 12))
        assert [e.pitch for e in result] == [60]

    def test_low_voiced_probability_blocks_the_correction(self, monkeypatch):
        # An unvoiced or noise-dominated span makes pyin's median meaningless, so the
        # octave claim is not strong enough to act on.  The literal 0.2 is deliberate:
        # deriving it from PYIN_MIN_VOICED_PROB would move with the constant and pin
        # only the mechanism, never the calibrated value.  Measured voiced_prob on real
        # note spans runs 0.69-0.76 under heavy vibrato and 0.95-0.98 clean, so 0.2 is
        # below anything a genuine note produces and 0.9 is above it.
        events = [Event(0.0, 0.10, 72, 0.6)]
        contour = _contour([60.0] * 12, voiced_prob=0.2)
        assert [e.pitch for e in self._refine(monkeypatch, events, contour)] == [72]

    def test_high_voiced_probability_allows_the_correction(self, monkeypatch):
        events = [Event(0.0, 0.10, 72, 0.6)]
        contour = _contour([60.0] * 12, voiced_prob=0.9)
        assert [e.pitch for e in self._refine(monkeypatch, events, contour)] == [60]

    def test_too_few_voiced_frames_passes_the_event_through(self, monkeypatch):
        # Two frames inside the span, under PYIN_MIN_VOICED_FRAMES: a median over that
        # is noise, not evidence.
        events = [Event(0.0, 0.015, 72, 0.6)]
        result = self._refine(monkeypatch, events, _contour([60.0] * 12))
        assert [e.pitch for e in result] == [72]

    def test_unvoiced_frames_inside_the_span_do_not_count(self, monkeypatch):
        # NaN frames are excluded from both the frame count and the median.
        events = [Event(0.0, 0.05, 72, 0.6)]
        contour = _contour([60.0, np.nan, np.nan, np.nan, 60.0, 60.0, 60.0])
        assert [e.pitch for e in self._refine(monkeypatch, events, contour)] == [60]

    def test_a_correction_outside_the_midi_range_is_skipped(self, monkeypatch):
        events = [Event(0.0, 0.10, 120, 0.6)]
        result = self._refine(monkeypatch, events, _contour([132.0] * 12))
        assert [e.pitch for e in result] == [120]

    def test_an_empty_contour_returns_the_events_unchanged(self, monkeypatch):
        # pyin was skipped (over budget), failed, or found nothing voiced.  Every
        # caller reads that as "no refinement available" and keeps Basic Pitch's work.
        events = [Event(0.0, 0.10, 72, 0.6), Event(0.2, 0.30, 74, 0.5)]
        contour = (np.empty(0), np.empty(0), np.empty(0))
        assert self._refine(monkeypatch, events, contour) == events

    def test_only_the_events_own_span_is_consulted(self, monkeypatch):
        # Two events an octave apart in the detection, both genuinely at 60 and 67:
        # each must be judged against its own frames, not the whole clip's median.
        events = [Event(0.0, 0.05, 72, 0.6), Event(0.10, 0.15, 67, 0.6)]
        contour = _contour([60.0] * 6 + [np.nan] * 4 + [67.0] * 6)
        assert [e.pitch for e in self._refine(monkeypatch, events, contour)] == [60, 67]

    def test_every_other_field_survives_the_correction(self, monkeypatch):
        events = [Event(0.25, 0.55, 72, 0.61)]
        (refined,) = self._refine(monkeypatch, events, _contour([60.0] * 60))
        assert (refined.start, refined.end, refined.amp) == (0.25, 0.55, 0.61)


class TestRefinePitchesSemitone:
    """With ``NF_PYIN_SEMITONE`` on, pyin's rounded median becomes the pitch.

    The octave-only rule's premise was that a fragment's median is too biased to trust
    to the semitone.  Measured over the eight vibrato/drift cases, 577 events, the
    rounded median is right 73.4% of the time against the octave-corrected pipeline's
    18.7% — 278 fixes against 17 breaks — and it changes nothing in either direction on
    the four guard cases, including the genuine mi-fa and ti-doh steps.  That corpus run
    is the real evidence for the rule; these tests pin the mechanism, the shared gates
    it still respects, and the two places it deliberately departs from the octave path.
    """

    def _refine(self, monkeypatch, events, contour):
        monkeypatch.setenv("NF_PYIN_SEMITONE", "1")
        monkeypatch.setattr(transcriber, "_pyin_contour", lambda path: contour)
        return transcriber._refine_pitches(events, Path("unused.wav"))

    def test_a_semitone_too_high_is_pulled_down(self, monkeypatch):
        # The reported defect in miniature: heavy vibrato parks Basic Pitch on the
        # semitone neighbour, so a sung A4 comes back as a run of B-flats and the
        # notation prints an accidental that is not in the music.
        events = [Event(0.0, 0.10, 70, 0.6)]
        result = self._refine(monkeypatch, events, _contour([69.0] * 12))
        assert [e.pitch for e in result] == [69]

    def test_octaves_are_still_corrected(self, monkeypatch):
        # Rounding the median subsumes the octave rule rather than replacing it, so the
        # overtone lock this stage was built for keeps being fixed.
        events = [Event(0.0, 0.10, 72, 0.6), Event(0.2, 0.30, 84, 0.6)]
        contour = _contour([60.0] * 12 + [np.nan] * 8 + [60.0] * 12)
        assert [e.pitch for e in self._refine(monkeypatch, events, contour)] == [60, 60]

    def test_a_fourteen_semitone_disagreement_is_taken_here(self, monkeypatch):
        # The deliberate departure from the octave path, which leaves this alone because
        # the 2-semitone remainder says "not an octave error".  Rounding has no such
        # notion: pyin saw 74 for the whole span, so 74 is the pitch.
        events = [Event(0.0, 0.10, 60, 0.6)]
        result = self._refine(monkeypatch, events, _contour([74.0] * 12))
        assert [e.pitch for e in result] == [74]

    def test_the_median_rounds_to_the_nearer_semitone(self, monkeypatch):
        # No commit-distance filter: a median mid-way between two semitones is still
        # acted on.  Requiring the median to sit near a whole number was swept over
        # 0.20-0.50 and costs more fixes than it saves breaks at every setting.
        for median, expected in ((69.4, 69), (69.6, 70), (69.5, 70)):
            events = [Event(0.0, 0.10, 64, 0.6)]
            result = self._refine(monkeypatch, events, _contour([median] * 12))
            assert [e.pitch for e in result] == [expected], median

    def test_a_genuine_semitone_step_is_not_flattened(self, monkeypatch):
        # Each event is judged against its own frames, so two real notes a semitone
        # apart stay two real notes.  This is the failure mode a semitone rule most
        # endangers; the corpus's semitone_steps_c_major case is the load-bearing
        # version of this test, and it moves by zero events with the flag on.
        events = [Event(0.0, 0.05, 64, 0.6), Event(0.10, 0.15, 65, 0.6)]
        contour = _contour([64.1] * 6 + [np.nan] * 4 + [64.9] * 6)
        assert [e.pitch for e in self._refine(monkeypatch, events, contour)] == [64, 65]

    def test_agreement_leaves_the_pitch_alone(self, monkeypatch):
        events = [Event(0.0, 0.10, 60, 0.6)]
        result = self._refine(monkeypatch, events, _contour([60.2] * 12))
        assert [e.pitch for e in result] == [60]

    def test_low_voiced_probability_still_blocks_it(self, monkeypatch):
        # The confidence floor is shared with the octave path rather than loosened for
        # this one: a noise-dominated span makes the median meaningless either way.
        # Dropping the floor to 0.0 measured 71 more fixes for 5 fewer breaks on the
        # corpus, but that is synthetic vibrato agreeing with itself — not a reason to
        # trust pyin where pyin says it is unsure.
        events = [Event(0.0, 0.10, 70, 0.6)]
        contour = _contour([69.0] * 12, voiced_prob=0.2)
        assert [e.pitch for e in self._refine(monkeypatch, events, contour)] == [70]

    def test_too_few_voiced_frames_still_passes_the_event_through(self, monkeypatch):
        events = [Event(0.0, 0.015, 70, 0.6)]
        result = self._refine(monkeypatch, events, _contour([69.0] * 12))
        assert [e.pitch for e in result] == [70]

    def test_a_median_outside_the_midi_range_is_skipped(self, monkeypatch):
        events = [Event(0.0, 0.10, 120, 0.6)]
        result = self._refine(monkeypatch, events, _contour([130.0] * 12))
        assert [e.pitch for e in result] == [120]

    def test_an_empty_contour_returns_the_events_unchanged(self, monkeypatch):
        events = [Event(0.0, 0.10, 70, 0.6), Event(0.2, 0.30, 74, 0.5)]
        contour = (np.empty(0), np.empty(0), np.empty(0))
        assert self._refine(monkeypatch, events, contour) == events

    def test_every_other_field_survives_the_correction(self, monkeypatch):
        events = [Event(0.25, 0.55, 70, 0.61)]
        (refined,) = self._refine(monkeypatch, events, _contour([69.0] * 60))
        assert (refined.start, refined.end, refined.amp) == (0.25, 0.55, 0.61)


# ── _refine_pitches carries pyin's evidence forward ───────────────────────────


class TestRefinePitchesCarriesEvidence:
    """Every branch that *can* measure pyin must leave the measurement on the event.

    ``_blend_confidence`` is the only consumer, and it has to tell three states apart
    that look identical if a branch forgets to attach what it measured: pyin agreed,
    pyin disagreed and was overruled, and pyin never spoke at all.  A ``continue`` that
    appends the bare event silently reports the third for the first two, and the
    confidence field goes quietly back to being bare amplitude.
    """

    def _refine(self, monkeypatch, events, contour, semitone="0"):
        monkeypatch.setenv("NF_PYIN_SEMITONE", semitone)
        monkeypatch.setattr(transcriber, "_pyin_contour", lambda path: contour)
        return transcriber._refine_pitches(events, Path("unused.wav"))

    def test_a_corrected_event_carries_the_reading_that_corrected_it(self, monkeypatch):
        events = [Event(0.0, 0.10, 72, 0.6)]
        (refined,) = self._refine(monkeypatch, events, _contour([60.0] * 12))
        assert refined.pitch == 60
        assert refined.pyin_midi == pytest.approx(60.0)
        assert refined.voiced_prob == pytest.approx(0.9)

    def test_an_event_pyin_agreed_with_still_carries_the_reading(self, monkeypatch):
        # Nothing to correct, but "two engines independently landed on this pitch" is
        # the strongest evidence the pipeline has and this is the only place it exists.
        events = [Event(0.0, 0.10, 60, 0.6)]
        (refined,) = self._refine(monkeypatch, events, _contour([60.0] * 12))
        assert (refined.pitch, refined.pyin_midi) == (60, pytest.approx(60.0))

    def test_the_voiced_probability_gate_does_not_discard_the_reading(self, monkeypatch):
        # The branch most likely to regress, because it exists to decline to act — and
        # "pyin was unsure here" is precisely what the blend needs to hear.
        events = [Event(0.0, 0.10, 70, 0.6)]
        contour = _contour([69.0] * 12, voiced_prob=0.2)
        (refined,) = self._refine(monkeypatch, events, contour)
        assert refined.pitch == 70  # unchanged, as TestRefinePitches pins
        assert refined.pyin_midi == pytest.approx(69.0)
        assert refined.voiced_prob == pytest.approx(0.2)

    def test_an_overruled_disagreement_carries_the_reading(self, monkeypatch):
        # Octave path, two semitones out: not an octave error, so the pitch stands.
        # A two-semitone disagreement is still a reason to distrust the note.
        events = [Event(0.0, 0.10, 62, 0.6)]
        (refined,) = self._refine(monkeypatch, events, _contour([60.0] * 12))
        assert (refined.pitch, refined.pyin_midi) == (62, pytest.approx(60.0))

    def test_an_out_of_range_candidate_still_carries_the_reading(self, monkeypatch):
        events = [Event(0.0, 0.10, 120, 0.6)]
        (refined,) = self._refine(
            monkeypatch, events, _contour([130.0] * 12), semitone="1"
        )
        assert (refined.pitch, refined.pyin_midi) == (120, pytest.approx(130.0))

    def test_too_few_voiced_frames_leaves_no_reading_at_all(self, monkeypatch):
        # Deliberately different from a low probability: pyin did not speak, so there is
        # nothing to carry and the blend must fall back to amplitude, not to a zero that
        # would read as "pyin contradicted this note".
        events = [Event(0.0, 0.015, 70, 0.6)]
        (refined,) = self._refine(monkeypatch, events, _contour([69.0] * 12))
        assert refined.pyin_midi is None
        assert refined.voiced_prob == 0.0

    def test_an_empty_contour_leaves_no_reading_at_all(self, monkeypatch):
        events = [Event(0.0, 0.10, 70, 0.6)]
        contour = (np.empty(0), np.empty(0), np.empty(0))
        (refined,) = self._refine(monkeypatch, events, contour)
        assert refined.pyin_midi is None


# ── _blend_confidence ─────────────────────────────────────────────────────────


class TestBlendConfidence:
    """The number the client bands as High / Fair / Low and counts below 0.5.

    The weights came from a corpus sweep (see ``CONF_WEIGHT_AMP`` for the table).  These
    tests pin the *shape* rather than the tuning: the properties that have to hold at any
    weights for the field to mean anything, so a later re-sweep is free to move the
    constants without rewriting the suite.
    """

    def test_no_onset_posterior_falls_back_to_amplitude(self):
        # Not to zero.  ``Posteriorgram.capture`` returns None on an unusable model_output,
        # and an event with no onset reading is not thereby a bad note — Basic Pitch's
        # amplitude is still real evidence about it.
        assert _blend_confidence(Event(0.0, 0.5, 60, 0.62)) == pytest.approx(0.62)

    def test_a_strong_onset_raises_confidence_above_bare_amplitude(self):
        evt = Event(0.0, 0.5, 60, 0.62, onset_post=1.0)
        assert _blend_confidence(evt) > 0.62

    def test_a_missing_onset_lowers_confidence_below_bare_amplitude(self):
        # The case the term exists to flag: a note whose start the trained onset detector
        # never fired at.  Onsets & Frames measured 18% relative note F1 riding on exactly
        # this signal, so a note without it should rank below one with it.
        evt = Event(0.0, 0.5, 60, 0.62, onset_post=0.0)
        assert _blend_confidence(evt) < 0.62

    def test_confidence_is_monotone_in_the_onset_posterior(self):
        def conf(onset_post):
            return _blend_confidence(Event(0.0, 0.5, 60, 0.62, onset_post=onset_post))

        assert conf(0.0) < conf(0.5) < conf(1.0)

    def test_a_weak_onset_cannot_zero_a_loud_note(self):
        # The term is averaged in, not multiplied: a missed attack is common and forgivable
        # on a soft legato re-attack, so it must lower the rank rather than gate the note.
        # This function only ranks; nothing downstream drops a note for a low conf.
        assert _blend_confidence(Event(0.0, 0.5, 60, 1.0, onset_post=0.0)) > 0.0

    def test_pyin_no_longer_moves_the_answer(self):
        # Regression guard, not a preference.  The pyin/Basic-Pitch agreement term measured
        # at auc 0.448 and voiced_prob at 0.357 — both at or below chance — because on the
        # default contour path ``pitch`` is derived FROM ``pyin_midi``, making them one
        # measurement.  Re-adding either silently would regress conf.auc; this fails if it
        # happens.  The fields stay on Event for ``pitch_refined`` and ``_refine_pitches``.
        base = _blend_confidence(Event(0.0, 0.5, 60, 0.62, onset_post=0.8))
        agreeing = Event(0.0, 0.5, 60, 0.62, pyin_midi=60.0, voiced_prob=1.0, onset_post=0.8)
        contradicting = Event(
            0.0, 0.5, 60, 0.62, pyin_midi=67.0, voiced_prob=1.0, onset_post=0.8
        )
        assert _blend_confidence(agreeing) == pytest.approx(base)
        assert _blend_confidence(contradicting) == pytest.approx(base)

    def test_is_the_documented_weighted_mean(self):
        # Pins the formula in the CONF_WEIGHT_AMP block against the code.
        evt = Event(0.0, 0.5, 60, 0.5, onset_post=1.0)
        expected = (CONF_WEIGHT_AMP * 0.5 + CONF_WEIGHT_ONSET * 1.0) / (
            CONF_WEIGHT_AMP + CONF_WEIGHT_ONSET
        )
        assert _blend_confidence(evt) == pytest.approx(expected)

    @pytest.mark.parametrize(
        "amp, onset_post",
        [
            (0.0, 0.0),
            (1.0, 1.0),
            (0.0, 1.0),
            (1.0, 0.0),
            (1.2, 1.4),  # out-of-range inputs must not escape the interval
            (-0.3, -0.2),
        ],
    )
    def test_stays_inside_the_unit_interval(self, amp, onset_post):
        # The client's banding assumes [0, 1] and the DTO rounds to three places.
        value = _blend_confidence(Event(0.0, 0.5, 60, amp, onset_post=onset_post))
        assert 0.0 <= value <= 1.0

    def test_a_struck_note_reads_high_and_an_unstruck_one_does_not(self):
        # The end-to-end claim, at the 0.75 cut mobile/src/design/theme.ts:452 uses for
        # "High confidence".  Same amplitude in both — only the onset head differs, which is
        # the whole point: a loud note the onset head never saw start is the ghost shape.
        struck = Event(0.0, 0.5, 60, 0.80, onset_post=0.95)
        unstruck = Event(0.0, 0.5, 60, 0.80, onset_post=0.10)
        assert _blend_confidence(struck) >= 0.75
        assert _blend_confidence(unstruck) < 0.75


# ── _pyin_contour (defect 6) ──────────────────────────────────────────────────


class TestPyinContour:
    """Every failure path must degrade to "no refinement", never raise.

    pyin is the most expensive thing in the pipeline (~0.23x realtime at the grid
    ``pyin_resolution`` sets, ~0.54x at librosa's default) and runs on a single-worker
    queue, so the length budget is a latency guarantee rather than a nicety — and a
    tracker that throws on an odd clip must not fail the whole job.
    """

    def _patch_librosa(self, monkeypatch, load=None, pyin=None):
        import librosa

        if load is not None:
            monkeypatch.setattr(librosa, "load", load)
        if pyin is not None:
            monkeypatch.setattr(librosa, "pyin", pyin)

    def test_the_configured_resolution_reaches_librosa(self, monkeypatch, tmp_path):
        """The coarse grid is what pays for the 180 s budget, and losing it is invisible.

        Dropping the kwarg does not break a transcription or move a metric — it silently
        restores librosa's 481-bin default, making pyin 2.4x slower on a single-worker
        queue.  Nothing else in the suite would notice, and the symptom reaches users as
        latency on long clips rather than as a failure.  So the pass-through is pinned.
        """
        seen = {}

        def fake_pyin(y, **kwargs):
            seen.update(kwargs)
            return np.full(4, 440.0), np.ones(4, dtype=bool), np.ones(4)

        monkeypatch.setenv("NF_PYIN_RESOLUTION", "0.4")
        self._patch_librosa(
            monkeypatch,
            load=lambda *a, **k: (np.zeros(22_050, dtype=np.float32), 22_050),
            pyin=fake_pyin,
        )
        transcriber._pyin_contour(tmp_path / "clip.wav")
        assert seen.get("resolution") == pytest.approx(0.4)

    def test_a_clip_over_the_budget_is_skipped(self, monkeypatch, tmp_path):
        monkeypatch.setenv("NF_PYIN_MAX_SECONDS", "1")
        called = []
        self._patch_librosa(
            monkeypatch,
            load=lambda *a, **k: (np.zeros(22_050 * 5, dtype=np.float32), 22_050),
            pyin=lambda *a, **k: called.append(1),
        )
        times, midi, prob = transcriber._pyin_contour(tmp_path / "long.wav")
        assert (times.size, midi.size, prob.size) == (0, 0, 0)
        assert not called  # the budget is checked before pyin runs, not after

    def test_an_unreadable_clip_returns_empty_arrays(self, monkeypatch, tmp_path):
        def boom(*a, **k):
            raise RuntimeError("no backend")

        self._patch_librosa(monkeypatch, load=boom)
        times, midi, prob = transcriber._pyin_contour(tmp_path / "bad.wav")
        assert (times.size, midi.size, prob.size) == (0, 0, 0)

    def test_a_clip_with_no_voiced_frames_returns_empty_arrays(self, monkeypatch, tmp_path):
        self._patch_librosa(
            monkeypatch,
            load=lambda *a, **k: (np.zeros(2_205, dtype=np.float32), 22_050),
            pyin=lambda *a, **k: (
                np.full(8, np.nan),
                np.zeros(8, dtype=bool),
                np.zeros(8),
            ),
        )
        times, midi, prob = transcriber._pyin_contour(tmp_path / "silence.wav")
        assert (times.size, midi.size, prob.size) == (0, 0, 0)

    def test_voiced_frames_come_back_as_midi_with_nan_gaps(self, monkeypatch, tmp_path):
        # 440 Hz is MIDI 69 by definition, which makes this an exact check on the
        # Hz→MIDI conversion and on unvoiced frames staying NaN rather than becoming 0.
        self._patch_librosa(
            monkeypatch,
            load=lambda *a, **k: (np.zeros(2_205, dtype=np.float32), 22_050),
            pyin=lambda *a, **k: (
                np.array([440.0, np.nan, 880.0]),
                np.array([True, False, True]),
                np.array([0.9, 0.1, 0.8]),
            ),
        )
        times, midi, prob = transcriber._pyin_contour(tmp_path / "tone.wav")
        assert times.size == 3
        assert midi[0] == pytest.approx(69.0)
        assert np.isnan(midi[1])
        assert midi[2] == pytest.approx(81.0)
        assert prob.tolist() == pytest.approx([0.9, 0.1, 0.8])


# ── _estimate_tempo_and_beats (defect 1, the tempo_override branch) ───────────


class TestEstimateTempoAndBeats:
    """The override says how FAST the piece is, not WHERE its downbeats sit.

    So a tap-in override must win for the BPM and still let beat tracking run — seeded
    with that BPM — to recover phase.  Phase 2b's plan called this sub-requirement out
    as the easy one to skip, and skipping it is silent: the BPM would still be right and
    only the barline would drift, which no other assertion here would catch.
    """

    def _patch(self, monkeypatch, load=None, beat_track=None):
        import librosa

        if load is not None:
            monkeypatch.setattr(librosa, "load", load)
        if beat_track is not None:
            monkeypatch.setattr(librosa.beat, "beat_track", beat_track)

    def _load(self):
        return lambda *a, **k: (np.zeros(22_050, dtype=np.float32), 22_050)

    def test_an_override_wins_the_bpm_but_keeps_the_tracked_phase(self, monkeypatch, tmp_path):
        self._patch(
            monkeypatch,
            load=self._load(),
            beat_track=lambda **k: (np.array([131.0]), np.array([0.4, 0.9, 1.4])),
        )
        bpm, beats = transcriber._estimate_tempo_and_beats(tmp_path / "a.wav", [], 90)
        assert bpm == pytest.approx(90.0)  # the user's number, not librosa's 131
        assert beats.tolist() == pytest.approx([0.4, 0.9, 1.4])  # phase survives

    def test_the_override_seeds_the_tracker(self, monkeypatch, tmp_path):
        # Without start_bpm the tracker can lock onto a metrical multiple, which puts the
        # beats in the right period but the wrong places.
        seen = {}

        def spy(**kwargs):
            seen.update(kwargs)
            return np.array([90.0]), np.array([0.5])

        self._patch(monkeypatch, load=self._load(), beat_track=spy)
        transcriber._estimate_tempo_and_beats(tmp_path / "a.wav", [], 90)
        assert seen.get("start_bpm") == pytest.approx(90.0)

    def test_no_override_means_no_seed(self, monkeypatch, tmp_path):
        seen = {}

        def spy(**kwargs):
            seen.update(kwargs)
            return np.array([120.0]), np.array([0.5])

        self._patch(monkeypatch, load=self._load(), beat_track=spy)
        transcriber._estimate_tempo_and_beats(tmp_path / "a.wav", [], None)
        assert "start_bpm" not in seen

    def test_without_an_override_the_tracked_bpm_is_used(self, monkeypatch, tmp_path):
        self._patch(
            monkeypatch,
            load=self._load(),
            beat_track=lambda **k: (np.array([102.0]), np.array([0.25, 0.84])),
        )
        bpm, beats = transcriber._estimate_tempo_and_beats(tmp_path / "a.wav", [], None)
        assert bpm == pytest.approx(102.0)
        assert beats.size == 2

    def test_an_out_of_range_tracked_bpm_falls_back_to_the_onset_guess(self, monkeypatch, tmp_path):
        # Two events one second apart imply 60 BPM; the absurd tracked value is rejected
        # rather than propagated into every note's beat position.
        events = [Event(0.0, 0.5, 60, 0.8), Event(1.0, 1.5, 62, 0.8)]
        self._patch(
            monkeypatch,
            load=self._load(),
            beat_track=lambda **k: (np.array([7.0]), np.array([0.1])),
        )
        bpm, _beats = transcriber._estimate_tempo_and_beats(tmp_path / "a.wav", events, None)
        assert transcriber._MIN_BPM <= bpm <= transcriber._MAX_BPM
        assert bpm != pytest.approx(7.0)

    def test_a_tracker_failure_leaves_the_override_intact_with_no_phase(self, monkeypatch, tmp_path):
        # An unreadable clip must not lose the user's BPM; _beat_origin reads the empty
        # array as "no phase information" and anchors on the first onset instead.
        def boom(*a, **k):
            raise RuntimeError("no backend")

        self._patch(monkeypatch, load=boom)
        bpm, beats = transcriber._estimate_tempo_and_beats(tmp_path / "bad.wav", [], 96)
        assert bpm == pytest.approx(96.0)
        assert beats.size == 0

    def test_a_tracker_failure_without_an_override_still_returns_a_usable_bpm(
        self, monkeypatch, tmp_path
    ):
        def boom(*a, **k):
            raise RuntimeError("no backend")

        self._patch(monkeypatch, load=boom)
        bpm, beats = transcriber._estimate_tempo_and_beats(tmp_path / "bad.wav", [], None)
        assert bpm == pytest.approx(transcriber._DEFAULT_BPM)
        assert beats.size == 0

    def test_non_finite_beat_times_are_dropped(self, monkeypatch, tmp_path):
        # A NaN beat would make _beat_origin's comparisons silently false rather than
        # raising, so it is filtered at the source.
        self._patch(
            monkeypatch,
            load=self._load(),
            beat_track=lambda **k: (np.array([120.0]), np.array([0.5, np.nan, 1.0, np.inf])),
        )
        _bpm, beats = transcriber._estimate_tempo_and_beats(tmp_path / "a.wav", [], None)
        assert beats.tolist() == pytest.approx([0.5, 1.0])

    def test_a_scalar_tempo_return_is_accepted(self, monkeypatch, tmp_path):
        # librosa has returned tempo as both a scalar and a 1-element array across
        # versions; atleast_1d is what makes this pinning-independent.
        self._patch(
            monkeypatch,
            load=self._load(),
            beat_track=lambda **k: (110.0, np.array([0.5])),
        )
        bpm, _beats = transcriber._estimate_tempo_and_beats(tmp_path / "a.wav", [], None)
        assert bpm == pytest.approx(110.0)


# ── Key detection ensemble (defects 3, 4) ─────────────────────────────────────


def _stream(pitch_names, quarter_length=1.0):
    """A bare music21 stream of quarter notes — enough for any pitch profile."""
    from music21 import note as m21note, stream as m21stream

    s = m21stream.Stream()
    for name in pitch_names:
        s.append(m21note.Note(name, quarterLength=quarter_length))
    return s


class TestProfileZScores:
    """Standardisation is what makes profiles comparable before they are summed.

    Raw correlationCoefficient values have a per-profile scale, so summing them
    unstandardised silently weights whichever profile reports the biggest numbers.
    """

    def _scores(self, pitch_names):
        from music21.analysis import discrete

        return transcriber._profile_z_scores(discrete.KrumhanslSchmuckler(), _stream(pitch_names))

    def test_all_twenty_four_keys_are_scored(self):
        scores = self._scores(["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"])
        assert len(scores) == 24
        assert {mode for _pc, mode in scores} == {"major", "minor"}

    def test_scores_are_standardised(self):
        scores = self._scores(["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"])
        values = np.array(list(scores.values()))
        assert values.mean() == pytest.approx(0.0, abs=1e-9)
        assert values.std() == pytest.approx(1.0, abs=1e-9)

    def test_keys_are_pitch_class_and_mode_not_spelling(self):
        # Enharmonic spellings of one key must not split the vote, so the identity is
        # (pitch class, mode) rather than a name.
        scores = self._scores(["C4", "E4", "G4"])
        assert all(isinstance(pc, int) and 0 <= pc <= 11 for pc, _mode in scores)

    def test_a_profile_with_no_spread_is_ignored(self):
        # A zero-variance profile has no opinion; dividing by its spread would be a
        # divide-by-zero and letting it through unnormalised would let it dominate.
        class Flat:
            def getSolution(self, _s):
                class K:
                    correlationCoefficient = 0.5

                    class tonic:
                        pitchClass = 0

                    mode = "major"
                    alternateInterpretations = []

                return K()

        assert transcriber._profile_z_scores(Flat(), _stream(["C4"])) == {}


class TestKeyFromIdentity:
    def test_round_trips_through_normalise_to_the_wire_convention(self):
        # The wire value must stay in the "Bb"/"Eb" convention the C# KeyParser
        # accepts; music21's internal "B-" must never escape.
        for pitch_class in range(12):
            key = _key_from_identity(pitch_class, "major")
            assert key.tonic.pitchClass == pitch_class
            assert "-" not in _normalise_key_name(f"{key.tonic.name} major")

    def test_mode_is_preserved(self):
        assert _key_from_identity(9, "minor").mode == "minor"
        assert _key_from_identity(9, "major").mode == "major"


class TestKeySpelling:
    """Accidentals must belong to the key, not to music21's MIDI-to-name table.

    That table is ``C C# D E- E F F# G G# A B- B`` and is key-blind, so a note built
    from a bare MIDI integer is spelled the same in every key.  In E major MIDI 75 came
    out E-flat when the key's own signature holds a D-sharp; in A-flat major MIDI 68
    came out G-sharp where the key says A-flat.  Both engrave an accidental the reader
    then has to reconcile against a signature that already said otherwise.
    """

    KEYS = [
        (tonic, mode)
        for tonic in ("C", "C#", "D-", "D", "E-", "E", "F", "F#", "G-", "G", "A-", "A", "B-", "B")
        for mode in ("major", "minor")
    ]

    def _key(self, tonic: str, mode: str):
        from music21 import key as m21key

        return m21key.Key(tonic, mode)

    def test_every_pitch_class_is_spelled_in_every_key(self):
        for tonic, mode in self.KEYS:
            spelling = _key_spelling(self._key(tonic, mode))
            assert set(spelling) == set(range(12)), f"{tonic} {mode} is missing a pitch class"

    def test_the_spelling_always_names_the_pitch_class_it_is_filed_under(self):
        """A map that renames a note is worse than no map: solfa reads the MIDI number."""
        from music21 import pitch as m21pitch

        for tonic, mode in self.KEYS:
            spelling = _key_spelling(self._key(tonic, mode))
            for pitch_class, name in spelling.items():
                assert m21pitch.Pitch(name).pitchClass == pitch_class, f"{tonic} {mode}: {name}"

    def test_the_seven_diatonic_degrees_are_spelled_by_the_signature(self):
        for tonic, mode in self.KEYS:
            key = self._key(tonic, mode)
            spelling = _key_spelling(key)
            for altered in key.alteredPitches:
                assert spelling[altered.pitchClass] == altered.name, (
                    f"{tonic} {mode}: pitch class {altered.pitchClass} should be {altered.name}"
                )

    def test_e_major_spells_the_signature_not_the_midi_table(self):
        # The reported defect, exactly: MIDI 75 is E major's D#, and the fixed table
        # calls it E-flat.
        spelling = _key_spelling(self._key("E", "major"))
        assert spelling[75 % 12] == "D#"
        assert spelling[68 % 12] == "G#"
        # A pitch class the signature did not claim keeps its plain letter.
        assert spelling[0] == "C"

    def test_flat_keys_spell_flats(self):
        spelling = _key_spelling(self._key("A-", "major"))
        assert spelling[68 % 12] == "A-"  # not G#
        assert spelling[73 % 12] == "D-"  # not C#

    def test_f_sharp_major_reaches_e_sharp(self):
        # Six sharps means the 4th degree is E#, which no MIDI table will ever produce.
        assert _key_spelling(self._key("F#", "major"))[77 % 12] == "E#"

    def test_a_minor_key_raises_its_seventh(self):
        """A leading tone is ordinary, and the flat-key rule alone would misspell it."""
        assert _key_spelling(self._key("D", "minor"))[1] == "C#"  # not D-flat
        assert _key_spelling(self._key("G", "minor"))[6] == "F#"  # not G-flat
        assert _key_spelling(self._key("A", "minor"))[8] == "G#"

    def test_raising_the_seventh_raises_its_letter_rather_than_adding_a_sharp(self):
        # C minor's 7th degree is B-flat, so raising it gives plain B — not B-sharp and
        # not C-flat.  An earlier draft assumed a sharp and raised KeyError on this key.
        assert _key_spelling(self._key("C", "minor"))[11] == "B"
        assert _key_spelling(self._key("B-", "minor"))[9] == "A"
        assert _key_spelling(self._key("F", "minor"))[4] == "E"

    def test_a_signature_that_alters_every_letter_keeps_all_seven_spellings(self):
        """D-flat minor is the key where filing one letter at a time loses one.

        Its eight-flat signature alters all seven letters — B twice, as B-flat and then
        B-double-flat — and C-flat's pitch class is 11, the same slot B's natural
        occupies.  An earlier draft vacated each letter as it filed it, so
        B-double-flat's vacate of slot 11 deleted the C-flat that had already been filed
        there and the signature's C-flat came back spelled ``B``.  Nothing else in the
        28 keys swept above reaches this; the sweep is what found it.
        """
        key = self._key("D-", "minor")
        spelling = _key_spelling(key)
        assert {altered.step for altered in key.alteredPitches} == set("ABCDEFG")
        assert spelling[11] == "C-"
        assert spelling[9] == "B--"
        # The raised 7th of D-flat minor is C-flat raised, which is plain C.
        assert spelling[0] == "C"


class TestRespellToKey:
    """Respelling is a notation change only — it must never move a pitch.

    Solfa is mapped from ``n.pitch.midi`` *after* this runs, so a spelling whose octave
    is solved wrongly would transpose the syllable as well as the notehead.
    """

    def _stream(self, midis):
        from music21 import note as m21note
        from music21 import stream

        s = stream.Stream()
        for midi in midis:
            n = m21note.Note(midi)
            n.duration.quarterLength = 1.0
            s.append(n)
        return s

    def _key(self, tonic, mode):
        from music21 import key as m21key

        return m21key.Key(tonic, mode)

    def test_midi_is_invariant_across_every_key_and_the_whole_piano(self):
        midis = list(range(21, 109))  # A0 to C8
        for tonic, mode in TestKeySpelling.KEYS:
            s = self._stream(midis)
            _respell_to_key(s, self._key(tonic, mode))
            assert [n.pitch.midi for n in s.recurse().notes] == midis, f"{tonic} {mode} transposed"

    def test_it_respells_the_reported_defect(self):
        s = self._stream([75])
        assert s.recurse().notes[0].pitch.name == "E-"  # what music21 gives us
        _respell_to_key(s, self._key("E", "major"))
        assert s.recurse().notes[0].pitch.nameWithOctave == "D#5"

    def test_octaves_survive_a_signature_that_names_c_flat(self):
        # C-flat major's signature holds C- and F-, whose letters sit in the neighbouring
        # octave — the case that makes "midi // 12 - 1" the wrong way to pick an octave.
        for midi in (59, 60, 61, 71, 72):
            s = self._stream([midi])
            _respell_to_key(s, self._key("C-", "major"))
            assert s.recurse().notes[0].pitch.midi == midi

    def test_a_scale_in_its_own_key_engraves_no_accidental(self):
        """The user-visible payoff, and the one that pins makeAccidentals' arguments."""
        from music21 import key as m21key

        for tonic, mode, midis in (
            ("E", "major", [64, 66, 68, 69, 71, 73, 75, 76]),
            ("B-", "major", [70, 72, 74, 75, 77, 79, 81, 82]),
            ("A-", "major", [68, 70, 72, 73, 75, 77, 79, 80]),
            ("F#", "major", [66, 68, 70, 71, 73, 75, 77, 78]),
        ):
            key = self._key(tonic, mode)
            s = self._stream(midis)
            s.insert(0, m21key.Key(key.tonic.name, key.mode))
            _respell_to_key(s, key)
            score = s.makeMeasures()
            score.makeAccidentals(inPlace=True, alteredPitches=key.alteredPitches)
            printed = [
                n.pitch.nameWithOctave
                for n in score.recurse().notes
                if n.pitch.accidental is not None and n.pitch.accidental.displayStatus
            ]
            assert printed == [], f"{tonic} {mode} scale printed {printed}"

    def test_a_chromatic_note_still_prints_and_a_cancelling_natural_still_prints(self):
        # The guard on the above: suppressing the signature's own accidentals must not
        # suppress the ones that carry information.
        from music21 import key as m21key

        key = self._key("C", "major")
        s = self._stream([60, 61, 60, 62])  # C, C#, C natural, D — all in one measure
        s.insert(0, m21key.Key("C", "major"))
        _respell_to_key(s, key)
        score = s.makeMeasures()
        score.makeAccidentals(inPlace=True, alteredPitches=key.alteredPitches)
        shown = [
            (n.pitch.nameWithOctave, n.pitch.accidental.name)
            for n in score.recurse().notes
            if n.pitch.accidental is not None and n.pitch.accidental.displayStatus
        ]
        assert shown == [("C#4", "sharp"), ("C4", "natural")]


class TestKeyConfidenceFromMargin:
    """Confidence is the winner's lead, not the winner's own correlation.

    The defect: correlationCoefficient sits high even when wrong, because it measures
    fit to the winner without asking how well the runner-up fits.  Measured over the
    corpus, replacing it moves mean(correct) - max(wrong) from -0.021 to +0.340.
    """

    def test_no_lead_is_no_confidence(self):
        assert _key_confidence_from_margin(0.0, 12) == pytest.approx(0.0)

    def test_a_full_margin_saturates(self):
        assert _key_confidence_from_margin(KEY_MARGIN_FULL, 12) == pytest.approx(1.0)

    def test_beyond_a_full_margin_is_clamped_not_extrapolated(self):
        assert _key_confidence_from_margin(KEY_MARGIN_FULL * 5, 12) == pytest.approx(1.0)

    def test_a_negative_margin_cannot_produce_negative_confidence(self):
        assert _key_confidence_from_margin(-1.0, 12) == pytest.approx(0.0)

    def test_it_rises_monotonically_with_the_lead(self):
        margins = [0.0, 0.1, 0.25, 0.5, 0.75]
        confidences = [_key_confidence_from_margin(m, 12) for m in margins]
        assert confidences == sorted(confidences)

    def test_a_short_clip_is_capped_however_wide_the_lead(self):
        # Too few pitch classes for any profile to be reliable, so the mobile must
        # still offer the editable-key field.
        capped = _key_confidence_from_margin(KEY_MARGIN_FULL, MIN_NOTES_FOR_KEY - 1)
        assert capped == pytest.approx(KEY_CONFIDENCE_CAP_LOW)

    def test_the_cap_does_not_raise_an_already_low_confidence(self):
        assert _key_confidence_from_margin(0.0, MIN_NOTES_FOR_KEY - 1) == pytest.approx(0.0)


class TestDetectKey:
    """The ensemble exists to cancel the single-profile bias, so that is what is pinned.

    music21's Stream.analyze("key") is AardenEssen alone, whose documented weakness is
    calling the subdominant the tonic.  These are the cases where it does exactly that.
    """

    def test_it_beats_the_single_profile_default_on_the_subdominant_trap(self):
        s = _stream(["C4", "E4", "G4", "C5", "F4", "A4", "G4", "C4"])
        assert str(s.analyze("key")) == "F major"  # the defect, still reproducible
        key, _conf = transcriber._detect_key(s, 8)
        assert (key.tonic.pitchClass, key.mode) == (0, "major")

    def test_a_key_that_would_make_a_note_chromatic_loses_to_one_that_holds_it(self):
        # Leans on F and A, so the vote alone says F major; but the B natural leading to the
        # final C would then be a "fe". C major holds every note in its scale.
        from music21 import note as m21note, stream as m21stream

        s = m21stream.Stream()
        for name, ql in [("F4", 2), ("A4", 1), ("C5", 1), ("A4", 1), ("F4", 2), ("G4", 1),
                         ("B4", 0.5), ("C5", 2), ("A4", 1), ("F4", 2), ("C4", 1)]:
            s.append(m21note.Note(name, quarterLength=ql))
        key, _conf = transcriber._detect_key(s, 11)
        assert (key.tonic.pitchClass, key.mode) == (0, "major")

    def test_a_minor_tunes_raised_seventh_does_not_move_its_doh(self):
        s = _stream(["A3", "C4", "E4", "G#4", "A4", "B4", "C5", "B4", "G#4", "A4", "E4", "A3"])
        key, _conf = transcriber._detect_key(s, 12)
        assert transcriber._doh_of((key.tonic.pitchClass, key.mode)) == 0  # A minor / C major: doh is C

    def test_it_still_agrees_where_the_default_is_right(self):
        s = _stream(["A3", "B3", "C4", "D4", "E4", "F4", "G4", "A4"])
        key, _conf = transcriber._detect_key(s, 8)
        assert (key.tonic.pitchClass, key.mode) == (9, "minor")

    def test_confidence_is_between_zero_and_one(self):
        s = _stream(["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"])
        _key, conf = transcriber._detect_key(s, 8)
        assert 0.0 <= conf <= 1.0

    def test_it_falls_back_to_the_default_when_no_profile_can_vote(self, monkeypatch):
        # A missing or broken music21.analysis.discrete must lose the improvement, not
        # the transcription — the fallback is the pre-existing single-profile path.
        monkeypatch.setattr(transcriber, "_profile_z_scores", lambda profile, s: {})
        s = _stream(["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"])
        key, conf = transcriber._detect_key(s, 8)
        assert key is not None
        assert 0.0 <= conf <= 1.0

    def test_a_uniform_pitch_class_histogram_reaches_the_fallback_for_real(self):
        # Not a synthetic monkeypatch: a chromatic run gives every profile a zero
        # correlation spread, so all five genuinely decline and voted == 0.  This is the
        # only known real input that reaches the raw-coefficient branch, and it must
        # fail SAFE — confidence 0.0 so the mobile's editable-key prompt fires — rather
        # than emitting a confident arbitrary key.
        from music21.analysis import discrete

        chromatic = _stream(
            ["C4", "C#4", "D4", "E-4", "E4", "F4", "F#4", "G4", "A-4", "A4", "B-4", "B4"]
        )
        for name in transcriber.KEY_PROFILE_NAMES:
            assert transcriber._profile_z_scores(getattr(discrete, name)(), chromatic) == {}

        key, conf = transcriber._detect_key(chromatic, 12)
        assert key is not None  # a key is still reported; the score must be labellable
        assert conf == pytest.approx(0.0)  # and it is flagged as worthless

    def test_the_fallback_key_still_normalises_to_the_wire_convention(self):
        # music21 spells minor keys lowercase ("b minor"), which the C# KeyParser
        # rejects — the fallback path must not be the one that leaks it.
        chromatic = _stream(
            ["C4", "C#4", "D4", "E-4", "E4", "F4", "F#4", "G4", "A-4", "A4", "B-4", "B4"]
        )
        key, _conf = transcriber._detect_key(chromatic, 12)
        normalised = _normalise_key_name(str(key))
        assert "-" not in normalised
        assert normalised[0].isupper()

    def test_one_raising_profile_does_not_lose_the_vote(self, monkeypatch):
        real = transcriber._profile_z_scores
        calls = {"n": 0}

        def flaky(profile, s):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("this profile is broken")
            return real(profile, s)

        monkeypatch.setattr(transcriber, "_profile_z_scores", flaky)
        s = _stream(["C4", "E4", "G4", "C5", "F4", "A4", "G4", "C4"])
        key, _conf = transcriber._detect_key(s, 8)
        assert (key.tonic.pitchClass, key.mode) == (0, "major")

    def test_the_short_clip_cap_applies_on_the_ensemble_path_too(self):
        s = _stream(["C4", "E4", "G4"])
        _key, conf = transcriber._detect_key(s, MIN_NOTES_FOR_KEY - 1)
        assert conf <= KEY_CONFIDENCE_CAP_LOW


class TestCadenceTiebreak:
    """A histogram cannot see a cadence, and that blind spot is shared by all five profiles.

    The ensemble cancels disagreement *between* profiles; it cannot cancel something none of
    them measures.  ``plagal_fourth_c_major`` is the corpus case that proves it: a sustained
    4th carries 4 of its 12 beats, so every profile prefers F major on a clip that opens and
    closes on C and contains a B natural.  A wrong tonic re-labels every syllable in the
    clip, which is why that case scores ``solfa.degree_accuracy`` 0.000 on ``notes.f1`` 0.846.

    The rule is four conjoined restrictions rather than a tuned score, and this class pins
    each one — including the false positive it exists to prevent, which is the half cadence.
    """

    # The corpus case's own note list (corpus.py KEY_HEADROOM_CASES), (midi, beats).  The
    # defect reproduces on the bare symbolic stream, so none of this needs inference.
    PLAGAL = (
        (60, 0.5), (64, 0.5), (67, 1.0), (65, 2.0), (69, 1.0), (72, 1.0),
        (65, 2.0), (69, 1.0), (67, 1.0), (71, 0.5), (72, 2.0),
    )

    @staticmethod
    def _weighted(events):
        """A stream with real durations — the cue is duration-weighted, so they matter."""
        from music21 import note as m21note, stream as m21stream

        s = m21stream.Stream()
        for midi, quarter_length in events:
            n = m21note.Note(midi)
            n.duration.quarterLength = quarter_length
            s.append(n)
        return s

    def test_it_rescues_the_subdominant_trap_the_ensemble_alone_cannot(self, monkeypatch):
        s = self._weighted(self.PLAGAL)
        assert str(s.analyze("key")) == "F major"  # single profile, still wrong

        # The scale rule (_scale_parsimony) also rescues this clip, so it is switched off
        # here: with it and the tiebreak both disabled the ensemble is wrong, which is the
        # point — this asserts the *tiebreak* rescues the case on its own.
        monkeypatch.setattr(transcriber, "KEY_SCALE_TOLERANCE", 1.0)
        monkeypatch.setattr(transcriber, "_cadence_prefers_runner_up", lambda *a: False)
        without, _conf = transcriber._detect_key(s, len(self.PLAGAL))
        assert (without.tonic.pitchClass, without.mode) == (5, "major")

        monkeypatch.undo()
        monkeypatch.setattr(transcriber, "KEY_SCALE_TOLERANCE", 1.0)
        with_tiebreak, _conf = transcriber._detect_key(s, len(self.PLAGAL))
        assert (with_tiebreak.tonic.pitchClass, with_tiebreak.mode) == (0, "major")

        monkeypatch.undo()
        with_both, _conf = transcriber._detect_key(s, len(self.PLAGAL))
        assert (with_both.tonic.pitchClass, with_both.mode) == (0, "major")

    def test_a_swap_does_not_move_the_reported_confidence(self, monkeypatch):
        # The margin measures how close the two readings were, which is the right
        # uncertainty to report whichever one was picked — and it is the number the
        # mobile's editable-key prompt is calibrated against.
        s = self._weighted(self.PLAGAL)
        monkeypatch.setattr(transcriber, "_cadence_prefers_runner_up", lambda *a: False)
        _key, before = transcriber._detect_key(s, len(self.PLAGAL))
        monkeypatch.undo()
        _key, after = transcriber._detect_key(s, len(self.PLAGAL))

        assert after == pytest.approx(before)

    @pytest.mark.parametrize(
        "a,b,expected",
        [
            ((0, "major"), (5, "major"), True),   # C -> F, the subdominant slip
            ((0, "major"), (7, "major"), True),   # C -> G, the dominant slip
            ((9, "minor"), (2, "minor"), True),   # fifths hold in minor too
            ((0, "major"), (0, "minor"), True),   # parallel
            ((0, "major"), (9, "minor"), False),  # relative — solfa-neutral, so never
            ((9, "minor"), (0, "major"), False),  # relative, the other way round
            ((0, "major"), (2, "major"), False),  # unrelated
            ((0, "major"), (1, "major"), False),  # unrelated
        ],
    )
    def test_only_fifths_and_parallels_are_eligible(self, a, b, expected):
        assert transcriber._is_fifth_or_parallel(a, b) is expected

    def test_a_confident_vote_is_left_alone(self):
        # The rail, not the decision: above KEY_MARGIN_FULL the profiles have decided and
        # a structural cue does not get to overturn them.
        s = self._weighted(self.PLAGAL)
        assert transcriber._cadence_prefers_runner_up(
            s, (5, "major"), (0, "major"), KEY_MARGIN_FULL
        ) is False

    def test_a_half_cadence_does_not_become_a_modulation(self):
        # The false positive this is built to refuse.  A C-major phrase closing on G ends on
        # the *dominant's* tonic, so the cadence cue alone would read G major — but the F
        # natural is outside G major, so C stays strictly the more diatonic reading.
        s = self._weighted([(60, 1), (64, 1), (65, 1), (64, 1), (62, 1), (67, 2)])
        assert transcriber._cadence_prefers_runner_up(s, (0, "major"), (7, "major"), 0.2) is False

    def test_an_equally_diatonic_runner_up_is_not_enough(self):
        # Same shape with the 4th removed: nothing now distinguishes C major from G major on
        # scale membership, so the two tie and a tie declines.  This is why the comparison is
        # strictly greater rather than greater-or-equal.
        s = self._weighted([(60, 1), (64, 1), (62, 1), (64, 1), (67, 2)])
        weights = transcriber._tonal_cues(s)[1:]
        assert transcriber._diatonic_fraction(0, "major", *weights) == pytest.approx(
            transcriber._diatonic_fraction(7, "major", *weights)
        )
        assert transcriber._cadence_prefers_runner_up(s, (0, "major"), (7, "major"), 0.2) is False

    def test_it_declines_when_the_winner_also_ends_on_its_own_tonic(self):
        # A parallel pair shares a tonic, so "ends on the tonic" is true of both and says
        # nothing.  The asymmetry is the whole cue; without it there is no argument.
        s = self._weighted([(60, 1), (63, 1), (67, 1), (60, 2)])
        assert transcriber._cadence_prefers_runner_up(s, (0, "major"), (0, "minor"), 0.2) is False

    def test_a_stream_with_nothing_in_it_declines(self):
        from music21 import stream as m21stream

        assert transcriber._tonal_cues(m21stream.Stream()) is None
        assert transcriber._cadence_prefers_runner_up(
            m21stream.Stream(), (5, "major"), (0, "major"), 0.2
        ) is False

    def test_the_parsimony_cue_is_duration_weighted_not_note_counted(self):
        # One long out-of-scale note must cost more than one short one, because that is the
        # same weighting the profiles use and the cue has to argue on their terms.
        brief = self._weighted([(60, 4), (62, 4), (66, 0.5)])
        sustained = self._weighted([(60, 4), (62, 4), (66, 4)])

        assert transcriber._diatonic_fraction(
            0, "major", *transcriber._tonal_cues(brief)[1:]
        ) > transcriber._diatonic_fraction(0, "major", *transcriber._tonal_cues(sustained)[1:])

    def test_a_minor_candidate_is_not_penalised_for_its_own_raised_seventh(self):
        # A minor with a G#: harmonic minor is the same key, so scoring it against natural
        # minor alone would make the cue argue against the right answer on every
        # harmonic-minor clip in the corpus.
        s = self._weighted([(69, 1), (71, 1), (72, 1), (74, 1), (76, 1), (77, 1), (80, 1), (81, 1)])
        weights = transcriber._tonal_cues(s)[1:]

        assert transcriber._diatonic_fraction(9, "minor", *weights) == pytest.approx(1.0)


class TestExportMusicxml:
    """The MusicXML the clients engrave carries no music21 placeholders."""

    @staticmethod
    def _measured():
        from music21 import meter, note, stream

        s = stream.Stream()
        s.insert(0, meter.TimeSignature("4/4"))
        for i, name in enumerate(("C4", "D4", "E4", "F4", "G4")):
            s.insert(i, note.Note(name, quarterLength=1))
        return s.makeMeasures()

    def test_a_measured_stream_exports_as_one_named_part_with_blank_metadata(self):
        xml = transcriber.export_musicxml(self._measured())
        assert "<score-partwise" in xml and xml.count("<part ") == 1
        assert "<part-name>Melody</part-name>" in xml
        # The defaults OpenSheetMusicDisplay was printing at the top of every web sheet.
        assert "Music21" not in xml
        assert '<creator type="composer">Music21' not in xml
        assert xml.count("<note>") == 5

    def test_the_part_name_is_the_callers(self):
        xml = transcriber.export_musicxml(self._measured(), part_name="Tune")
        assert "<part-name>Tune</part-name>" in xml

    def test_the_callers_stream_is_left_usable(self, tmp_path):
        measured = self._measured()
        transcriber.export_musicxml(measured)
        # The pipeline writes the MIDI from the same stream after the MusicXML export.
        measured.write("midi", fp=str(tmp_path / "x.mid"))
        assert (tmp_path / "x.mid").stat().st_size > 0

