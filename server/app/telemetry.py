import os
import re
import logging
import structlog
from typing import Dict, Any, Optional

_URL = re.compile(r"https?://\S+")
_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")


def _mask(value: Any) -> Any:
    """A string with every URL (a linked song's address, a callback) and email address masked."""
    if not isinstance(value, str):
        return value
    return _EMAIL.sub("[email]", _URL.sub("[url]", value))


def scrub_event(event: Dict[str, Any], _hint: Any = None) -> Dict[str, Any]:
    """Sentry's before_send: masks URLs and email addresses in the message, the exceptions and the extras,
    and keeps only the method and address of the request that failed.

    The SDK already sends no request body (max_request_body_size) and no local variables; it would send the
    headers it does not count as sensitive and the query string, so they go here."""
    request = event.get("request")
    if isinstance(request, dict):
        for key in ("headers", "cookies", "query_string", "data", "env"):
            request.pop(key, None)
    logentry = event.get("logentry")
    if isinstance(logentry, dict):
        for key in ("message", "formatted"):
            logentry[key] = _mask(logentry.get(key))
        if isinstance(logentry.get("params"), (list, tuple)):
            logentry["params"] = [_mask(p) for p in logentry["params"]]
    if "message" in event:
        event["message"] = _mask(event["message"])
    for exception in (event.get("exception") or {}).get("values") or []:
        exception["value"] = _mask(exception.get("value"))
    if isinstance(event.get("extra"), dict):
        event["extra"] = {k: _mask(v) for k, v in event["extra"].items()}
    return event


def scrub_breadcrumb(crumb: Dict[str, Any], _hint: Any = None) -> Dict[str, Any]:
    """Sentry's before_breadcrumb: the same masking for the log lines and HTTP calls before an error
    (yt-dlp's requests carry the video's address)."""
    crumb["message"] = _mask(crumb.get("message"))
    if isinstance(crumb.get("data"), dict):
        crumb["data"] = {k: _mask(v) for k, v in crumb["data"].items()}
    return crumb


def configure_error_reporting() -> bool:
    """Sends crashes to Sentry when NF_SENTRY_DSN is set; without it nothing is loaded or sent.

    Called before the FastAPI app is made, so the SDK's FastAPI integration sees it. Events are the
    5xx responses and ERROR log lines (a job that crashed, ``JobQueue._crashed``); a job that fails as
    expected (a noisy clip, an unusable link) logs a warning, which only rides along as a breadcrumb.
    The SDK sends from a background thread and drops events when Sentry cannot be reached."""
    dsn = os.environ.get("NF_SENTRY_DSN", "").strip()
    if not dsn:
        return False
    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=os.environ.get("NF_SENTRY_ENVIRONMENT", "production"),
        release=os.environ.get("NF_SENTRY_RELEASE") or None,
        send_default_pii=False,
        max_request_body_size="never",
        include_local_variables=False,
        before_send=scrub_event,
        before_breadcrumb=scrub_breadcrumb,
    )
    return True

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
