"""Pose interface (HEN-319): `estimate(frame, box)` -> the 17 COCO keypoints with scores for the person in `box`.

Backends sit behind `Pose`: the local CPU RTMPose-m ONNX backend (`rtmpose_onnx_pose`) now, a Modal backend later, and a
fake model in tests. Callers (`pose_runner`) never see which one runs. `box` is a `geometry.Box` from the tracker's output
for that frame; keypoints follow `geometry` (pixels, origin top-left, x right, y down) on that frame.

Contract for `estimate`: exactly `COCO17_KEYPOINT_NAMES`, in that order, each inside the frame, score in [0, 1] (checked
by `Keypoint`). `estimate` keeps nothing between calls.
"""

from collections.abc import Sequence
from typing import Protocol

from bjj_roll_workers.geometry import COCO17_KEYPOINT_NAMES, Box, InvalidCoordinateError, Keypoint, validate_point_in_frame
from bjj_roll_workers.tracker import Frame

type PoseKeypoints = tuple[Keypoint, ...]


class PoseContractError(RuntimeError):
    pass


class Pose(Protocol):
    def estimate(self, frame: Frame, box: Box) -> PoseKeypoints:
        """Estimate one person's pose inside `box` on `frame` (see the module contract)."""
        ...


def check_pose_output(frame: Frame, keypoints: Sequence[Keypoint]) -> None:
    """Enforce the `Pose` contract on a backend's output at the boundary. Messages carry no values."""
    if tuple(keypoint.name for keypoint in keypoints) != COCO17_KEYPOINT_NAMES:
        raise PoseContractError("pose must be the 17 COCO keypoints in COCO order")
    for keypoint in keypoints:
        try:
            validate_point_in_frame(keypoint, frame.size)
        except InvalidCoordinateError as error:
            raise PoseContractError("keypoint is outside the frame") from error
