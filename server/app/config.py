"""Service configuration from environment variables (12-factor, Docker-friendly)."""

import os
from dataclasses import dataclass


class Settings:
    # PRD F-01: clips are 10 s - 3 min; enforced server-side as defence in depth
    max_clip_seconds: float = float(os.getenv("NF_MAX_CLIP_SECONDS", "180"))
    # Compressed uploads are ~1 MB/30 s; 20 MB allows a 3-min WAV during the beta
    # 25 MB, the same ceiling the C# API enforces (TranscriptionsController.MaxAudioBytes). It
    # was 20 MB here, so a 22 MB file passed the API, spent a minute uploading, and was then
    # refused by the worker — the slowest possible way to say no.
    max_upload_bytes: int = int(os.getenv("NF_MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
    # Completed/failed jobs are purged after this (results only - audio is deleted
    # immediately after processing, TRD par. 9)
    job_ttl_seconds: float = float(os.getenv("NF_JOB_TTL_SECONDS", "900"))
    # Single worker: CPU inference on one VPS; a queue prevents overload (TRD par. 3.3)
    inference_workers: int = int(os.getenv("NF_INFERENCE_WORKERS", "1"))
    #: Workers that take high-priority (Pro) jobs only, on top of the general ones above.
    #: See the module docstring of ``app.jobs.queue`` for why the lane needs its own thread.
    pro_lane_workers: int = int(os.getenv("NF_PRO_LANE_WORKERS", "1"))
    #: Run a throwaway clip through the pipeline at startup so numba's JIT cost is paid
    #: before the first user's job (see ``app.main._warmup_pipeline``). Off in tests.
    pipeline_warmup: bool = os.getenv("NF_PIPELINE_WARMUP", "1").strip().lower() not in ("0", "false", "no")
    # Linked songs (YouTube etc.): the most audio a link job will transcribe.  The API
    # passes a per-plan cap below this (a short free preview, six minutes for Pro).
    link_max_seconds: float = float(os.getenv("NF_LINK_MAX_SECONDS", "360"))
    #: A linked video longer than this is refused the moment the link is looked at: a ten-hour
    #: loop is not a song, and the section picker is unusable on one. 0 disables the cap.
    link_max_video_seconds: float = float(os.getenv("NF_LINK_MAX_VIDEO_SECONDS", "7200"))
    #: The YouTube player client(s) an extraction is tried again with when YouTube refuses the
    #: first attempt ("Sign in to confirm you're not a bot"); yt-dlp tries each in turn within
    #: that one call. mweb is the PO Token Guide's recommended client (its tokens come from the
    #: bgutil sidecar); android_vr and web_embedded need no token. (tv_embedded, the old
    #: default, is gone from yt-dlp, which skips a client it no longer knows.) Empty: no retry.
    ytdlp_fallback_clients: str = os.getenv("NF_YTDLP_FALLBACK_CLIENTS", "mweb,android_vr,web_embedded").strip()
    #: The bgutil proof-of-origin token server (the ``bgutil-provider`` sidecar in production),
    #: which the bgutil yt-dlp plugin in the image asks for the tokens YouTube wants from
    #: datacenter addresses. Empty: no tokens (yt-dlp then gets fewer formats, or a refusal).
    ytdlp_pot_url: str = os.getenv("NF_YTDLP_POT_URL", "").strip()
    #: A proxy (``http://user:pass@host:port``, ``socks5://…``) for YouTube alone: yt-dlp is
    #: sent through it only after YouTube refused this server directly and with the fallback
    #: clients. A residential or ISP address is what gets past a datacenter block. Empty: off.
    ytdlp_proxy: str = os.getenv("NF_YTDLP_PROXY", "").strip()
    #: Where the worker keeps the yt-dlp it updates itself to (``app.ingest.ytdlp_update``).
    #: Empty (the default, and tests): the yt-dlp the image was built with, never updated.
    ytdlp_update_dir: str = os.getenv("NF_YTDLP_UPDATE_DIR", "").strip()
    #: "nightly" (yt-dlp's README recommends it for regular users; YouTube fixes land there
    #: first) or "stable".
    ytdlp_update_channel: str = os.getenv("NF_YTDLP_UPDATE_CHANNEL", "nightly").strip().lower()
    #: Hours between update checks after the one at startup; 0 checks only at startup.
    ytdlp_update_hours: float = float(os.getenv("NF_YTDLP_UPDATE_HOURS", "24"))
    #: Where the job journal lives (``app.jobs.journal``): every submitted job is written there
    #: and replayed after a restart, so a deploy or an out-of-memory kill loses nothing. Empty
    #: (the default, and tests) keeps jobs in memory only.
    job_dir: str = os.getenv("NF_JOB_DIR", "").strip()
    #: How many times a journaled job may be started before it is failed rather than replayed:
    #: a job that kills the worker twice would otherwise kill it forever.
    job_max_attempts: int = int(os.getenv("NF_JOB_MAX_ATTEMPTS", "2"))
    #: Jobs that may wait for a worker at once; a submit beyond this is a 503 with Retry-After.
    #: One worker gets through a few jobs a minute, so fifty waiting is already a long line.
    max_pending_jobs: int = int(os.getenv("NF_MAX_PENDING_JOBS", "50"))
    #: Finished results hold their audio (the piano preview WAV, a song's backing MP3) as base64
    #: in memory until the TTL. Past this many megabytes of it, the oldest results the API has
    #: already been told about (and banked) lose those two fields; the notes and scores stay.
    result_audio_budget_mb: float = float(os.getenv("NF_RESULT_AUDIO_BUDGET_MB", "256"))
    #: "Hum to find a hymn" (``POST /v1/identify``): the most of a hummed clip that is read.
    identify_max_seconds: float = float(os.getenv("NF_IDENTIFY_MAX_SECONDS", "20"))
    #: Hymn look-ups decoded at once (about a second of one core each for a 15 s hum, in the
    #: threadpool, beside the job queue's workers); the rest wait ``identify_wait_seconds`` for
    #: a slot and are then turned away with a 503, so a crowd of them cannot starve a transcription.
    identify_concurrency: int = max(1, int(os.getenv("NF_IDENTIFY_CONCURRENCY", "2")))
    identify_wait_seconds: float = float(os.getenv("NF_IDENTIFY_WAIT_SECONDS", "8"))

    @property
    def audio_limit_seconds(self) -> float:
        """The most audio any job decodes: the longer of an upload's and a linked song's cap, and
        a second for rounding.  The route and the link fetch already cut to their caps; every
        decode of user audio is bounded by this as well, so a file that slipped past them (a
        stream with no length in its header) can never be read whole into memory."""
        return max(self.max_clip_seconds, self.link_max_seconds) + 1.0

    @property
    def api_key(self) -> str | None:
        """Shared secret key required to access transcription endpoints. None only with
        ``allow_no_auth``: the app refuses to start without one otherwise (``app.main``)."""
        key = os.getenv("NF_API_KEY", "").strip()
        return key if key else None

    @property
    def allow_no_auth(self) -> bool:
        """``NF_ALLOW_NO_AUTH=1`` lets the worker run with no API key (local runs, tests). An
        empty key used to switch auth off silently; now it has to be asked for by name."""
        return os.getenv("NF_ALLOW_NO_AUTH", "").strip().lower() in ("1", "true", "yes")

    @property
    def enable_docs(self) -> bool:
        """``NF_ENABLE_DOCS=1`` serves /docs, /redoc and /openapi.json; off by default, since
        nothing but the C# API should be learning this service's shape."""
        return os.getenv("NF_ENABLE_DOCS", "").strip().lower() in ("1", "true", "yes")

    @property
    def callback_hosts(self) -> frozenset[str]:
        """The hosts a completion webhook may be POSTed to (``NF_CALLBACK_HOSTS``, comma separated):
        the API's compose name and loopback. A callback_url anywhere else is ignored."""
        raw = os.getenv("NF_CALLBACK_HOSTS", "api,localhost,127.0.0.1")
        return frozenset(h.strip().lower() for h in raw.split(",") if h.strip())

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

        **Now equal to ``max_clip_seconds``, so nothing the API accepts is skipped.**  This
        was 60 s, and the paragraphs below are kept because they are the measurement that
        justified paying to raise it — not history for its own sake.

        pyin is the most expensive thing in the pipeline and it runs on a single worker
        (``inference_workers``), so this cap was a latency guarantee: on the pinned librosa
        0.11.0 at librosa's default grid, 0.40-0.54x realtime depending on hardware and how
        much the clip wobbles, which made an unguarded 180 s clip ~72-97 s of pyin added to the
        queue latency of every job behind it.  60 s covered the great majority of hummed
        phrases at a bounded worst case.  ``pyin_resolution`` is what changed the arithmetic:
        at 0.23x realtime a full 180 s clip costs ~41 s, against ~32 s for a 60 s clip before,
        so the whole accepted range now fits in the budget that used to buy 60 s.

        **What crossing the old cap cost.**  Above it ``_pyin_track`` returns empty arrays, so
        ``pyin_refine`` AND ``pyin_semitone`` both go dark — and per ``pyin_semitone``'s own
        docstring that stage "is what fixes the ghost accidentals at their source".  Measured
        by forcing the skip on all 38 cases (``NF_PYIN_MAX_SECONDS=1``):

            solfa.chromatic_ghosts            1.526 -> 3.526   (+131%)
            notes.semitone_neighbour_ghosts   1.632 -> 4.237   (+160%)
            solfa.degree_accuracy             0.940 -> 0.827
            key.exact                         0.895 -> 0.789
            notes.f1                          0.882 -> 0.789   (recall 0.911 -> 0.812)

        Sixteen gated metrics failed; that is roughly the pre-``pyin_semitone`` pipeline.  So
        the cap was never a graceful degradation in coverage, it was a cliff — and the best
        available explanation for a spurious-accidental report arriving from real recordings
        while the corpus looked clean.

        **What lifting it bought, on the 39-case harness** (``long_clip_over_pyin_cap`` is
        67.8 s and was the only case above the old cap; the numbers are corpus-wide against
        the 60 s / 0.1-grid baseline):

            solfa.chromatic_ghosts            3.846 -> 2.846   (-26%)
            notes.semitone_neighbour_ghosts   5.256 -> 3.051   (-42%)
            solfa.ghost_count                 6.179 -> 4.821
            solfa.degree_accuracy             0.934 -> 0.944
            solfa.syllable_accuracy           0.923 -> 0.933
            notes.f1                          0.866 -> 0.875   (recall 0.898 -> 0.913)
            tempo.abs_error                  17.359 -> 15.641
            key.confidence_auc                0.929 -> 0.964

        and on the long case itself, ``notes.f1`` 0.240 -> 0.596, ``solfa.degree_accuracy``
        0.707 -> 0.988, estimated notes 226 -> 166 against 99 real.  The over-segmentation is
        the mechanism: refinement collapses semitone-adjacent fragments, which is why the ghost
        columns move furthest.

        One case regressed and it is a real cost, not a rounding artefact:
        ``vibrato_rate_k15`` read C major and now reads F minor, taking its
        ``solfa.degree_accuracy`` to 0.000.  ``vibrato_heavy`` and ``vibrato_rate_k155`` moved
        the other way over the same change, so ``key.exact`` is unmoved at 0.897 — the four
        hard vibrato cases trade places whenever the pitch evidence shifts, because their key
        decision is marginal.  Tuning the pyin grid to protect one of them would be fitting to
        the corpus; the fix is a real tiebreak on the key ensemble (ends-on-doh and diatonic
        parsimony), which is tracked separately.

        ``pitch_refined`` on the wire still reports the skip, because the other two causes —
        a failed decode and a clip with no voiced frame — remain reachable.
        """
        return float(os.getenv("NF_PYIN_MAX_SECONDS", "180"))

    @property
    def pyin_resolution(self) -> float:
        """pyin's Viterbi grid, in semitones.  Coarser than librosa's default on purpose.

        This is what pays for ``pyin_max_seconds``, so the two are one decision and neither
        docstring is readable without the other.

        librosa defaults ``resolution`` to 0.1 semitones, which over
        ``PYIN_FMIN_HZ``..``PYIN_FMAX_HZ`` is **481 candidate bins** per frame, and the Viterbi
        transition matrix is quadratic in that count.  ``_refine_pitches`` then takes a median
        over each event's frames and, on the ``pyin_semitone`` path, **rounds it to the nearest
        integer MIDI number**.  Precision finer than a semitone was being computed and thrown
        away, and the throwing away is not incidental — it is what the stage is for.

        Cost measured on 20 s of ``long_clip_over_pyin_cap`` (5.5 Hz / 1.2 semitone vibrato,
        the hardest thing in the corpus for an f0 tracker); agreement judged on the rounded
        per-event median over ``vibrato_heavy``'s 64 real inference events:

            resolution   bins   x realtime   speedup   medians identical   max frame drift
              0.1 (lib)   481       0.54       1.00x    reference           --
              0.2         240       0.23       2.39x    --                  0.10 semitone
              0.25        192       0.20       2.67x    63/64  (98.4%)      0.15 semitone
              0.5          96       0.05      10.36x    55/64  (85.9%)      0.20 semitone

        **0.2 is chosen, and not the cheapest setting that looked lossless.**  0.25 was, on
        the agreement column, and the 39-case harness overruled it: both were run end to end
        at a 180 s cap and 0.2 won on nearly every gated metric — ``notes.f1`` 0.875 against
        0.872, ``solfa.degree_accuracy`` 0.944 against 0.938, ``key.confidence_auc`` 0.964
        against 0.921, and the long case's own ``notes.f1`` 0.596 against 0.413.  0.25 also
        tipped ``vibrato_rate_k15`` into reading F major, failing the ``key.fifth_confusion``
        gate outright.  Frame-level agreement is a proxy; the harness is the measurement.

        0.5 is 10x cheaper and refused: 85.9% would move roughly one note in seven.  It also
        scored *worse* than 1.0 on the same test (85.9% against 90.6%), which is the warning
        that coarse grids do not degrade smoothly — they move the Viterbi path rather than
        merely blunting it.  Read the whole column as "close to the default is safe, far from
        it is unpredictable", not as a curve to optimise along.

        The payoff is the cap: at 0.23x realtime a full 180 s ``max_clip_seconds`` clip costs
        ~41 s of pyin, against ~32 s for a 60 s clip on the old grid.  The entire accepted
        duration range now fits inside a latency budget that used to buy 60 s, so the cliff
        ``pyin_max_seconds`` used to document is gone rather than moved.

        Span-*targeted* refinement was the plan this replaced.  It was measured first and
        abandoned: the union of spans a targeting rule would have to refine (padded ±0.10 s,
        "suspect" = shorter than 0.20 s or semitone-adjacent to a temporal neighbour, which is
        the wobble-fuse signal) covers **97.0%** of ``vibrato_heavy`` and **99.2%** of
        ``long_clip_over_pyin_cap``.  A wobbling clip fragments into semitone-adjacent events
        across its whole timeline — 530 events for 99 reference notes — so the targeting signal
        is not sparse on precisely the clips that need refining.  Targeting would have saved
        ~1% there while saving half on clean short clips already under the cap.  Making the
        *frame* cheaper works because the waste is uniform; making the *span* smaller does not,
        because the suspicion is uniform too.
        """
        return float(os.getenv("NF_PYIN_RESOLUTION", "0.2"))

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

        The standing caveat, as for ``f0_merge``: this corpus is 38 *synthetic* cases, and
        synthetic vibrato is a clean sinusoid where human vibrato is not.  What makes this
        gain more trustworthy than that one is the shape of the rule rather than the size of
        the number — it fires only where pyin and Basic Pitch actually disagree, so on the
        clean, noisy and quiet cases where they agree it is a no-op by construction rather
        than by calibration, and there is no fitted constant for a real recording to fall
        outside of.  It is still the thing to re-measure first once ``tests/accuracy/real/``
        has labelled recordings in it.
        """
        return os.getenv("NF_PYIN_SEMITONE", "1").strip().lower() not in ("0", "false", "no")

    @property
    def onset_gate(self) -> bool:
        """Refuse a note that Basic Pitch's onset head never fired for (Onsets & Frames).

        Melody mode only, and it reaches exactly one thing: ``melodia_trick``.

        Onsets & Frames (Hawthorne et al. 2018) measured the cost of dropping the rule that a
        frame activation may not start a note unless the onset detector agrees — note F1
        82.29 -> 67.44.  ``Posteriorgram``'s docstring records that result and observes that
        both of this pipeline's decode paths are frame-only.  For the *inference* path that
        turned out to be half wrong, which is worth stating plainly because it changes what
        this flag is: ``output_to_notes_polyphonic`` already peak-picks the onset matrix with
        ``scipy.signal.argrelmax`` and thresholds it, so every note its main loop emits does
        start at an onset peak.  The gate is already there.

        What bypasses it is the melodia trick, which runs afterwards over ``remaining_energy``
        and creates notes from leftover FRAME activation with no onset consulted at all.  That
        is the O&F ablation, in the vendored decoder, on by default.  So the whole of W2's
        inference half is this one kwarg rather than the re-decode the plan proposed --
        ``predict`` exposes ``melodia_trick`` directly (basic_pitch/inference.py:423).

        **Measured, and it does not pay -- leave this off.**  W2 set itself a gate of
        ``notes.precision >= 0.961`` and ``recall >= 0.971``; turning this on misses both, and
        every headline metric moves the wrong way:

            notes.precision          0.936  vs  0.961      <- gate wanted >= 0.961
            notes.recall             0.947  vs  0.971      <- gate wanted >= 0.971
            notes.f1_with_offset     0.929  vs  0.953
            solfa.degree_accuracy    0.976  vs  1.000      <- was saturated
            solfa.syllable_accuracy  0.963  vs  0.988

        against only decorative gains (``conf.mean_correct`` +0.004, key unchanged).  The
        uniform -0.024 is 1/41: exactly one case collapses, ``poly_block_chords_c_major``,
        11/11 notes.f1 1.000 -> 11/10 0.000 with every other case bit-identical.

        The reason is the useful part, and it corrects what this docstring first claimed.  The
        melody floor is NOT what breaks -- it fires identically either way (skyline +24.1 vs
        +23.9 semitones above the contour, both re-running pyin from midi 60).  What changes is
        the event set it filters: 59 -> 49 Basic Pitch events, 29 -> 22 surviving above the
        floor.  The trick was contributing 10 events, 7 of them above the floor, and what those
        7 held is one note:

            ref : 0@60  1@62  2@64  3@65  4@67  5@69  6@71  7@72  8@67  9@64  10@60
            est : 0@62  1@64  2@65  3@67  4@69  5@71  6@72  7@67  8@64  9@60

        Every surviving PITCH is correct.  The melody's first note -- C4, midi 60, sitting
        exactly ON the floor and an octave above the first chord's C3 root -- is the one the
        trick was supplying, and without it the whole clip re-indexes one beat earlier.  That is
        why notes.f1 goes to 0.000 rather than to 0.909: each right pitch now lands on the wrong
        beat.  It also explains the other two columns exactly -- beats.f1 0.952 is 2*10/21 with
        every onset still on a reference onset, and ``f1_shift_invariant`` equals raw beats.f1
        because the onsets already align, so no constant shift improves them.

        (An earlier version of this note read ``shift-inv`` as pitch-transposition invariance and
        concluded the pipeline had locked onto a lower chord voice.  It is onset-only and ignores
        pitch by construction -- ``metrics.py`` says so -- and the pitches above show tracking
        was in fact near-perfect.  Noted because the wrong reading is an easy one to repeat.)

        So the melodia trick is recovering a MELODY note here, not "a second voice below the
        melody": the chord's three voices attack together at t=0, the onset-driven pass does not
        return the C4 an octave above the root, and only leftover frame energy does.
        ``mode == "melody"`` is no defence because every corpus case runs melody mode
        (``runner.py:143``), poly ones included -- which is also how a real user hums over a
        chord and expects the top line.

        Worth knowing independently of this flag: ONE dropped leading note re-indexed all ten
        that followed.  That cascade is not caused by the gate, only exposed by it.
        """
        return os.getenv("NF_ONSET_GATE", "0").strip().lower() not in ("0", "false", "no")

    @property
    def vocal_engine(self) -> bool:
        """Segment melody-mode clips with ``app.pipeline.vocal`` (f0 contour, tuning
        offset, hysteresis segmentation, key-aware rounding) instead of the band /
        persistence contour segmenter.  Built for hummed and sung recordings; the old
        path remains as the fallback when it finds nothing."""
        return os.getenv("NF_VOCAL_ENGINE", "1").strip().lower() not in ("0", "false", "no")

    @property
    def song_doh(self) -> bool:
        """Let a song's band settle the doh its separated voice is unsure of
        (``transcriber._doh_from_band``, step 7c of ``_transcribe_wav``).  Studio songs
        (``tests.accuracy.studio_songs``, dev half): doh 21 -> 23 of 23, the syllables a user
        reads wrong 0.331 -> 0.287 per note; the real ADC2004/MIREX05 songs: fires on 1 of 21,
        and puts it right."""
        return os.getenv("NF_SONG_DOH", "1").strip().lower() not in ("0", "false", "no")

    @property
    def contour_first(self) -> bool:
        """Segment notes from the pyin f0 contour instead of repairing Basic Pitch's.

        Melody mode only.  This is the end of the road ``pyin_refine`` -> ``pyin_semitone``
        started down: each step trusted pyin further, and this one stops asking Basic Pitch
        where the notes are at all.

        **The claim the old division of labour rested on is false for monophonic input.**
        ``_pyin_contour``'s docstring says "a frame-level f0 tracker has no note
        segmentation of its own, so it cannot replace inference".  A monophonic note *is* a
        run of stable pitch bounded by a voicing gap, so the segmentation is there — it was
        never looked for.  Measured on the corpus at pyin's 23.2 ms hop:

            voiced frames                     95.4-96.7% on every case measured
            unvoiced holes inside a sung span 0 on every case but one (that one: 1 frame)
            |raw f0 - truth|, per ref note    median 0.092 semitones on EVERY case,
                                              vibrato_depth_2_0 (+-2.0 st at 5.5 Hz) included

        So the contour carries both boundaries and pitch, to well under the semitone the
        notation rounds to, on precisely the clips Basic Pitch fragments.  Note this also
        retires the worry ``PYIN_MIN_VOICED_PROB`` raises: pyin's periodicity *value*
        collapses under deep vibrato (median 0.28-0.33) while its voicing *decision* and its
        pitch do not, and only the latter two are load-bearing here.

        **Three segmentation rules were measured; only the third works.**  Scored offline as
        onset within 150 ms AND correct rounded pitch, over 17 cases:

            rule                                       mean f1   guards at 1.000   worst
            deviation from a running median band         0.807       5 of 5        0.167
            |median(left) - median(right)| change point   0.488       0 of 5        0.042
            band + PERSISTENCE (this one)                 0.920      14 of 17       0.333

        The band test fails because its cut condition scales with vibrato DEPTH: no band
        narrow enough to see a 1-semitone step contains a 4-semitone peak-to-peak wobble,
        so the two requirements contradict — the same contradiction ``WOBBLE_SEMITONES``
        hit downstream, restated in the frequency domain.  The change-point test is
        depth-invariant and unusable: the statistic is high across a plateau ~N frames wide
        rather than at a point, so it cuts every genuine boundary two or three times and
        breaks the clean guards (major_c 0.417, semitone_steps 0.560).

        What separates the populations is neither amplitude nor stationarity but
        PERSISTENCE: a vibrato excursion leaves the band and returns within a fraction of a
        cycle, a note change leaves and stays.  See ``CONTOUR_PERSIST_FRAMES`` — its value
        comes from the sine geometry rather than from the corpus.

        On by default: scored over the full 38-case corpus it takes notes.f1 0.875 -> 0.937,
        semitone_neighbour_ghosts 3.051 -> 0.410 and solfa.degree_accuracy 0.944 -> 0.996,
        which is the offline segmentation metric above confirmed on the real gate.  Poly mode
        ignores this flag outright: the rule assumes one voice, and a chord has no single
        f0 contour to segment.

        Two cases remain under the notes.f1 gate — ``vibrato_depth_1_8`` (0.429) and
        ``vibrato_depth_2_0`` (0.400), both from 0.085/0.000 — and both now reach
        solfa.degree_accuracy 1.000, so the syllables are right and the note COUNT is not.
        Both over-segment because the pre-smoother passes enough of the wobble to leave
        frames genuinely out of band; widening it was measured and makes them worse, so the
        remedy is not a wider median.  See ``CONTOUR_PERSIST_FRAMES``, which records the
        sweep and the ceiling.  Joining the fragments afterwards instead was measured too and
        is also a failure — the numbers are under ``CONTOUR_FUSE_GAP_SEC``, along with the one
        lead the two measurements leave standing.
        """
        return os.getenv("NF_CONTOUR_FIRST", "1").strip().lower() not in ("0", "false", "no")

    @property
    def grid_refine(self) -> bool:
        """Re-measure the tempo and the beat origin against the grid, over the whole clip.

        Both are currently estimated from one sample and both are biased because of it.
        ``_grid_bpm`` takes 60/median(inter-onset interval), which cannot express a tempo
        whose beat period is not a whole number of frame hops — a true 96 BPM is 26.94 hops
        at pyin's 23.2 ms, so the closest reachable answer is 27 hops = 95.70 BPM.  And
        ``_beat_origin`` nails beat 0 to the first onset, the one sample a pitch tracker is
        least sure of, so every other note inherits its error.

        The two compound rather than merely coexisting.  Reproduced exactly over 99 quarter
        notes, counting how many land in the wrong cell relative to their neighbours: the
        phase bias alone misplaces 0, the 0.31% tempo bias alone misplaces 18, and the pair
        together misplaces 55.  The phase bias adds no magnitude — it shifts which SIDE of
        each boundary the residue sits on, so the early notes round one way and the late ones
        the other.  On ``long_clip_over_pyin_cap`` that swept the residue from −0.185 to
        +0.056 beats across 63 s, and each crossing cost exactly half a beat.  It is also why
        correcting the phase on its own made that case worse: a ramp is a tempo error.

        On by default.  It repairs ``long_clip_over_pyin_cap`` outright (notes.f1 0.242 ->
        1.000 on the contour path) and helps the legacy inference path too, where it is worth
        notes.f1 +0.002, solfa.syllable_accuracy +0.009 and tempo.abs_error −0.385 on its own.

        One case moves the wrong way: ``drift_1_semitone`` 0.909 -> 0.818.  Its tempo comes
        back 145 against a true 96 — a 1.5x metrical-level error — and refining ±1% around
        the wrong level reshuffles placement within it.  That is the pre-existing defect
        ``metrics.TEMPO_METRICAL_FACTORS`` exists to measure, not this rule misbehaving;
        picking the level is ``_grid_bpm``'s job and this deliberately cannot reach another.

        See ``_refine_grid``.  It cannot return a worse grid fit than it was handed — the
        incumbent is a member of its own search space — but "closer to the grid" is not the
        same claim as "closer to the truth", which is what the harness is for.
        """
        return os.getenv("NF_GRID_REFINE", "1").strip().lower() not in ("0", "false", "no")

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
    def tempo_plain_level(self) -> bool:
        """Among tempi that fit the onsets alike, prefer one that writes the commonest note plain.

        See ``transcriber._PLAIN_NOTE_BEATS``.  Off, the reading nearest 100 BPM wins the tie
        even when it writes the commonest note dotted.

        Measured, replaying the tempo choice on every corpus's captured onsets and then end to
        end: the sung corpus 60 -> 61 of 61 at the reference level (``low_hum_cminor`` at 76,
        not 113), the hymn corpus dev 0.878 -> 0.895 and held-out 0.924 -> 0.933, the
        instrument corpus unchanged (every number), Vocadito unchanged.  Two wider rules were
        measured and not shipped: "dotted loses every tie" moved ``vibrato_rate_k20`` from 1.5x
        to 2x, an octave error the instrument gate rejects; and preferring the level whose beat
        is the commonest note inside 60-160 BPM (for hymns read at half tempo above 141)
        reached 0.950 on dev but 0.929 held out, where it read three more tunes at double tempo:
        it fitted the dev half, so it stayed out.
        """
        return os.getenv("NF_TEMPO_PLAIN_LEVEL", "1").strip().lower() not in ("0", "false", "no")

    @property
    def meter_detect(self) -> bool:
        """Read the time signature (when none is given) and the bar phase off the notes.

        Off writes every sheet in the given meter, or 4/4, with its first bar line at the first
        note, as before.  See ``transcriber._meter_and_pickup`` for what it reads, and step 8b of
        ``_transcribe_wav`` for what it measured on the hymn corpus (held out: notes in the right
        bar 0.656 -> 0.786, every bar line right 0.376 -> 0.676; the sung, instrument and
        Vocadito numbers unchanged).
        """
        return os.getenv("NF_METER_DETECT", "1").strip().lower() not in ("0", "false", "no")

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

        What it bought when first measured: solfa.chromatic_ghosts 3.579 -> 3.553 — one
        accidental across 38 cases — while solfa.ghost_count went 5.737 -> 5.842, past the
        harness's 0.02 tolerance, and notes.n_est rose by the same 0.105.

        **Re-measured on top of the wobble fuse, and the clutter half of that reversed
        sign.**  Worth reading before re-running it a third time.  A merged event spans both
        fragments, so it is longer, so it overlaps more of what follows — and the *old*
        melody resolver's truncate branch appended both sides of an overlap, which is how a
        stage that fuses more used to emit more notes.  ``WOBBLE_MIN_OVERLAP_FRACTION``
        removed that mechanism, and with it the recorded objection: ghost_count now
        2.553 -> 2.342 (-8 ghost notes corpus-wide) and n_est 13.395 -> 13.263, both
        improvements.

        It still does not pay, for a cost the first measurement could not see: **the key.**
        key.exact 0.895 -> 0.842, key.parallel_confusion 0.000 -> 0.053,
        key.confidence_separation 0.376 -> 0.098.  Merging rewrites note *durations*, and
        the ensemble reads a duration-weighted pitch-class histogram, so reweighting it is
        enough to move the vote — on vibrato_rate_k20 the merge also deleted three real
        notes (recall 0.909 -> 0.636).  Because every syllable derives from the key, both
        cases that lose it go to zero: degree/syllable accuracy 1.000 -> 0.000 on k20 and
        0.889 -> 0.000 on k155, i.e. -0.050 on both corpus-wide.

        Weigh that against the win, which is unchanged and is smaller than it looks:
        chromatic_ghosts 1.526 -> 1.500 is exactly one accidental, on exactly one case
        (drift_1_semitone, 8 -> 7 — it still carries seven).  Nor is even the clutter win
        uniform: vibrato_rate_7hz is strictly worse on, ghost_count 6 -> 8, notes.f1
        0.593 -> 0.552.  So the trade is one accidental against two clips whose every
        syllable is wrong.  ``F0_MERGE_SEMITONES``' tolerance also remains fitted rather
        than general — the losers sit outside the nine cases it was calibrated on.

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

        That struck the resolver route only for *f0 as the discriminator*.  The resolver
        turned out to be the right stage after all, reached with a different signal: integer
        pitch adjacency plus overlap as a fraction of the shorter event, since a genuine
        legato step bleeds at its edge while a wobble sliver sits inside its note.  See
        ``WOBBLE_MIN_OVERLAP_FRACTION`` in ``pipeline/transcriber.py``.

        Off restores the previous behaviour exactly rather than approximately, because with
        no bend data an Event's f0 *is* its pitch and the tolerance test collapses to
        equality.  Turning it on is still worth an A/B on real recordings before anyone
        writes the idea off entirely: synthetic vibrato is a clean sinusoid and human
        vibrato is not, and this corpus is 38 synthetic cases.
        """
        return os.getenv("NF_F0_MERGE", "0").strip().lower() not in ("0", "false", "no")

    @property
    def contour_gap_merge(self) -> bool:
        """Fuse same-pitch Basic Pitch fragments across a continuously voiced gap.

        This is off until it is validated on the real singing corpus.  The helper is
        deliberately conservative and requires pyin voicing plus pitch continuity;
        keeping the switch dynamic lets the accuracy harness compare it in-process.
        """
        return os.getenv("NF_CONTOUR_GAP_MERGE", "0").strip().lower() not in ("0", "false", "no")

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

    @property
    def chromatic_spelling(self) -> str:
        """Chromatic solfa convention shared with clients.

        ``direction`` is the tonic solfa hymn-book rule (``solfa.ascending_flags``): a
        chromatic rising a semitone to the next note uses the sharpened table, one falling
        a semitone the flattened table, and anything else the key's usual name.  The explicit
        modes are useful for regional notation preferences and are deliberately
        constrained to a small wire-safe vocabulary.
        """
        value = os.getenv("NF_CHROMATIC_SPELLING", "direction").strip().lower()
        return value if value in {"direction", "ascending", "descending"} else "direction"

    @property
    def hymn_match(self) -> bool:
        """Look a melody transcription's tune up in the hymn index (``pipeline.hymn_match``).

        On by default; ``NF_HYMN_MATCH=0`` stops the "Use the hymnbook version?" offer without
        a deploy of the clients, which simply see no ``hymn_match``.
        """
        return os.getenv("NF_HYMN_MATCH", "1").strip().lower() not in ("0", "false", "no")


settings = Settings()

#: The prefixes of every temporary file and directory this app makes in the system temp
#: directory, so the startup sweep (``app.main``) can remove what a killed process left there.
TEMP_PREFIX = "nf-tmp-"
TEMP_PREFIXES = (TEMP_PREFIX, "nf_link_", "nf-upload-", "nf_cookies_")
