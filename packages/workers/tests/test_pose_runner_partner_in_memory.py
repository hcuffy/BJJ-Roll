"""HEN-319 / D6: the partner's pose is estimated in memory only. After a run on a two-person clip, no partner keypoint is in
the result, on disk or in the logs."""

import json
import os
import stat
from pathlib import Path

import pytest

from bjj_roll_workers.pose_config import load_pose_config
from bjj_roll_workers.pose_output import write_pose_result
from bjj_roll_workers.pose_runner import estimate_video_poses
from pose_fakes import PARTNER_KEYPOINT_SCORE, SELF_KEYPOINT_SCORE, LabelFakePose, draw_rectangles, frame_tracks
from tracker_fakes import PARTNER_LABEL, SELF_LABEL

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"
PARTNER_CENTRE_X = 17.5
PARTNER_CENTRE_Y = 9.5


def _two_person_clip() -> list:
    return [draw_rectangles(frame_index, [(SELF_LABEL, (1, 1, 7, 9)), (PARTNER_LABEL, (14, 6, 21, 13))]) for frame_index in range(6)]


def test_pose_runner_estimates_the_partner_in_memory_but_stores_only_the_user(capsys: pytest.CaptureFixture[str], tmp_path: Path) -> None:
    frames = _two_person_clip()
    tracks = {frame.frame_index: frame_tracks(frame, {"self": SELF_LABEL, "partner": PARTNER_LABEL}) for frame in frames}
    footage_folder = tmp_path / "footage"
    footage_folder.mkdir(mode=stat.S_IRWXU)
    pose = LabelFakePose()

    result = estimate_video_poses(JOB_ID, VIDEO_ID, frames, tracks, pose, load_pose_config())
    written = write_pose_result(result, footage_folder)

    assert len(pose.calls) == 2 * len(frames)
    assert all(keypoint.score == SELF_KEYPOINT_SCORE for frame in result.frames for keypoint in frame.keypoints or ())
    assert all(keypoint.x != PARTNER_CENTRE_X for frame in result.frames for keypoint in frame.keypoints or ())
    files = [Path(directory) / name for directory, _, names in os.walk(tmp_path) for name in names]
    assert files == [written]
    stored = written.read_text()
    assert str(PARTNER_KEYPOINT_SCORE) not in stored
    assert str(PARTNER_CENTRE_X) not in stored
    assert str(PARTNER_CENTRE_Y) not in stored
    assert "partner" not in stored
    logs = capsys.readouterr().out
    assert str(PARTNER_KEYPOINT_SCORE) not in logs
    assert str(PARTNER_CENTRE_X) not in logs
    assert {entry["event"] for entry in map(json.loads, logs.splitlines())} == {"pose_run_started", "pose_run_finished"}


def test_pose_runner_requires_the_users_own_track() -> None:
    frames = _two_person_clip()
    tracks = {frame.frame_index: frame_tracks(frame, {"partner": PARTNER_LABEL}) for frame in frames}

    with pytest.raises(ValueError):
        estimate_video_poses(JOB_ID, VIDEO_ID, frames, tracks, LabelFakePose(), load_pose_config())
