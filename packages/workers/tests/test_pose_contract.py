from dataclasses import replace

import pytest

from bjj_roll_workers.geometry import COCO17_KEYPOINT_NAMES, Box, Keypoint
from bjj_roll_workers.pose import Pose, PoseContractError, check_pose_output
from pose_fakes import SELF_KEYPOINT_SCORE, LabelFakePose, draw_rectangles
from tracker_fakes import SELF_LABEL

SELF_RECTANGLE = (2, 3, 8, 11)


def test_pose_contract_fake_model_returns_seventeen_named_keypoints_inside_the_frame() -> None:
    frame = draw_rectangles(4, [(SELF_LABEL, SELF_RECTANGLE)])
    pose: Pose = LabelFakePose()

    keypoints = pose.estimate(frame, Box(2, 3, 8, 11))
    check_pose_output(frame, keypoints)

    assert tuple(keypoint.name for keypoint in keypoints) == COCO17_KEYPOINT_NAMES
    assert {(keypoint.x, keypoint.y, keypoint.score) for keypoint in keypoints} == {(5.0, 7.0, SELF_KEYPOINT_SCORE)}


def test_pose_contract_rejects_missing_keypoints() -> None:
    frame = draw_rectangles(0, [(SELF_LABEL, SELF_RECTANGLE)])
    keypoints = LabelFakePose().estimate(frame, Box(2, 3, 8, 11))

    with pytest.raises(PoseContractError):
        check_pose_output(frame, keypoints[:-1])


def test_pose_contract_rejects_keypoints_out_of_coco_order() -> None:
    frame = draw_rectangles(0, [(SELF_LABEL, SELF_RECTANGLE)])
    keypoints = LabelFakePose().estimate(frame, Box(2, 3, 8, 11))

    with pytest.raises(PoseContractError):
        check_pose_output(frame, (keypoints[1], keypoints[0], *keypoints[2:]))


def test_pose_contract_rejects_a_keypoint_outside_the_frame() -> None:
    frame = draw_rectangles(0, [(SELF_LABEL, SELF_RECTANGLE)])
    keypoints = LabelFakePose().estimate(frame, Box(2, 3, 8, 11))

    with pytest.raises(PoseContractError):
        check_pose_output(frame, (replace(keypoints[0], x=float(frame.size.width)), *keypoints[1:]))


def test_pose_contract_keypoint_rejects_unknown_names_and_scores_outside_zero_to_one() -> None:
    with pytest.raises(ValueError):
        Keypoint(name="left_big_toe", x=1.0, y=1.0, score=0.5)
    with pytest.raises(ValueError):
        Keypoint(name="nose", x=1.0, y=1.0, score=1.5)
    with pytest.raises(ValueError):
        Keypoint(name="nose", x=-1.0, y=1.0, score=0.5)
