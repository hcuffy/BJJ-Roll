import json
from pathlib import Path

import pytest

from bjj_roll_workers.pose_config import load_pose_config
from bjj_roll_workers.pose_runner import estimate_video_poses
from bjj_roll_workers.tracker_config import load_tracker_config
from pose_fakes import LabelFakePose, draw_rectangles, frame_tracks
from tracker_fakes import SELF_LABEL


def test_pose_config_holds_the_decided_values_and_matches_the_tracker_fps() -> None:
    config = load_pose_config()

    assert (config.frames_per_second, config.intra_op_threads) == (10, 2)
    assert config.frames_per_second == load_tracker_config().frames_per_second


def test_pose_config_rejects_unknown_keys_and_zero_threads(tmp_path: Path) -> None:
    config_path = tmp_path / "pose_config.json"
    config_path.write_text(json.dumps({"frames_per_second": 10, "intra_op_threads": 0}))
    with pytest.raises(ValueError):
        load_pose_config(config_path)
    config_path.write_text(json.dumps({"frames_per_second": 10, "intra_op_threads": 2, "weights": "x"}))
    with pytest.raises(ValueError):
        load_pose_config(config_path)


def test_pose_runner_reports_fps_and_threads_with_the_run() -> None:
    frames = [draw_rectangles(0, [(SELF_LABEL, (1, 1, 5, 5))])]

    result = estimate_video_poses(
        "job", "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f", frames, {0: frame_tracks(frames[0], {"self": SELF_LABEL})}, LabelFakePose(), load_pose_config()
    )

    assert (result.run.frames_per_second, result.run.intra_op_threads) == (10, 2)
