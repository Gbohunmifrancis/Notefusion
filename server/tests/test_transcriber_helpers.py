"""Tests for the transcriber helper functions added in the accuracy-improvement pass.

These helpers are pure functions with no ML dependencies — they run fast and
cover the post-processing logic that sits between Basic Pitch inference and the
music21 score assembly:

  _normalise_key_name     music21 flat/lowercase → standard C# KeyParser format
  _merge_onsets           fuse same-pitch fragments that are too close together
  _dedup_simultaneous     drop exact pitch+onset duplicates from polyphonic mode
  _adaptive_amplitude_floor  per-clip dynamic threshold from p75 of amplitudes

No audio files, no ML models, no heavy imports needed.
"""

import pytest
from app.pipeline.transcriber import (
    ADAPTIVE_FACTOR,
    MIN_AMPLITUDE_MELODY,
    MIN_AMPLITUDE_POLY,
    _adaptive_amplitude_floor,
    _dedup_simultaneous,
    _merge_onsets,
    _normalise_key_name,
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


class TestMergeOnsets:
    """Same-pitch fragments separated by a gap smaller than gap_sec are fused.

    Events are tuples of (start_sec, end_sec, pitch_midi, amplitude).
    """

    def test_two_same_pitch_notes_within_gap_are_merged(self):
        # gap = 0.15 - 0.10 = 0.05 < 0.08 → should merge
        events = [(0.0, 0.10, 60, 0.8), (0.15, 0.25, 60, 0.7)]
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 1
        start, end, pitch, amp = result[0]
        assert start == pytest.approx(0.0)
        assert end == pytest.approx(0.25)
        assert pitch == 60
        assert amp == pytest.approx(0.8)  # louder of the two

    def test_merged_event_takes_higher_amplitude(self):
        # Second event is louder
        events = [(0.0, 0.10, 60, 0.5), (0.14, 0.25, 60, 0.9)]
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 1
        assert result[0][3] == pytest.approx(0.9)

    def test_gap_exactly_at_threshold_is_not_merged(self):
        # The comparison is `gap < gap_sec`, so a gap equal to the threshold
        # must NOT merge. Testing that boundary needs values whose subtraction
        # is exact in binary floating point: 0.18 - 0.10 is 0.0799999...,
        # which slips under a 0.08 threshold and merges. 0.25/0.375/0.125 are
        # all powers-of-two fractions, so gap == gap_sec exactly.
        events = [(0.0, 0.25, 60, 0.8), (0.375, 0.475, 60, 0.7)]
        result = _merge_onsets(events, gap_sec=0.125)
        assert len(result) == 2

    def test_gap_larger_than_threshold_is_not_merged(self):
        events = [(0.0, 0.10, 60, 0.8), (0.25, 0.35, 60, 0.7)]
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 2

    def test_different_pitch_notes_are_never_merged(self):
        # Different pitch: always two separate events regardless of gap
        events = [(0.0, 0.10, 60, 0.8), (0.14, 0.24, 61, 0.7)]
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 2

    def test_three_adjacent_same_pitch_fragments_all_merge(self):
        # Chain: AB merge → then (AB)C merge in second pass
        events = [
            (0.0, 0.05, 60, 0.6),
            (0.08, 0.13, 60, 0.8),
            (0.16, 0.21, 60, 0.7),
        ]
        result = _merge_onsets(events, gap_sec=0.06)
        assert len(result) == 1
        assert result[0][0] == pytest.approx(0.0)
        assert result[0][1] == pytest.approx(0.21)
        assert result[0][3] == pytest.approx(0.8)  # peak amplitude

    def test_mixed_same_and_different_pitches(self):
        # 60-60 merge; 61 stays separate
        events = [
            (0.0, 0.10, 60, 0.8),
            (0.14, 0.24, 60, 0.7),
            (0.30, 0.40, 61, 0.9),
        ]
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 2
        assert result[0][2] == 60
        assert result[1][2] == 61

    def test_empty_input_returns_empty(self):
        assert _merge_onsets([], gap_sec=0.08) == []

    def test_single_event_returned_unchanged(self):
        events = [(0.0, 0.5, 60, 0.8)]
        result = _merge_onsets(events, gap_sec=0.08)
        assert result == events

    def test_overlapping_events_negative_gap_not_merged(self):
        # Overlapping events (gap < 0) should not be merged — only genuine gaps
        events = [(0.0, 0.20, 60, 0.8), (0.10, 0.30, 60, 0.7)]  # gap = -0.10
        result = _merge_onsets(events, gap_sec=0.08)
        assert len(result) == 2


# ── _dedup_simultaneous ───────────────────────────────────────────────────────


class TestDedupSimultaneous:
    """Exact pitch + onset duplicates from polyphonic harmonic energy are removed;
    the louder of the two is kept."""

    def test_identical_events_reduces_to_one(self):
        events = [
            (0.0, 0.5, 60, 0.8),
            (0.0, 0.5, 60, 0.6),  # same pitch, same onset → duplicate
        ]
        result = _dedup_simultaneous(events)
        assert len(result) == 1

    def test_louder_duplicate_is_kept(self):
        events = [
            (0.0, 0.5, 60, 0.5),
            (0.0, 0.5, 60, 0.9),  # louder
        ]
        result = _dedup_simultaneous(events)
        assert result[0][3] == pytest.approx(0.9)

    def test_different_pitches_at_same_onset_are_kept(self):
        events = [
            (0.0, 0.5, 60, 0.8),
            (0.0, 0.5, 64, 0.7),  # different pitch → not a duplicate
        ]
        result = _dedup_simultaneous(events)
        assert len(result) == 2

    def test_same_pitch_different_onset_are_kept(self):
        events = [
            (0.0, 0.5, 60, 0.8),
            (0.51, 0.9, 60, 0.7),  # different onset → not a duplicate
        ]
        result = _dedup_simultaneous(events)
        assert len(result) == 2

    def test_onset_tolerance_rounds_to_three_decimal_places(self):
        # Onsets that differ by less than 0.001 s are treated as simultaneous
        events = [
            (0.0000, 0.5, 60, 0.8),
            (0.0004, 0.5, 60, 0.6),  # rounded both → 0.000 → same key
        ]
        result = _dedup_simultaneous(events)
        assert len(result) == 1

    def test_no_duplicates_returned_unchanged(self):
        events = [
            (0.0, 0.5, 60, 0.8),
            (0.5, 1.0, 62, 0.7),
            (1.0, 1.5, 64, 0.9),
        ]
        result = _dedup_simultaneous(events)
        assert len(result) == 3

    def test_empty_list_returns_empty(self):
        assert _dedup_simultaneous([]) == []

    def test_single_event_returned_unchanged(self):
        events = [(0.0, 0.5, 60, 0.8)]
        assert _dedup_simultaneous(events) == events

    def test_chord_with_one_duplicate_deduped_correctly(self):
        # Three notes in a chord; one pitch appears twice
        events = [
            (0.0, 0.5, 60, 0.8),  # C
            (0.0, 0.5, 64, 0.7),  # E
            (0.0, 0.5, 67, 0.9),  # G
            (0.0, 0.5, 60, 0.5),  # C duplicate (quieter)
        ]
        result = _dedup_simultaneous(events)
        assert len(result) == 3
        pitches = [e[2] for e in result]
        assert sorted(pitches) == [60, 64, 67]


# ── _adaptive_amplitude_floor ─────────────────────────────────────────────────


class TestAdaptiveAmplitudeFloor:
    """The adaptive floor = max(base_constant, ADAPTIVE_FACTOR × p75(amps)).
    This prevents a fixed threshold from silencing quiet/distant recordings.
    """

    def test_quiet_clip_uses_base_floor(self):
        # All amplitudes very low → p75 * factor < base → base wins
        events = [(0, 1, 60, 0.01), (1, 2, 60, 0.02), (2, 3, 60, 0.01)]
        floor = _adaptive_amplitude_floor(events, base=MIN_AMPLITUDE_MELODY)
        assert floor == pytest.approx(MIN_AMPLITUDE_MELODY)

    def test_loud_clip_raises_floor_above_base(self):
        # All amplitudes near 1.0 → p75 * factor >> base → adaptive wins
        events = [(i, i + 1, 60, 0.95) for i in range(10)]
        floor = _adaptive_amplitude_floor(events, base=MIN_AMPLITUDE_MELODY)
        expected = ADAPTIVE_FACTOR * 0.95
        assert floor == pytest.approx(expected, abs=0.01)
        assert floor > MIN_AMPLITUDE_MELODY

    def test_empty_events_returns_base(self):
        floor = _adaptive_amplitude_floor([], base=MIN_AMPLITUDE_POLY)
        assert floor == pytest.approx(MIN_AMPLITUDE_POLY)

    def test_single_event_uses_its_amplitude_or_base(self):
        # One event at 0.1 → p75 = 0.1; ADAPTIVE_FACTOR * 0.1 vs base
        events = [(0.0, 0.5, 60, 0.10)]
        floor = _adaptive_amplitude_floor(events, base=MIN_AMPLITUDE_MELODY)
        adaptive = ADAPTIVE_FACTOR * 0.10
        assert floor == pytest.approx(max(MIN_AMPLITUDE_MELODY, adaptive))

    def test_floor_is_never_below_base(self):
        # Even with zero-amplitude events, floor must stay at base
        events = [(i, i + 1, 60, 0.0) for i in range(5)]
        floor = _adaptive_amplitude_floor(events, base=0.30)
        assert floor >= 0.30

    def test_mixed_amplitude_uses_75th_percentile(self):
        import numpy as np

        # Known amplitudes; we know their p75
        amps = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
        events = [(float(i), float(i + 1), 60, a) for i, a in enumerate(amps)]
        p75 = float(np.percentile(amps, 75))
        expected_floor = max(MIN_AMPLITUDE_MELODY, ADAPTIVE_FACTOR * p75)
        result = _adaptive_amplitude_floor(events, base=MIN_AMPLITUDE_MELODY)
        assert result == pytest.approx(expected_floor, abs=1e-6)
