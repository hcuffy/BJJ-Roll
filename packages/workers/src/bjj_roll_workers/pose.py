from collections.abc import Sequence
from typing import Protocol

from bjj_roll_workers.geometry import COCO17_KEYPOINT_NAMES, Box, InvalidCoordinateError, Keypoint, validate_point_in_frame
from bjj_roll_workers.tracker import Frame

type PoseKeypoints = tuple[Keypoint, ...]


class PoseContractError(RuntimeError):
    pass


class Pose(Protocol):
    def estimate(self, frame: Frame, box: Box) -> PoseKeypoints: ...


def check_pose_output(frame: Frame, keypoints: Sequence[Keypoint]) -> None:
    if tuple(keypoint.name for keypoint in keypoints) != COCO17_KEYPOINT_NAMES:
        raise PoseContractError("pose must be the 17 COCO keypoints in COCO order")
    for keypoint in keypoints:
        try:
            validate_point_in_frame(keypoint, frame.size)
        except InvalidCoordinateError as error:
            raise PoseContractError("keypoint is outside the frame") from error
