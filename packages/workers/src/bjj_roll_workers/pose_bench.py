from collections.abc import Mapping
from dataclasses import dataclass

from bjj_roll_workers.geometry import box_iou
from bjj_roll_workers.pose import PoseKeypoints
from bjj_roll_workers.tracker import TrackedObject

TANGLED_BOX_IOU_THRESHOLD_UNTUNED = 0.3
MIN_KEYPOINT_SCORE_UNTUNED = 0.3
MIN_POSE_MEAN_SCORE_UNTUNED = 0.3
MIN_OWN_MASK_KEYPOINT_FRACTION_UNTUNED = 0.5


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
        tracked.box is not None and box_iou(own_box, tracked.box) >= TANGLED_BOX_IOU_THRESHOLD_UNTUNED
        for athlete_id, tracked in tracks.items()
        if athlete_id != own_athlete_id
    )


def is_tangled_miss(keypoints: PoseKeypoints | None, own: TrackedObject) -> bool:
    if not keypoints:
        return True
    if sum(keypoint.score for keypoint in keypoints) / len(keypoints) < MIN_POSE_MEAN_SCORE_UNTUNED:
        return True
    confident = [keypoint for keypoint in keypoints if keypoint.score >= MIN_KEYPOINT_SCORE_UNTUNED]
    if not confident:
        return True
    pixels = own.mask.to_pixels()
    width, height = own.mask.size.width, own.mask.size.height
    inside = sum(1 for keypoint in confident if keypoint.x < width and keypoint.y < height and pixels[int(keypoint.y) * width + int(keypoint.x)])
    return inside / len(confident) < MIN_OWN_MASK_KEYPOINT_FRACTION_UNTUNED


def summarise_bench(frame_count: int, tangled_frame_count: int, missed_tangled_frame_count: int) -> PoseBenchReport:
    rate = missed_tangled_frame_count / tangled_frame_count if tangled_frame_count else None
    return PoseBenchReport(
        frame_count=frame_count,
        tangled_frame_count=tangled_frame_count,
        missed_tangled_frame_count=missed_tangled_frame_count,
        tangled_frame_miss_rate=rate,
    )
