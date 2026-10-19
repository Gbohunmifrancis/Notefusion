"""Live progress for the API: a job's stage, progress and place in line, posted to
``<callback_url>/progress`` as they change, so a client watching the job is told instead
of asking every two seconds (the API hands it on over the job's event stream).

One sender thread for the whole queue. A change only marks its job; the thread sends each
marked job's latest state at most once per ``min_interval`` seconds, one attempt with a
short timeout. Progress is advisory: the completion webhook and the client's own GET carry
the outcome, so a lost update costs a slightly stale bar and nothing more. A job that has
ended is never posted here; its completion webhook says so.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Callable

import httpx

logger = logging.getLogger(__name__)

#: Seconds between two posts about the same job: a running job's bar moves many times a
#: second, and once a second is as fast as anyone watches it.
MIN_INTERVAL = 1.0
#: The API answers a progress post without touching its database; one that takes longer
#: than this is busy or restarting, and the next change will be sent anyway.
TIMEOUT = 2.0


class ProgressReporter:
    """Coalesces job changes and posts each job's latest state.

    ``snapshot(job)`` builds the body to post (the worker's ``JobResponse`` without a
    result), or returns None for a job that has ended; ``url(job)`` is where to post it,
    or None when the job has nowhere to report to.
    """

    def __init__(self, snapshot: Callable[[object], dict | None], url: Callable[[object], str | None],
                 headers: Callable[[], dict], min_interval: float = MIN_INTERVAL,
                 timeout: float = TIMEOUT) -> None:
        self._snapshot = snapshot
        self._url = url
        self._headers = headers
        self._min_interval = min_interval
        self._timeout = timeout
        self._cv = threading.Condition()
        self._dirty: dict[str, object] = {}
        self._last_sent: dict[str, float] = {}
        self._thread: threading.Thread | None = None

    def mark(self, job) -> None:
        """The job changed. Cheap and non-blocking: called from the pipeline's progress
        callbacks and from inside the queue's own lock."""
        with self._cv:
            self._dirty[job.id] = job
            if self._thread is None:
                self._thread = threading.Thread(target=self._run, name="nf-progress", daemon=True)
                self._thread.start()
            self._cv.notify()

    def _run(self) -> None:
        with httpx.Client(timeout=self._timeout) as client:
            while True:
                for job in self._due():
                    self._send(client, job)

    def _due(self) -> list:
        """Blocks until at least one marked job may be sent, and takes those that may."""
        with self._cv:
            while True:
                now = time.monotonic()
                due, wait = [], None
                for job_id, job in list(self._dirty.items()):
                    left = self._last_sent.get(job_id, 0.0) + self._min_interval - now
                    if left <= 0:
                        due.append(self._dirty.pop(job_id))
                        self._last_sent[job_id] = now
                    else:
                        wait = left if wait is None else min(wait, left)
                if due:
                    return due
                self._cv.wait(wait)

    def _send(self, client: httpx.Client, job) -> None:
        url = self._url(job)
        body = self._snapshot(job) if url else None
        if body is None:
            with self._cv:
                self._last_sent.pop(job.id, None)
            return
        try:
            client.post(url, json=body, headers=self._headers())
        except Exception as e:  # noqa: BLE001 - advisory; the next change is sent anyway
            logger.debug("Progress for job %s not delivered: %s", job.id[:8], e)
