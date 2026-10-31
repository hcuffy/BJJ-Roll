import json
import stat
from pathlib import Path

from bjj_roll_workers.geometry import COCO17_KEYPOINT_NAMES
from bjj_roll_workers.pose_config import load_pose_config
from bjj_roll_workers.pose_output import write_pose_result
from bjj_roll_workers.pose_runner import estimate_video_poses
from pose_fakes import SELF_KEYPOINT_SCORE, LabelFakePose, draw_rectangles, frame_tracks
from tracker_fakes import SELF_LABEL

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"
EXPECTED_COCO17_ORDER = (
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
)


def _moving_clip() -> list:
    return [draw_rectangles(frame_index, [(SELF_LABEL, (1 + 2 * frame_index, 2, 5 + 2 * frame_index, 8))]) for frame_index in range(5)]


def test_pose_keypoint_names_are_coco17_in_coco_order() -> None:
    assert COCO17_KEYPOINT_NAMES == EXPECTED_COCO17_ORDER


def test_pose_output_file_holds_coco17_pixel_keypoints_per_frame_index(tmp_path: Path) -> None:
    frames = _moving_clip()
    tracks = {frame.frame_index: frame_tracks(frame, {"self": SELF_LABEL}) for frame in frames[1:]}
    footage_folder = tmp_path / "footage"
    footage_folder.mkdir(mode=stat.S_IRWXU)

    result = estimate_video_poses(JOB_ID, VIDEO_ID, frames, tracks, LabelFakePose(), load_pose_config())
    document = json.loads(write_pose_result(result, footage_folder).read_text())

    assert document["skeleton"] == "coco17"
    assert document["coordinates"] == "pixels, origin top-left, x right, y down"
    assert tuple(document["keypoint_names"]) == EXPECTED_COCO17_ORDER
    assert [frame["frame_index"] for frame in document["frames"]] == [1, 2, 3, 4]
    for frame in document["frames"]:
        expected_x = 3 + 2 * frame["frame_index"]
        assert frame["keypoints"] == [[expected_x, 5.0, SELF_KEYPOINT_SCORE]] * len(EXPECTED_COCO17_ORDER)
