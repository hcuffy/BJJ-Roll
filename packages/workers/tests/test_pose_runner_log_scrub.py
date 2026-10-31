import json
import stat
from pathlib import Path

import pytest

from bjj_roll_workers.pose_config import load_pose_config
from bjj_roll_workers.pose_output import write_pose_result
from bjj_roll_workers.pose_runner import estimate_video_poses
from pose_fakes import SELF_KEYPOINT_SCORE, LabelFakePose, draw_rectangles, frame_tracks
from tracker_fakes import SELF_LABEL

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
    str(SELF_KEYPOINT_SCORE),
    "nose",
]
ALLOWED_KEYS = {"event", "jobId", "durationSeconds", "framesPerSecond", "intraOpThreads"}


def test_pose_runner_logs_no_video_bytes_urls_filenames_emails_credentials_or_keypoints(capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
    frames = [draw_rectangles(index, [(SELF_LABEL, (1, 1, 7, 9))], extra=POISON.encode()) for index in range(4)]
    tracks = {frame.frame_index: frame_tracks(frame, {"self": SELF_LABEL}) for frame in frames}
    footage_folder = tmp_path / "footage"
    footage_folder.mkdir(mode=stat.S_IRWXU)

    write_pose_result(estimate_video_poses(JOB_ID, VIDEO_ID, frames, tracks, LabelFakePose(), load_pose_config()), footage_folder)

    output = capsys.readouterr().out
    entries = [json.loads(line) for line in output.splitlines() if line]
    assert [entry["event"] for entry in entries] == ["pose_run_started", "pose_run_finished"]
    assert all(set(entry) <= ALLOWED_KEYS for entry in entries)
    assert all((entry["framesPerSecond"], entry["intraOpThreads"]) == (10, 2) for entry in entries)
    assert all(entry["jobId"] == JOB_ID for entry in entries)
    for fragment in FORBIDDEN_FRAGMENTS:
        assert fragment not in output
