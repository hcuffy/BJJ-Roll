"""Writes a video's tracking result (HEN-318) inside the configured footage folder only.

The footage folder must already exist with mode 700; it is never created here. The result goes to
`<footage folder>/tracks/<video id>.json` (folder mode 700, file mode 600). The video ID must be a UUID, never a filename,
and the resolved path must stay inside the footage folder (no `..`, no symlink out). Only the user's own track and its drift
events are written (D6). Nothing is logged.
"""

import json
import os
import re
import stat
from pathlib import Path

from bjj_roll_workers.tracker_runner import VideoTrackingResult

FOOTAGE_FOLDER_MODE = stat.S_IRWXU
RESULT_FILE_MODE = stat.S_IRUSR | stat.S_IWUSR
TRACKS_FOLDER_NAME = "tracks"
_UUID_PATTERN = re.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)


class UnsafeOutputPathError(RuntimeError):
    pass


def _result_document(result: VideoTrackingResult) -> dict[str, object]:
    return {
        "video_id": result.video_id,
        "frames": [
            {
                "frame_index": tracked.frame_index,
                "box": None if (box := tracked.tracked.box) is None else [box.x_min, box.y_min, box.x_max, box.y_max],
                "score": tracked.tracked.score,
                "mask": {
                    "width": tracked.tracked.mask.size.width,
                    "height": tracked.tracked.mask.size.height,
                    "runs": list(tracked.tracked.mask.runs),
                },
            }
            for tracked in result.frames
        ],
        "drift_events": [{"frame_index": drift.frame_index, "reason": drift.reason} for drift in result.drift_events],
    }


def write_tracking_result(result: VideoTrackingResult, footage_folder: Path) -> Path:
    if not _UUID_PATTERN.fullmatch(result.video_id):
        raise UnsafeOutputPathError("video id must be a UUID")
    if not footage_folder.is_dir() or footage_folder.is_symlink():
        raise UnsafeOutputPathError("footage folder must be an existing folder")
    if stat.S_IMODE(footage_folder.stat().st_mode) != FOOTAGE_FOLDER_MODE:
        raise UnsafeOutputPathError("footage folder must have mode 700")
    root = footage_folder.resolve(strict=True)
    tracks_folder = root / TRACKS_FOLDER_NAME
    target = tracks_folder / f"{result.video_id}.json"
    if not target.resolve().is_relative_to(root) or tracks_folder.is_symlink():
        raise UnsafeOutputPathError("result path must stay inside the footage folder")
    tracks_folder.mkdir(mode=FOOTAGE_FOLDER_MODE, exist_ok=True)
    file_descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, RESULT_FILE_MODE)
    with os.fdopen(file_descriptor, "w", encoding="utf-8") as output:
        json.dump(_result_document(result), output)
    return target
