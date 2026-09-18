import os
import logging
import structlog
from typing import Dict, Any, Optional

def configure_telemetry(json_format: bool = True):
    """Configure structured logging for the application."""
    log_level = os.environ.get("NF_LOG_LEVEL", "INFO").upper()
    logging.basicConfig(level=log_level, format="%(message)s")

    processors = [
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    if json_format:
        processors.append(structlog.processors.JSONRenderer())
    else:
        processors.append(structlog.dev.ConsoleRenderer())

    structlog.configure(
        processors=processors,
        context_class=dict,
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

def emit_transcription_event(
    experiment_arm: str,
    git_sha: str,
    model_version: str,
    mode: str,
    clip_duration_bucket: str,
    n_est_notes: int,
    contour_merge_count: int,
    merge_gap_buckets: Dict[str, int],
    n_candidate_ghosts: int,
    n_candidate_accidentals: int,
    stage_timings_ms: Dict[str, float],
    error_class: Optional[str] = None
):
    """Emit a structured telemetry event at the end of a transcription job."""
    logger = structlog.get_logger("app.telemetry")
    logger.info(
        "transcription_completed",
        experiment_arm=experiment_arm,
        git_sha=git_sha,
        model_version=model_version,
        mode=mode,
        clip_duration_bucket=clip_duration_bucket,
        n_est_notes=n_est_notes,
        contour_merge_count=contour_merge_count,
        merge_gap_buckets=merge_gap_buckets,
        n_candidate_ghosts=n_candidate_ghosts,
        n_candidate_accidentals=n_candidate_accidentals,
        stage_timings_ms=stage_timings_ms,
        error_class=error_class
    )
