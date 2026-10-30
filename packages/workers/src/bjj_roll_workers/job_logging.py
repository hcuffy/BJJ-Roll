"""Structured job logs for Modal functions: job IDs, timings and error classes only (HEN-227)."""

import json
import sys


def log_job_event(
    event: str,
    job_id: str | None,
    *,
    duration_seconds: float | None = None,
    error_class: str | None = None,
    peak_rss_bytes: int | None = None,
    frames_per_second: int | None = None,
    intra_op_threads: int | None = None,
) -> None:
    entry: dict[str, object] = {"event": event, "jobId": job_id}
    if duration_seconds is not None:
        entry["durationSeconds"] = round(duration_seconds, 3)
    if error_class is not None:
        entry["errorClass"] = error_class
    if peak_rss_bytes is not None:
        entry["peakRssBytes"] = peak_rss_bytes
    if frames_per_second is not None:
        entry["framesPerSecond"] = frames_per_second
    if intra_op_threads is not None:
        entry["intraOpThreads"] = intra_op_threads
    sys.stdout.write(f"{json.dumps(entry)}\n")
