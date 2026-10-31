import importlib.util
import logging
import stat
import urllib.request
from io import BytesIO
from pathlib import Path
from types import ModuleType

import pytest

from bjj_roll_workers.frame_sampler import sample_frames
from bjj_roll_workers.tracker import Frame
from bjj_roll_workers.tracker_config import load_tracker_config
from bjj_roll_workers.tracker_runner import track_video
from tracker_fakes import FRAME_SIZE, LabelFakeTracker, draw_frame, self_tap

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export_sam21_small_onnx.py"
JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"
EXAMPLE_DOMAIN = "example.invalid"
SYNTHETIC_EMAIL = f"athlete@{EXAMPLE_DOMAIN}"
SYNTHETIC_TOKEN = f"synthetic-bearer-{EXAMPLE_DOMAIN}-0123456789"
SYNTHETIC_SECRET = f"synthetic-modal-{EXAMPLE_DOMAIN}-secret"
SIGNED_URL = f"https://storage.{EXAMPLE_DOMAIN}/videos/{VIDEO_ID}/source.mp4?X-Amz-Credential=synthetic&X-Amz-Signature=synthetic0signature"
UPLOADED_FILENAME = "open-mat-roll-IMG_4412.MOV"
POISON = f"{SIGNED_URL} {UPLOADED_FILENAME} {SYNTHETIC_EMAIL} {SYNTHETIC_TOKEN} {SYNTHETIC_SECRET}"


def _load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("export_sam21_small_onnx", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _poisoned_clip(frame_count: int) -> list[Frame]:
    return [draw_frame(index, FRAME_SIZE, {1: (1, 1)}, extra=POISON.encode()) for index in range(frame_count)]


def test_frame_sampler_and_checkpoint_fetch_log_no_footage_or_credentials(
    capsys: pytest.CaptureFixture[str], caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    caplog.set_level(logging.DEBUG)
    script = _load_script()
    footage_folder = tmp_path / "footage" / UPLOADED_FILENAME
    footage_folder.mkdir(parents=True)
    footage_folder.chmod(stat.S_IRWXU)

    def leaking_urlopen(url: str, timeout: float) -> BytesIO:
        raise OSError(f"{SIGNED_URL} {SYNTHETIC_TOKEN} {SYNTHETIC_SECRET} {footage_folder}")

    monkeypatch.setattr(urllib.request, "urlopen", leaking_urlopen)

    clip = sample_frames(_poisoned_clip(30), 30, load_tracker_config().frames_per_second)
    track_video(
        JOB_ID, VIDEO_ID, clip.frames, self_tap(0, lambda index: {1: (1, 1)}), LabelFakeTracker(), load_tracker_config(), rss_reader=lambda: 0
    )
    exit_code = script.main(["--output-folder", str(footage_folder)])
    with pytest.raises(script.CheckpointError) as refused:
        script.download_checkpoint(footage_folder, script.CheckpointSource(url=SIGNED_URL, licence=SYNTHETIC_SECRET))

    captured = capsys.readouterr()
    logged = f"{captured.out}{captured.err}{caplog.text}{refused.value}"
    assert exit_code == 1
    assert captured.err
    assert list(footage_folder.iterdir()) == []
    frame_bytes_sample = clip.frames[0].rgb[:24].decode("latin-1")
    for fragment in [
        SIGNED_URL,
        "X-Amz-",
        "https://",
        UPLOADED_FILENAME,
        SYNTHETIC_EMAIL,
        SYNTHETIC_TOKEN,
        SYNTHETIC_SECRET,
        str(tmp_path),
        frame_bytes_sample,
    ]:
        assert fragment not in logged
