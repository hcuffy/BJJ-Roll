import json
import stat
from pathlib import Path

import pytest

from bjj_roll_workers.tracker_config import load_tracker_config
from bjj_roll_workers.tracker_runner import track_video
from bjj_roll_workers.tracking_output import write_tracking_result
from tracker_fakes import SELF_LABEL, LabelFakeTracker, make_clip, self_tap

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"
EXAMPLE_DOMAIN = "example.invalid"
SYNTHETIC_EMAIL = f"athlete@{EXAMPLE_DOMAIN}"
PRESIGNED_QUERY = "X-Amz-Credential=synthetic&X-Amz-Signature=synthetic0signature"
PRESIGNED_URL = f"https://storage.{EXAMPLE_DOMAIN}/bucket/videos/{VIDEO_ID}/source.mp4?{PRESIGNED_QUERY}"
SYNTHETIC_TOKEN = f"synthetic-bearer-{EXAMPLE_DOMAIN}-0123456789"
UPLOADED_FILENAME = "open-mat-roll-IMG_4412.MOV"
POISON = f"{PRESIGNED_URL} {UPLOADED_FILENAME} {SYNTHETIC_EMAIL} {SYNTHETIC_TOKEN}"
FORBIDDEN_FRAGMENTS = [
    PRESIGNED_URL,
    PRESIGNED_QUERY,
    "https://",
    "X-Amz-",
    UPLOADED_FILENAME,
    SYNTHETIC_EMAIL,
    "@",
    SYNTHETIC_TOKEN,
    VIDEO_ID,
    "mask_",
]
ALLOWED_KEYS = {"event", "jobId", "durationSeconds", "peakRssBytes", "chunkIndex", "chunkFrames"}


def _jumping_layout(frame_index: int) -> dict[int, tuple[int, int]]:
    return {SELF_LABEL: (1, 1) if frame_index < 320 else (11, 8)}


def test_tracker_runner_logs_no_video_bytes_urls_filenames_emails_or_credentials(capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
    frames = make_clip(400, _jumping_layout, extra=POISON.encode())
    footage_folder = tmp_path / "footage"
    footage_folder.mkdir(mode=stat.S_IRWXU)

    result = track_video(
        JOB_ID, VIDEO_ID, frames, self_tap(0, _jumping_layout), LabelFakeTracker(), load_tracker_config(), rss_reader=lambda: 4 * 1024**3
    )
    write_tracking_result(result, footage_folder)

    captured = capsys.readouterr()
    assert result.drift_events
    entries = [json.loads(line) for line in captured.out.splitlines() if line]
    assert {entry["event"] for entry in entries} == {
        "tracker_run_started",
        "tracker_chunk_finished",
        "tracker_chunk_length_fallback",
        "tracker_run_finished",
    }
    assert all(set(entry) <= ALLOWED_KEYS and entry["jobId"] == JOB_ID for entry in entries)
    frame_bytes_sample = frames[0].rgb[:24].decode("latin-1")
    for fragment in [*FORBIDDEN_FRAGMENTS, frame_bytes_sample]:
        assert fragment not in captured.out
        assert fragment not in captured.err
