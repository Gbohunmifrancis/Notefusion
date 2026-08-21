"""Service configuration from environment variables (12-factor, Docker-friendly)."""

import os
from dataclasses import dataclass


class Settings:
    # PRD F-01: clips are 10 s - 3 min; enforced server-side as defence in depth
    max_clip_seconds: float = float(os.getenv("NF_MAX_CLIP_SECONDS", "180"))
    # Compressed uploads are ~1 MB/30 s; 20 MB allows a 3-min WAV during the beta
    max_upload_bytes: int = int(os.getenv("NF_MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))
    # Completed/failed jobs are purged after this (results only - audio is deleted
    # immediately after processing, TRD par. 9)
    job_ttl_seconds: float = float(os.getenv("NF_JOB_TTL_SECONDS", "900"))
    # Single worker: CPU inference on one VPS; a queue prevents overload (TRD par. 3.3)
    inference_workers: int = int(os.getenv("NF_INFERENCE_WORKERS", "1"))

    # ── Transcription accuracy flags ──────────────────────────────────────────
    # These exist to isolate one measured effect at a time in tests/accuracy, and
    # to allow a rollback without a redeploy.  They are properties, not class
    # attributes, because the harness A/Bs them inside a single process — reading
    # os.environ at import time would freeze whichever value happened to be set
    # first.  Collapse them to constants once the numbers are settled.

    @property
    def beat_align(self) -> bool:
        """Measure note offsets from a detected beat instead of file t=0."""
        return os.getenv("NF_BEAT_ALIGN", "1").strip().lower() not in ("0", "false", "no")

    @property
    def pyin_refine(self) -> bool:
        """Re-check each detected note's octave against a librosa pyin f0 contour."""
        return os.getenv("NF_PYIN_REFINE", "1").strip().lower() not in ("0", "false", "no")

    @property
    def pyin_max_seconds(self) -> float:
        """Longest clip that gets pyin refinement; longer ones keep Basic Pitch's pitches.

        pyin is the most expensive thing in the pipeline: measured on the pinned
        librosa 0.11.0, 2.4 s for a 10 s clip and 13.0 s for a 60 s clip — about
        0.22x realtime.  Inference runs on a single worker (``inference_workers``),
        so an unguarded 180 s clip (``max_clip_seconds``) would add ~39 s to the
        queue latency of every job behind it.  60 s covers the great majority of
        hummed phrases at a bounded worst case.
        """
        return float(os.getenv("NF_PYIN_MAX_SECONDS", "60"))

    @property
    def pyin_semitone(self) -> bool:
        """Trust pyin's pitch outright, not only when it disagrees by a whole octave.

        ``_refine_pitches`` corrected octaves only, and its docstring gave the reason: a
        fragment shorter than one vibrato cycle has a median biased toward wherever in the
        cycle it sits, so per fragment pyin looked unreliable to the semitone.  Measured,
        that objection does not hold.  Over the eight vibrato/drift cases, 577 events,
        ``round(pyin median)`` over each event's own span is right 73.4% of the time against
        the octave-corrected pipeline's 18.7% — 278 fixes against 17 breaks — and on the four
        guard cases (``major_c``, ``minor_harmonic_a``, ``semitone_steps_c_major``,
        ``vibrato_depth_0_8``, already 99/100 correct) it makes **zero** changes in either
        direction, including on the genuine mi-fa and ti-doh steps that a semitone rule most
        endangers.

        This is what fixes the ghost accidentals at their source.  They are a *pitch* error,
        not a merge failure: within one reference note the estimate produces a run at one
        wrong pitch (a reference 69 comes back as 70,70,70,70,72), the wobble parking on the
        semitone neighbour, and the printed accidental follows from the pitch.  See
        ``f0_merge`` for the two stages of merge-side attack that could not reach it.

        Measured over the whole corpus, this is the largest single gain in the pipeline so
        far: solfa.degree_accuracy 0.831 -> 0.917, solfa.syllable_accuracy 0.828 -> 0.912,
        solfa.chromatic_ghosts 3.579 -> 1.868 and notes.semitone_neighbour_ghosts 4.289 ->
        2.105 (both roughly halved), notes.f1 0.790 -> 0.832 on recall 0.840 -> 0.935,
        solfa.octave_error_rate 0.026 -> 0.008, and key.exact 0.763 -> 0.868 because four
        vibrato cases were only reading F#/E/C#/E-minor on the strength of ghost pitch
        classes that are now gone.  Nine of the eighteen cases the report lists improve and
        none regresses.

        Three things move the wrong way and none of them is this rule misbehaving.
        tempo.abs_error 23.237 -> 24.000 is entirely ``vibrato_rate_k20``, whose estimate
        goes from a nonsense 369 BPM to a nonsense 398 against a true 96 — broken before and
        after, and 29 BPM over 38 cases is the whole aggregate delta.  notes.f1_with_offset
        loses 0.002.  conf.separation 0.343 -> 0.332 and key.confidence_auc 0.973 -> 0.958
        are dilution: with far more notes correct and only five keys still wrong, both
        statistics are computed over a smaller, noisier wrong-pool — conf.auc itself rises
        0.856 -> 0.868 and key.confidence_separation rises 0.162 -> 0.297.

        A commit-distance filter — requiring the median to sit near a whole number, on the
        theory that a mid-slope median is the untrustworthy one — was swept over 0.20-0.50
        against a voiced-probability floor of 0.0-0.50 and costs more fixes than it saves
        breaks at every setting, so it is not here.  No setting in that sweep broke a guard.
        The floor stays at ``PYIN_MIN_VOICED_PROB`` rather than dropping to 0.0, which would
        have measured 71 more fixes for 5 fewer breaks: that is synthetic vibrato agreeing
        with itself, and not a reason to trust pyin where pyin reports it is unsure.
        """
        return os.getenv("NF_PYIN_SEMITONE", "1").strip().lower() not in ("0", "false", "no")

    @property
    def key_ensemble(self) -> bool:
        """Vote over five music21 key profiles instead of music21's default one.

        ``Stream.analyze("key")`` is AardenEssen, whose documented weakness is a
        tendency to call the subdominant the tonic — reproduced exactly on a plain
        C-major stream, which it reads as F major.  A wrong tonic re-labels every
        solfa syllable, so this is the highest-leverage correctness flag here.
        """
        return os.getenv("NF_KEY_ENSEMBLE", "1").strip().lower() not in ("0", "false", "no")

    @property
    def tempo_grid(self) -> bool:
        """Pick the tempo that puts the detected onsets on the quantizer's grid.

        librosa's ``beat_track`` carries a log-normal prior centred on 120 BPM, and on
        a single hummed line it wins over the evidence: measured on the corpus, a clip
        of even quarter notes at a true 96 BPM comes back as 117 — librosa's default
        tempogram bin — in 12 of 38 cases.

        A tempo that is *metrically* wrong is harmless, because the pipeline is
        self-consistent under it: ``sec_to_beats`` and the preview's ``beat_sec`` are
        reciprocals of the same number, so calling those quarters "eighths at 176" plays
        back at exactly the right speed.  117-against-96 is the damaging kind, because
        the beat period is then incommensurate with the notes: a true quarter measures
        1.219 beats and the eighth grid snaps it alternately to 1.0 and 1.5, so a run of
        equal notes is engraved — and heard — as an uneven lurch.  That is the
        "not following the recorded time signature" defect, and it is a tempo bug rather
        than a synthesis or grid bug.

        Measured over the corpus: tempo.abs_error 51.105 -> 23.237, tempo.rel_error
        0.566 -> 0.252, tempo.octave_error 0.316 -> 0.000, and notes.f1_with_offset
        0.675 -> 0.709 because notes land where they belong once the beat divides them.
        Ten cases improve on offset accuracy and one loses 0.074 —
        triplets_eighth_c_major, where Basic Pitch under-detects the phrase's final long
        note by ~0.35 s and the wrong tempo's coarser grid had been rounding that
        shortfall back up.  Off is still a valid setting; the two answers differ on 20 of
        38 cases, so it is worth an A/B on real recordings before the flag is collapsed
        to a constant.
        """
        return os.getenv("NF_TEMPO_GRID", "1").strip().lower() not in ("0", "false", "no")

    @property
    def f0_merge(self) -> bool:
        """Read Basic Pitch's pitch bends, so onset merging can compare f0 not pitch.

        **Off by default: measured, and it does not pay.**  Kept behind a flag rather than
        deleted because the measurement was expensive and the next attempt should start
        from it instead of rediscovering it.

        The premise is sound.  Vibrato that crosses a semitone boundary comes back as a run
        of alternating fragments — Basic Pitch fires at both neighbours of the wobble — and
        the merge's exact-pitch test cannot fuse them, so one sung note is engraved as a
        stream of ghost syllables, half of them carrying an accidental.  98.5% of the
        accidentals the notation prints are not in the music, and all of them come from the
        eight vibrato/drift cases.  The bends are already in the inference output and were
        being discarded; reading them separates what the rounded pitch conflates, with
        consecutive fragments of one note a median 0.395 semitones apart in f0 against
        2.074 for genuine steps.

        What it actually bought, on: solfa.chromatic_ghosts 3.579 -> 3.553 — one accidental
        across 38 cases — while solfa.ghost_count went 5.737 -> 5.842, past the harness's
        0.02 tolerance, and notes.n_est rose by the same 0.105.  Four cases move at all:
        drift_1_semitone -1 accidental, vibrato_rate_k15 unchanged, and then
        vibrato_heavy +2 ghosts and vibrato_rate_k155 f1 -0.073 with +3 ghosts.  Both
        losers sit outside the nine cases ``F0_MERGE_SEMITONES`` was calibrated on, so the
        tolerance is fitted, not general.

        The reason is structural, and it is the useful part of the result: the merge stage
        cannot reach the fragments.  51 of 128 f0-agreeing adjacent pairs *overlap* in time
        at merge time rather than abutting, so ``_merge_onsets``' ``0.0 <= gap`` test never
        sees them.  An earlier draft of this docstring concluded that the fix was therefore
        an overlap-tolerant merge, or moving the f0 evidence to the melody overlap resolver
        where these events are resolved today.  **Both were measured and neither would have
        worked**: of the 56 f0-agreeing *overlapping* pairs, none is a semitone apart, so at
        that stage "f0 agrees" already collapses to "pitch is identical".  The defect is not
        a fragment pair — it is a run at one wrong pitch inside a single sung note — and
        ``pyin_semitone`` fixes it upstream, where the pitch is decided.

        Off restores the previous behaviour exactly rather than approximately, because with
        no bend data an Event's f0 *is* its pitch and the tolerance test collapses to
        equality.  Turning it on is still worth an A/B on real recordings before anyone
        writes the idea off entirely: synthetic vibrato is a clean sinusoid and human
        vibrato is not, and this corpus is 38 synthetic cases.
        """
        return os.getenv("NF_F0_MERGE", "0").strip().lower() not in ("0", "false", "no")

    @property
    def quantize_divisors(self) -> tuple[int, ...]:
        """music21 quantize grid, as divisions per quarter note.

        The default 2 is eighths.  A finer grid is the intuitive choice and was tried
        as the default; the corpus says no, twice over.

        "4" (sixteenths) makes the 0.25 duration floor in the pipeline exactly one
        grid step rather than contradicting a coarser grid, which is why it was tried.
        It buys aggregate notes.f1 +0.007 — one case (semitone_steps_c_major) recovers
        two reference notes, recall 0.833 -> 1.000.  It costs solfa.degree_accuracy
        -0.032, key.exact -0.032 and key.confidence_auc -0.062, because quantizing to
        a finer grid changes note *durations*, and music21's key profiles correlate a
        duration-weighted pitch-class histogram: drift_1_semitone flips C major ->
        F minor on sixteenths and takes every solfa syllable in the clip with it.
        Degree accuracy is the headline metric, so eighths win.

        "4,3" adds eighth-triplets and is likewise not the default: it was never
        better than "4" alone (notes.f1 0.821 against 0.823) and the triplet case it
        was added for did not move at all, because that case's tempo is misread as
        117 BPM against a true 96 — no triplet grid can align under a wrong beat
        period.  (That case reaches degree 1.000 anyway, from beat-phase alignment
        rather than from any grid change.)

        Both were retested once ``tempo_grid`` fixed that, and both are still worse.
        The finer grid now does what it was supposed to — "4,3" finds the triplet
        case's true 96 BPM, exactly as predicted — but it costs
        solfa.degree_accuracy -0.011 either way, and "4" alone triples
        tempo.octave_error (+0.316) because a denser grid fits more candidates, so
        the tempo chooser starts accepting odd metrical levels: it reads that same
        triplet case as sixteenths at 72 BPM, which is self-consistent and lands
        every onset exactly, and is not what anyone would tap.  Eighths win a third
        time.  The remaining triplet defect is not a grid problem at all — Basic
        Pitch under-detects the phrase's final long note by ~0.35 s, and the coarse
        grid was rounding that shortfall back up.

        Unparseable entries are dropped rather than raising, so a typo in a deploy
        cannot fail every transcription.
        """
        raw = os.getenv("NF_QUANTIZE_DIVISORS", "")
        parsed = tuple(int(p) for p in raw.split(",") if p.strip().isdigit() and int(p) > 0)
        return parsed or (2,)


settings = Settings()
