import os
import stat
from pathlib import Path

import pytest

from bjj_roll_workers.pose_config import load_pose_config
from bjj_roll_workers.pose_output import write_pose_result
from bjj_roll_workers.pose_runner import VideoPoseResult, estimate_video_poses
from bjj_roll_workers.tracking_output import UnsafeOutputPathError
from pose_fakes import LabelFakePose, draw_rectangles, frame_tracks
from tracker_fakes import SELF_LABEL

VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"


def _result(video_id: str = VIDEO_ID) -> VideoPoseResult:
    frames = [draw_rectangles(index, [(SELF_LABEL, (1, 1, 5, 5))]) for index in range(3)]
    tracks = {frame.frame_index: frame_tracks(frame, {"self": SELF_LABEL}) for frame in frames}
    return estimate_video_poses("job", video_id, frames, tracks, LabelFakePose(), load_pose_config())


def _all_paths(root: Path) -> set[Path]:
    return {Path(directory) / name for directory, directories, files in os.walk(root) for name in [*directories, *files]}


def test_pose_output_writes_only_inside_the_footage_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    footage_folder = tmp_path / "footage"
    footage_folder.mkdir(mode=stat.S_IRWXU)
    monkeypatch.chdir(footage_folder.parent)

    written = write_pose_result(_result(), footage_folder)

    assert written == footage_folder.resolve() / "poses" / f"{VIDEO_ID}.json"
    assert _all_paths(tmp_path) == {footage_folder, footage_folder / "poses", footage_folder / "poses" / f"{VIDEO_ID}.json"}
    assert stat.S_IMODE(written.stat().st_mode) == stat.S_IRUSR | stat.S_IWUSR
    assert stat.S_IMODE((footage_folder / "poses").stat().st_mode) == stat.S_IRWXU


@pytest.mark.parametrize("mode", [0o755, 0o750, 0o777])
def test_pose_output_refuses_a_footage_folder_that_is_not_mode_700(tmp_path: Path, mode: int) -> None:
    footage_folder = tmp_path / "footage"
    footage_folder.mkdir()
    footage_folder.chmod(mode)

    with pytest.raises(UnsafeOutputPathError):
        write_pose_result(_result(), footage_folder)
    assert _all_paths(footage_folder) == set()


def test_pose_output_refuses_a_video_id_that_is_not_a_uuid(tmp_path: Path) -> None:
    footage_folder = tmp_path / "footage"
    footage_folder.mkdir(mode=stat.S_IRWXU)

    with pytest.raises(UnsafeOutputPathError):
        write_pose_result(_result("../roll.mov"), footage_folder)
    assert _all_paths(tmp_path) == {footage_folder}
