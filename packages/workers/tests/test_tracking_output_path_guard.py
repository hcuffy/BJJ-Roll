"""HEN-318: results are written only inside the configured footage folder (mode 700); nothing is written anywhere else."""

import os
import stat
from pathlib import Path

import pytest

from bjj_roll_workers.tracker_config import load_tracker_config
from bjj_roll_workers.tracker_runner import VideoTrackingResult, track_video
from bjj_roll_workers.tracking_output import UnsafeOutputPathError, write_tracking_result
from tracker_fakes import LabelFakeTracker, drifting_self_layout, make_clip, self_tap

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"


def _all_paths(root: Path) -> set[Path]:
    return {Path(directory) / name for directory, directories, files in os.walk(root) for name in [*directories, *files]}


def _result(video_id: str = VIDEO_ID) -> VideoTrackingResult:
    return track_video(
        JOB_ID, video_id, make_clip(20, drifting_self_layout), self_tap(0), LabelFakeTracker(), load_tracker_config(), rss_reader=lambda: 0
    )


def _footage_folder(tmp_path: Path, mode: int = stat.S_IRWXU) -> Path:
    folder = tmp_path / "footage"
    folder.mkdir()
    folder.chmod(mode)
    return folder


def test_tracking_output_writes_only_inside_the_footage_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    footage_folder = _footage_folder(tmp_path)
    working_directory = tmp_path / "cwd"
    working_directory.mkdir()
    monkeypatch.chdir(working_directory)

    written = write_tracking_result(_result(), footage_folder)

    new_paths = _all_paths(tmp_path) - {footage_folder, working_directory}
    assert new_paths and all(path.resolve().is_relative_to(footage_folder.resolve()) for path in new_paths)
    assert written in new_paths
    assert VIDEO_ID in written.name
    assert stat.S_IMODE(written.stat().st_mode) == stat.S_IRUSR | stat.S_IWUSR
    assert all(stat.S_IMODE(path.stat().st_mode) == stat.S_IRWXU for path in new_paths if path.is_dir())


@pytest.mark.parametrize("mode", [0o755, 0o750, 0o777])
def test_tracking_output_refuses_a_footage_folder_that_is_not_mode_700(tmp_path: Path, mode: int) -> None:
    footage_folder = _footage_folder(tmp_path, mode)

    with pytest.raises(UnsafeOutputPathError):
        write_tracking_result(_result(), footage_folder)
    assert _all_paths(footage_folder) == set()


def test_tracking_output_refuses_a_missing_footage_folder_and_does_not_create_it(tmp_path: Path) -> None:
    with pytest.raises(UnsafeOutputPathError):
        write_tracking_result(_result(), tmp_path / "footage")
    assert _all_paths(tmp_path) == set()


def test_tracking_output_refuses_a_video_id_that_is_not_a_uuid(tmp_path: Path) -> None:
    footage_folder = _footage_folder(tmp_path)

    with pytest.raises(UnsafeOutputPathError):
        write_tracking_result(_result("../../escaped"), footage_folder)
    assert _all_paths(tmp_path) == {footage_folder}


def test_tracking_output_refuses_a_results_folder_that_links_outside(tmp_path: Path) -> None:
    footage_folder = _footage_folder(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (footage_folder / "tracks").symlink_to(outside, target_is_directory=True)

    with pytest.raises(UnsafeOutputPathError):
        write_tracking_result(_result(), footage_folder)
    assert _all_paths(outside) == set()
