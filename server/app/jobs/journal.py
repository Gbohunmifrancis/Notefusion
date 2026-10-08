"""The job journal: every submitted job written to disk, replayed after a restart.

The queue is in memory (``app.jobs.queue``): a deploy, a crash or an out-of-memory kill
used to drop every queued and running job, and the API could only tell the user "the
service restarted, submit it again".  With ``NF_JOB_DIR`` set, a submit is journaled before
it is queued — the options, the audio file (moved into the journal directory, for an
upload) and how many times the job has been started — and ``JobQueue.recover`` re-queues
what it finds under the same job ids, so the API's rows, the clients' polling and the one
song charge stay as they were.  A job started ``settings.job_max_attempts`` times without
ending is failed instead of replayed: one that kills the worker would otherwise kill it
forever.  Results are not journaled: the API banks every result the moment a job ends
(the completion webhook, then its sweep), and the in-memory copy covers the gap.

Audio never outlives its job here either: the file is deleted when the job ends, as it
always was, and the journal entry with it.  A journal that cannot be written is logged
and the job runs anyway — without durability, never without service.
"""

import json
import logging
import os
import shutil
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)


class JobJournal:
    def __init__(self, directory: str | os.PathLike) -> None:
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)

    def _path(self, job_id: str) -> Path:
        return self.dir / f"{job_id}.json"

    def write(self, job_id: str, record: dict) -> None:
        """Write the entry whole: a temporary file renamed over the old one, so a crash
        mid-write leaves the previous entry or none, never half of one."""
        try:
            fd, tmp = tempfile.mkstemp(prefix=f".{job_id}.", suffix=".tmp", dir=self.dir)
            with os.fdopen(fd, "w", encoding="utf-8") as out:
                json.dump(record, out)
            os.replace(tmp, self._path(job_id))
        except OSError as exc:
            logger.warning("Job %s not journaled (%s): it runs, but would not survive a restart", job_id[:8], exc)

    def read(self, job_id: str) -> dict | None:
        try:
            record = json.loads(self._path(job_id).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        return record if isinstance(record, dict) else None

    def keep(self, job_id: str, audio: Path) -> Path:
        """Move an upload into the journal directory, where it survives a restart; the path
        it now has (the old one when the move failed)."""
        target = self.dir / f"{job_id}{audio.suffix.lower() or '.bin'}"
        try:
            shutil.move(str(audio), str(target))
        except OSError as exc:
            logger.warning("Job %s: audio left in place (%s); it would not survive a restart", job_id[:8], exc)
            return audio
        return target

    def started(self, job_id: str) -> None:
        """One more start of the job, on disk before the work begins."""
        record = self.read(job_id)
        if record is None:
            return
        record["attempts"] = int(record.get("attempts") or 0) + 1
        self.write(job_id, record)

    def delete(self, job_id: str) -> None:
        self._path(job_id).unlink(missing_ok=True)

    def entries(self) -> list[dict]:
        """Every journaled job, oldest first.  An entry that cannot be read is logged and dropped."""
        found = []
        for path in sorted(self.dir.glob("*.json")):
            try:
                record = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(record, dict) or not record.get("id"):
                    raise ValueError("not a job record")
            except (OSError, ValueError) as exc:
                logger.warning("Journal entry %s dropped: %s", path.name, exc)
                path.unlink(missing_ok=True)
                continue
            found.append(record)
        found.sort(key=lambda r: float(r.get("created") or 0.0))
        return found
