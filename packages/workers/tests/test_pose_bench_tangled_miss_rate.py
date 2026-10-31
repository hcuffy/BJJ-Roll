from dataclasses import replace

from bjj_roll_workers.geometry import COCO17_KEYPOINT_NAMES, Box, Keypoint, box_iou
from bjj_roll_workers.pose_bench import (
    MIN_KEYPOINT_SCORE,
    MIN_OWN_MASK_KEYPOINT_FRACTION,
    MIN_POSE_MEAN_SCORE,
    TANGLED_BOX_IOU_THRESHOLD,
    is_tangled,
    is_tangled_miss,
    summarise_bench,
)
from bjj_roll_workers.pose_config import load_pose_config
from bjj_roll_workers.pose_runner import estimate_video_poses
from pose_fakes import LabelFakePose, draw_rectangles, frame_tracks, tracked_label
from tracker_fakes import PARTNER_LABEL, SELF_LABEL

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"
SELF_RECTANGLE = (2, 2, 10, 10)


def _pose_at(x: float, y: float, score: float) -> tuple[Keypoint, ...]:
    return tuple(Keypoint(name=name, x=x, y=y, score=score) for name in COCO17_KEYPOINT_NAMES)


def test_pose_bench_rule_constants_are_named() -> None:
    assert (TANGLED_BOX_IOU_THRESHOLD, MIN_KEYPOINT_SCORE, MIN_POSE_MEAN_SCORE, MIN_OWN_MASK_KEYPOINT_FRACTION) == (0.3, 0.3, 0.3, 0.5)


def test_pose_bench_box_iou() -> None:
    assert box_iou(Box(0, 0, 4, 4), Box(2, 0, 6, 4)) == 8 / 24
    assert box_iou(Box(0, 0, 2, 2), Box(5, 5, 6, 6)) == 0.0


def test_pose_bench_tangled_needs_box_overlap_at_the_threshold() -> None:
    apart = draw_rectangles(0, [(SELF_LABEL, (1, 1, 5, 5)), (PARTNER_LABEL, (12, 8, 16, 12))])
    wrapped = draw_rectangles(0, [(SELF_LABEL, SELF_RECTANGLE), (PARTNER_LABEL, (3, 3, 9, 9))])

    assert not is_tangled(frame_tracks(apart, {"self": SELF_LABEL, "partner": PARTNER_LABEL}), "self")
    assert is_tangled(frame_tracks(wrapped, {"self": SELF_LABEL, "partner": PARTNER_LABEL}), "self")
    assert not is_tangled(frame_tracks(wrapped, {"self": SELF_LABEL}), "self")


def test_pose_bench_iou_exactly_at_the_threshold_is_tangled() -> None:
    frame = draw_rectangles(0, [(SELF_LABEL, SELF_RECTANGLE), (PARTNER_LABEL, (3, 3, 9, 9))])
    tracks = frame_tracks(frame, {"self": SELF_LABEL, "partner": PARTNER_LABEL})
    own_box, partner_box = Box(0, 0, 10, 10), Box(0, 0, 10, 3)
    at_threshold = {"self": replace(tracks["self"], box=own_box), "partner": replace(tracks["partner"], box=partner_box)}
    below = {"self": replace(tracks["self"], box=own_box), "partner": replace(tracks["partner"], box=Box(0, 0, 10, 2.9))}

    assert box_iou(own_box, partner_box) == TANGLED_BOX_IOU_THRESHOLD
    assert is_tangled(at_threshold, "self")
    assert not is_tangled(below, "self")


def test_pose_bench_counts_a_pose_on_the_partner_a_low_score_or_no_pose_as_a_miss() -> None:
    frame = draw_rectangles(0, [(SELF_LABEL, SELF_RECTANGLE), (PARTNER_LABEL, (3, 3, 9, 9))])
    own = tracked_label(frame, SELF_LABEL)

    assert not is_tangled_miss(_pose_at(2.5, 2.5, 0.9), own)
    assert is_tangled_miss(_pose_at(5.5, 5.5, 0.9), own)
    assert is_tangled_miss(_pose_at(2.5, 2.5, MIN_POSE_MEAN_SCORE / 2), own)
    assert is_tangled_miss(None, own)


def test_pose_bench_report_records_the_tangled_frame_miss_rate_of_a_run() -> None:
    apart = [draw_rectangles(index, [(SELF_LABEL, (1, 1, 7, 9)), (PARTNER_LABEL, (14, 6, 21, 13))]) for index in range(6)]
    tangled = [draw_rectangles(index, [(SELF_LABEL, SELF_RECTANGLE), (PARTNER_LABEL, (3, 3, 9, 9))]) for index in range(6, 10)]
    frames = apart + tangled
    tracks = {frame.frame_index: frame_tracks(frame, {"self": SELF_LABEL, "partner": PARTNER_LABEL}) for frame in frames}

    result = estimate_video_poses(JOB_ID, VIDEO_ID, frames, tracks, LabelFakePose(), load_pose_config())

    assert (result.bench.frame_count, result.bench.tangled_frame_count, result.bench.missed_tangled_frame_count) == (10, 4, 4)
    assert result.bench.tangled_frame_miss_rate == 1.0


def test_pose_bench_miss_rate_is_none_without_tangled_frames() -> None:
    report = summarise_bench(frame_count=5, tangled_frame_count=0, missed_tangled_frame_count=0)

    assert report.tangled_frame_miss_rate is None
