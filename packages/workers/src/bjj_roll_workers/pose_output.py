from pathlib import Path

from bjj_roll_workers.geometry import COCO17_KEYPOINT_NAMES
from bjj_roll_workers.pose_runner import VideoPoseResult
from bjj_roll_workers.tracking_output import write_result_document

POSES_FOLDER_NAME = "poses"
SKELETON_NAME = "coco17"
COORDINATE_CONVENTION = "pixels, origin top-left, x right, y down"


def _pose_document(result: VideoPoseResult) -> dict[str, object]:
    return {
        "video_id": result.video_id,
        "skeleton": SKELETON_NAME,
        "coordinates": COORDINATE_CONVENTION,
        "keypoint_names": list(COCO17_KEYPOINT_NAMES),
        "run": {"frames_per_second": result.run.frames_per_second, "intra_op_threads": result.run.intra_op_threads},
        "bench": {
            "frame_count": result.bench.frame_count,
            "tangled_frame_count": result.bench.tangled_frame_count,
            "missed_tangled_frame_count": result.bench.missed_tangled_frame_count,
            "tangled_frame_miss_rate": result.bench.tangled_frame_miss_rate,
        },
        "frames": [
            {
                "frame_index": frame.frame_index,
                "keypoints": None if frame.keypoints is None else [[keypoint.x, keypoint.y, keypoint.score] for keypoint in frame.keypoints],
            }
            for frame in result.frames
        ],
    }


def write_pose_result(result: VideoPoseResult, footage_folder: Path) -> Path:
    return write_result_document(footage_folder, POSES_FOLDER_NAME, result.video_id, _pose_document(result))
