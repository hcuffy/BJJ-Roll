"""Structured job logs for Modal functions: job IDs, timings and error classes only (HEN-227)."""

import json
import sys


def log_job_event(event: str, job_id: str | None, *, duration_seconds: float | None = None, error_class: str | None = None) -> None:
    entry: dict[str, object] = {"event": event, "jobId": job_id}
    if duration_seconds is not None:
        entry["durationSeconds"] = round(duration_seconds, 3)
    if error_class is not None:
        entry["errorClass"] = error_class
    sys.stdout.write(f"{json.dumps(entry)}\n")
