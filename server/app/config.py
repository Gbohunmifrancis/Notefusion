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
    def key_ensemble(self) -> bool:
        """Vote over five music21 key profiles instead of music21's default one.

        ``Stream.analyze("key")`` is AardenEssen, whose documented weakness is a
        tendency to call the subdominant the tonic — reproduced exactly on a plain
        C-major stream, which it reads as F major.  A wrong tonic re-labels every
        solfa syllable, so this is the highest-leverage correctness flag here.
        """
        return os.getenv("NF_KEY_ENSEMBLE", "1").strip().lower() not in ("0", "false", "no")

    @property
    def quantize_divisors(self) -> tuple[int, ...]:
        """music21 quantize grid, as divisions per quarter note.

        The default 4 is sixteenths, which makes the 0.25 duration floor in the
        pipeline exactly one grid step instead of contradicting a coarser grid.

        "4,3" adds eighth-triplets and is deliberately *not* the default: measured
        over the accuracy corpus it was never better than "4" alone (aggregate
        notes.f1 0.821 against 0.823) and the triplet case it was added for did
        not move at all, because that case's tempo is misread as 117 BPM against a
        true 96 — no triplet grid can align under a wrong beat period.  Retest it
        once tempo estimation improves.

        Unparseable entries are dropped rather than raising, so a typo in a deploy
        cannot fail every transcription.
        """
        raw = os.getenv("NF_QUANTIZE_DIVISORS", "")
        parsed = tuple(int(p) for p in raw.split(",") if p.strip().isdigit() and int(p) > 0)
        return parsed or (4,)


settings = Settings()
