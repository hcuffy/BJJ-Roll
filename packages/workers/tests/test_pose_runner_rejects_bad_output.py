from dataclasses import dataclass

import pytest

from bjj_roll_workers.geometry import COCO17_KEYPOINT_NAMES, Box, Keypoint
from bjj_roll_workers.pose import PoseContractError
from bjj_roll_workers.pose_config import load_pose_config
from bjj_roll_workers.pose_runner import estimate_video_poses
from bjj_roll_workers.tracker import Frame
from pose_fakes import draw_rectangles, frame_tracks
from tracker_fakes import SELF_LABEL

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"


@dataclass
class OutsideFramePose:
    def estimate(self, frame: Frame, box: Box) -> tuple[Keypoint, ...]:
        return tuple(Keypoint(name=name, x=float(frame.size.width), y=box.y_min, score=0.9) for name in COCO17_KEYPOINT_NAMES)


@dataclass
class ShortPose:
    def estimate(self, frame: Frame, box: Box) -> tuple[Keypoint, ...]:
        return tuple(Keypoint(name=name, x=box.x_min, y=box.y_min, score=0.9) for name in COCO17_KEYPOINT_NAMES[:-1])


@pytest.mark.parametrize("pose", [OutsideFramePose(), ShortPose()], ids=["outside_frame", "missing_keypoint"])
def test_pose_runner_fails_the_run_on_bad_backend_output_instead_of_storing_it(pose: OutsideFramePose | ShortPose) -> None:
    frames = [draw_rectangles(frame_index, [(SELF_LABEL, (2, 3, 8, 11))]) for frame_index in range(3)]
    tracks = {frame.frame_index: frame_tracks(frame, {"self": SELF_LABEL}) for frame in frames}

    with pytest.raises(PoseContractError):
        estimate_video_poses(JOB_ID, VIDEO_ID, frames, tracks, pose, load_pose_config())
