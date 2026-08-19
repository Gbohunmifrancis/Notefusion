"""Tests for the transcriber helper functions added in the accuracy-improvement pass.

These helpers are pure functions with no ML dependencies — they run fast and
cover the post-processing logic that sits between Basic Pitch inference and the
music21 score assembly:

  _normalise_key_name     music21 flat/lowercase → standard C# KeyParser format
  _merge_onsets           fuse same-pitch fragments that are too close together
  _dedup_simultaneous     drop exact pitch+onset duplicates from polyphonic mode
  _adaptive_amplitude_floor  per-clip dynamic threshold from p75 of amplitudes
  _refine_pitches         correct octave errors against a pyin f0 contour
  _pyin_contour           the contour itself, and every way it can decline to produce one
  _estimate_tempo_and_beats  a tap-in override wins the BPM but still recovers phase
  _profile_z_scores       one key profile's standardised opinion of all 24 keys
  _key_from_identity      (pitch class, mode) back to a music21 Key
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
    KEY_CONFIDENCE_CAP_LOW,
    KEY_MARGIN_FULL,
    MIN_AMPLITUDE_MELODY,
    MIN_AMPLITUDE_POLY,
    MIN_NOTES_FOR_KEY,
    Event,
    _adaptive_amplitude_floor,
    _beat_origin,
    _dedup_simultaneous,
    _key_confidence_from_margin,
    _key_from_identity,
    _merge_onsets,
    _normalise_key_name,
    _onset_bpm,
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

    Events are ``Event(start_sec, end_sec, pitch_midi, amplitude)`` — the four values
    Basic Pitch reports, which is all this logic reads.
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

        def fake_inner(wav_path, mode, key_override, tempo_override, progress):
            seen["path"] = wav_path
            seen["exists"] = wav_path.exists()
            return "result"

        monkeypatch.setattr(transcriber, "_ensure_wav_path", lambda path: (converted, True))
        monkeypatch.setattr(transcriber, "_transcribe_wav", fake_inner)

        assert transcriber.transcribe(tmp_path / "upload.m4a") == "result"
        assert seen["path"] == converted  # the pipeline is handed the decoded file
        assert seen["exists"] is True  # ...and it is still readable
        assert not converted.exists()  # deleted exactly once, by transcribe()

    def test_converted_wav_is_deleted_even_when_the_pipeline_raises(self, monkeypatch, tmp_path):
        converted = tmp_path / "converted.wav"
        converted.write_bytes(b"placeholder")

        def boom(*args):
            raise transcriber.LowConfidenceError("no notes")

        monkeypatch.setattr(transcriber, "_ensure_wav_path", lambda path: (converted, True))
        monkeypatch.setattr(transcriber, "_transcribe_wav", boom)

        with pytest.raises(transcriber.LowConfidenceError):
            transcriber.transcribe(tmp_path / "upload.m4a")
        assert not converted.exists()

    def test_a_wav_upload_is_never_deleted_here(self, monkeypatch, tmp_path):
        # _ensure_wav_path hands a .wav straight back, so the caller still owns it —
        # JobQueue._run unlinks the upload for privacy (TRD par. 9).
        upload = tmp_path / "upload.wav"
        upload.write_bytes(b"placeholder")

        monkeypatch.setattr(transcriber, "_ensure_wav_path", lambda path: (upload, False))
        monkeypatch.setattr(transcriber, "_transcribe_wav", lambda *args: "result")

        assert transcriber.transcribe(upload) == "result"
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
    """Only whole-octave disagreements with pyin are acted on.

    Basic Pitch locks onto the second harmonic often enough to matter (measured: 9 of
    15 events on the clean control case were a whole octave high), but a fragment
    shorter than one vibrato cycle has a median biased toward wherever in the cycle it
    sits — so pyin is *not* trustworthy to the semitone here.  A sub-semitone bias
    cannot manufacture or hide a twelve-semitone gap, which is what makes the octave
    decision safe where a general "believe pyin" would not be.  These tests pin that
    boundary from both sides.
    """

    def _refine(self, monkeypatch, events, contour):
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


# ── _pyin_contour (defect 6) ──────────────────────────────────────────────────


class TestPyinContour:
    """Every failure path must degrade to "no refinement", never raise.

    pyin is the most expensive thing in the pipeline (~0.22x realtime) and runs on a
    single-worker queue, so the length budget is a latency guarantee rather than a
    nicety — and a tracker that throws on an odd clip must not fail the whole job.
    """

    def _patch_librosa(self, monkeypatch, load=None, pyin=None):
        import librosa

        if load is not None:
            monkeypatch.setattr(librosa, "load", load)
        if pyin is not None:
            monkeypatch.setattr(librosa, "pyin", pyin)

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
