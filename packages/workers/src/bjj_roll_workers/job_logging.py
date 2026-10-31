import json
import sys


def log_job_event(
    event: str,
    job_id: str | None,
    *,
    duration_seconds: float | None = None,
    error_class: str | None = None,
    peak_rss_bytes: int | None = None,
    chunk_index: int | None = None,
    chunk_frames: int | None = None,
) -> None:
    entry: dict[str, object] = {"event": event, "jobId": job_id}
    if duration_seconds is not None:
        entry["durationSeconds"] = round(duration_seconds, 3)
    if error_class is not None:
        entry["errorClass"] = error_class
    if peak_rss_bytes is not None:
        entry["peakRssBytes"] = peak_rss_bytes
    if chunk_index is not None:
        entry["chunkIndex"] = chunk_index
    if chunk_frames is not None:
        entry["chunkFrames"] = chunk_frames
    sys.stdout.write(f"{json.dumps(entry)}\n")
