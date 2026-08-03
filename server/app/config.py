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


settings = Settings()
