"""Locust load test for NoteFusion Pro transcription requests.

The API currently exposes an asynchronous submit/poll contract.  This workload records:

* HTTP submit and poll timings through Locust's normal request statistics.
* end-to-end submit-to-terminal latency as ``TRANSCRIPTION / end_to_end``.
* a client-observed submit-to-processing time as ``TRANSCRIPTION / queue_observed``.
* terminal success/failure counts through request failures.

The queue metric is explicitly named ``queue_observed`` because the API does not expose
server enqueue/start timestamps.  It is upper-bounded by the polling interval and must
not be described as exact queue wait without server-side timestamps.

Required environment variables:

    LOCUST_AUDIO_FILE=/path/to/example.wav
    or LOCUST_AUDIO_DIR=/path/to/fixture-directory

Optional environment variables:

    LOCUST_PRO_HEADER_NAME=X-Subscription-Tier
    LOCUST_PRO_HEADER_VALUE=pro
    LOCUST_AUTH_TOKEN=...              # sent as Authorization: Bearer ...
    LOCUST_AUTH_HEADER_NAME=...        # alternative to Authorization
    LOCUST_AUTH_HEADER_VALUE=...
    LOCUST_MODE=melody
    LOCUST_TIME_SIGNATURE=4/4
    LOCUST_TEMPO=100
    LOCUST_POLL_INTERVAL=0.25
    LOCUST_POLL_TIMEOUT=300
    LOCUST_INFLIGHT_PER_USER=1
    LOCUST_AUDIO_SELECTION=random     # random or round_robin
    LOCUST_HTTP_TIMEOUT=30

Example:

    locust -f server/loadtest/locustfile.py --host http://127.0.0.1:8000 \
      --users 8 --spawn-rate 2 --run-time 10m --headless \
      --csv results/pro-warm-u8 --html results/pro-warm-u8.html
"""

from __future__ import annotations

import os
import random
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from locust import HttpUser, between, events, task


AUDIO_SUFFIXES = {".wav", ".flac", ".ogg", ".opus", ".mp3", ".m4a"}
TERMINAL_STATUSES = {"done", "failed"}


def _env_float(name: str, default: float, minimum: float = 0.0) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    value = float(raw)
    if value < minimum:
        raise ValueError(f"{name} must be >= {minimum}, got {value}")
    return value


def _env_int(name: str, default: int, minimum: int = 0) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    value = int(raw)
    if value < minimum:
        raise ValueError(f"{name} must be >= {minimum}, got {value}")
    return value


def _required_audio_files() -> list[Path]:
    file_value = os.getenv("LOCUST_AUDIO_FILE")
    dir_value = os.getenv("LOCUST_AUDIO_DIR")
    if bool(file_value) == bool(dir_value):
        raise RuntimeError("Set exactly one of LOCUST_AUDIO_FILE or LOCUST_AUDIO_DIR")

    if file_value:
        paths = [Path(file_value).expanduser().resolve()]
    else:
        root = Path(dir_value).expanduser().resolve()
        paths = sorted(path for path in root.iterdir() if path.is_file() and path.suffix.lower() in AUDIO_SUFFIXES)

    if not paths:
        raise RuntimeError("No supported audio fixtures found")
    missing = [str(path) for path in paths if not path.is_file()]
    if missing:
        raise RuntimeError(f"Audio fixture(s) do not exist: {', '.join(missing)}")
    return paths


def _common_headers() -> dict[str, str]:
    headers: dict[str, str] = {
        "X-Correlation-ID": uuid.uuid4().hex,
    }
    token = os.getenv("LOCUST_AUTH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    custom_name = os.getenv("LOCUST_AUTH_HEADER_NAME")
    custom_value = os.getenv("LOCUST_AUTH_HEADER_VALUE")
    if custom_name and custom_value:
        headers[custom_name] = custom_value

    pro_name = os.getenv("LOCUST_PRO_HEADER_NAME")
    pro_value = os.getenv("LOCUST_PRO_HEADER_VALUE")
    if pro_name and pro_value:
        headers[pro_name] = pro_value
    return headers


@dataclass
class InFlightJob:
    job_id: str
    submitted_at: float
    processing_observed_at: float | None = None


class ProTranscriptionUser(HttpUser):
    """A Pro member repeatedly submits and completes asynchronous transcriptions."""

    wait_time = between(0.5, 1.5)
    abstract = False

    def on_start(self) -> None:
        self.audio_paths = _required_audio_files()
        self.audio_selection = os.getenv("LOCUST_AUDIO_SELECTION", "random").strip().lower()
        if self.audio_selection not in {"random", "round_robin"}:
            raise RuntimeError("LOCUST_AUDIO_SELECTION must be random or round_robin")
        self.audio_index = 0
        self.poll_interval = _env_float("LOCUST_POLL_INTERVAL", 0.25, minimum=0.05)
        self.poll_timeout = _env_float("LOCUST_POLL_TIMEOUT", 300.0, minimum=1.0)
        self.http_timeout = _env_float("LOCUST_HTTP_TIMEOUT", 30.0, minimum=1.0)
        self.inflight_per_user = _env_int("LOCUST_INFLIGHT_PER_USER", 1, minimum=1)
        self.mode = os.getenv("LOCUST_MODE", "melody")
        if self.mode not in {"melody", "poly"}:
            raise RuntimeError("LOCUST_MODE must be melody or poly")
        self.time_signature = os.getenv("LOCUST_TIME_SIGNATURE", "4/4")
        tempo = os.getenv("LOCUST_TEMPO")
        self.tempo = int(tempo) if tempo else None

    def _audio_path(self) -> Path:
        if self.audio_selection == "random":
            return random.choice(self.audio_paths)
        path = self.audio_paths[self.audio_index % len(self.audio_paths)]
        self.audio_index += 1
        return path

    def _form_data(self) -> dict[str, str]:
        data = {
            "mode": self.mode,
            "time_signature": self.time_signature,
        }
        if self.tempo is not None:
            data["tempo"] = str(self.tempo)
        return data

    def _record_custom(self, name: str, started_at: float, exception: Exception | str | None = None) -> None:
        events.request.fire(
            request_type="TRANSCRIPTION",
            name=name,
            response_time=(time.perf_counter() - started_at) * 1000.0,
            response_length=0,
            exception=exception,
            context={"mode": self.mode, "inflight_per_user": self.inflight_per_user},
        )

    def _submit(self) -> InFlightJob | None:
        audio_path = self._audio_path()
        started = time.perf_counter()
        headers = _common_headers()
        headers["X-Correlation-ID"] = uuid.uuid4().hex
        try:
            with audio_path.open("rb") as audio_file:
                response = self.client.post(
                    "/v1/transcribe",
                    files={"audio": (audio_path.name, audio_file, "audio/wav")},
                    data=self._form_data(),
                    headers=headers,
                    name="POST /v1/transcribe (Pro submit)",
                    timeout=self.http_timeout,
                )
            if response.status_code != 202:
                error = RuntimeError(f"submit returned HTTP {response.status_code}: {response.text[:200]}")
                self._record_custom("submit_to_terminal", started, error)
                return None
            payload = response.json()
            job_id = payload.get("jobId") or payload.get("job_id")
            if not job_id:
                error = RuntimeError("submit response did not contain jobId")
                self._record_custom("submit_to_terminal", started, error)
                return None
            # Keep the timestamp from before opening/uploading the file so the custom
            # metric includes the complete submit-to-terminal journey.
            return InFlightJob(job_id=str(job_id), submitted_at=started)
        except Exception as exc:  # noqa: BLE001 - record load-test failure and continue
            self._record_custom("submit_to_terminal", started, exc)
            return None

    def _poll_until_terminal(self, job: InFlightJob) -> None:
        deadline = time.perf_counter() + self.poll_timeout
        while time.perf_counter() < deadline:
            poll_started = time.perf_counter()
            try:
                response = self.client.get(
                    f"/v1/jobs/{job.job_id}",
                    headers=_common_headers(),
                    name="GET /v1/jobs/{job_id} (Pro poll)",
                    timeout=self.http_timeout,
                )
                if response.status_code != 200:
                    self._record_custom("submit_to_terminal", job.submitted_at, RuntimeError(f"poll returned HTTP {response.status_code}"))
                    return
                payload = response.json()
                status = str(payload.get("status", "")).lower()
                if status == "processing" and job.processing_observed_at is None:
                    job.processing_observed_at = time.perf_counter()
                    self._record_custom("submit_to_processing_observed", job.submitted_at)
                if status in TERMINAL_STATUSES:
                    if status == "done":
                        self._record_custom("submit_to_terminal", job.submitted_at)
                    else:
                        error = payload.get("error") or "transcription job failed"
                        self._record_custom("submit_to_terminal", job.submitted_at, str(error))
                    return
            except Exception as exc:  # noqa: BLE001 - record timeout/transport failure
                self._record_custom("submit_to_terminal", job.submitted_at, exc)
                return
            time.sleep(self.poll_interval)

        self._record_custom("submit_to_terminal", job.submitted_at, TimeoutError("job did not reach a terminal state"))

    @task
    def transcribe_pro_batch(self) -> None:
        jobs: list[InFlightJob] = []
        for _ in range(self.inflight_per_user):
            job = self._submit()
            if job is not None:
                jobs.append(job)
        for job in jobs:
            self._poll_until_terminal(job)


@events.test_start.add_listener
def _test_start(environment: Any, **kwargs: Any) -> None:
    if environment.parsed_options is not None and getattr(environment.parsed_options, "headless", False):
        print(
            "[notefusion-loadtest] Pro workload started; "
            f"audio={os.getenv('LOCUST_AUDIO_FILE') or os.getenv('LOCUST_AUDIO_DIR')} "
            f"inflight_per_user={os.getenv('LOCUST_INFLIGHT_PER_USER', '1')}"
        )


@events.test_stop.add_listener
def _test_stop(environment: Any, **kwargs: Any) -> None:
    """Print interpretation guidance; Locust CSV/HTML remains the source of totals."""
    if environment.web_ui is None:
        print(
            "[notefusion-loadtest] Use Locust CSV/HTML output for aggregate percentiles. "
            "TRANSCRIPTION/submit_to_processing_observed is polling-granularity bounded, "
            "not an exact server queue timestamp."
        )
