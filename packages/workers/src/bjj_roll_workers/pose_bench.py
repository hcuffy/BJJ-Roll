"""Tangled-frame miss rate for the pose runner (HEN-319): how often top-down pose fails when the athletes overlap.

- Tangled frame: the user's box and another tracked athlete's box on that frame have IoU >= `TANGLED_BOX_IOU_THRESHOLD`.
  A frame where the user has no box is not tangled (that is a tracker loss, flagged by the drift detector).
- Miss on a tangled frame: the user has no pose; or the mean keypoint score is < `MIN_POSE_MEAN_SCORE`; or fewer than
  `MIN_OWN_MASK_KEYPOINT_FRACTION` of the confident keypoints (score >= `MIN_KEYPOINT_SCORE`) fall inside the user's own
  mask, i.e. the pose landed on the partner (mislabel). No confident keypoints at all is a miss.
- Miss rate = missed tangled frames / tangled frames; None when a run has no tangled frames.

The report holds counts only, never keypoints, boxes or anything about the partner (D6). Thresholds are UNTUNED (HEN-67, HEN-73).
"""

from collections.abc import Mapping
from dataclasses import dataclass

from bjj_roll_workers.geometry import box_iou
from bjj_roll_workers.pose import PoseKeypoints
from bjj_roll_workers.tracker import TrackedObject

# UNTUNED: first guesses, not tuned on real footage. HEN-67 and HEN-73 tune them with footage (DECISIONS A8).
TANGLED_BOX_IOU_THRESHOLD = 0.3
MIN_KEYPOINT_SCORE = 0.3
MIN_POSE_MEAN_SCORE = 0.3
MIN_OWN_MASK_KEYPOINT_FRACTION = 0.5


@dataclass(frozen=True)
class PoseBenchReport:
    frame_count: int
    tangled_frame_count: int
    missed_tangled_frame_count: int
    tangled_frame_miss_rate: float | None


def is_tangled(tracks: Mapping[str, TrackedObject], own_athlete_id: str) -> bool:
    own_box = tracks[own_athlete_id].box
    if own_box is None:
        return False
    return any(
        tracked.box is not None and box_iou(own_box, tracked.box) >= TANGLED_BOX_IOU_THRESHOLD
        for athlete_id, tracked in tracks.items()
        if athlete_id != own_athlete_id
    )


def is_tangled_miss(keypoints: PoseKeypoints | None, own: TrackedObject) -> bool:
    if not keypoints:
        return True
    if sum(keypoint.score for keypoint in keypoints) / len(keypoints) < MIN_POSE_MEAN_SCORE:
        return True
    confident = [keypoint for keypoint in keypoints if keypoint.score >= MIN_KEYPOINT_SCORE]
    if not confident:
        return True
    pixels = own.mask.to_pixels()
    width, height = own.mask.size.width, own.mask.size.height
    inside = sum(1 for keypoint in confident if keypoint.x < width and keypoint.y < height and pixels[int(keypoint.y) * width + int(keypoint.x)])
    return inside / len(confident) < MIN_OWN_MASK_KEYPOINT_FRACTION


def summarise_bench(frame_count: int, tangled_frame_count: int, missed_tangled_frame_count: int) -> PoseBenchReport:
    rate = missed_tangled_frame_count / tangled_frame_count if tangled_frame_count else None
    return PoseBenchReport(
        frame_count=frame_count,
        tangled_frame_count=tangled_frame_count,
        missed_tangled_frame_count=missed_tangled_frame_count,
        tangled_frame_miss_rate=rate,
    )
