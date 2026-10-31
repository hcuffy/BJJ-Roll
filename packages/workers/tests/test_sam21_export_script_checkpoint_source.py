"""HEN-351: the export script fetches only Meta's recorded Apache-2.0 SAM 2.1 small checkpoint into the mode-700 folder and refuses
any other source, such as the onnx-community export. The fetch is always mocked; nothing is downloaded here."""

import importlib.util
import stat
import urllib.request
from collections.abc import Iterator
from io import BytesIO
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export_sam21_small_onnx.py"
META_CHECKPOINT_URL = "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt"
ONNX_COMMUNITY_URL = "https://huggingface.co/onnx-community/sam2.1-hiera-small-ONNX/resolve/main/onnx/vision_encoder.onnx"
FAKE_CHECKPOINT = b"synthetic checkpoint bytes, not a model"


def _load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("export_sam21_small_onnx", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*args: object, **kwargs: object) -> None:
        raise AssertionError("tests must not open the network")

    monkeypatch.setattr(urllib.request, "urlopen", refuse)


def _private_folder(tmp_path: Path) -> Path:
    folder = tmp_path / "sam21-onnx"
    folder.mkdir(mode=stat.S_IRWXU)
    return folder


def test_sam21_export_script_fetches_the_meta_checkpoint_into_the_private_folder(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    script = _load_script()
    requested: list[str] = []

    def fake_urlopen(url: str, timeout: float) -> BytesIO:
        requested.append(url)
        return BytesIO(FAKE_CHECKPOINT)

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    folder = _private_folder(tmp_path)

    checkpoint = script.download_checkpoint(folder)

    assert requested == [META_CHECKPOINT_URL]
    assert (script.META_CHECKPOINT.url, script.META_CHECKPOINT.licence) == (META_CHECKPOINT_URL, "Apache-2.0")
    assert checkpoint == folder / "sam2.1_hiera_small.pt"
    assert checkpoint.read_bytes() == FAKE_CHECKPOINT
    assert stat.S_IMODE(checkpoint.stat().st_mode) == stat.S_IRUSR | stat.S_IWUSR


def test_sam21_export_script_refuses_the_onnx_community_export_and_other_licences(tmp_path: Path) -> None:
    script = _load_script()
    fetched: list[str] = []

    def fake_fetch(url: str) -> Iterator[bytes]:
        fetched.append(url)
        yield FAKE_CHECKPOINT

    folder = _private_folder(tmp_path)
    refused_sources = [
        script.CheckpointSource(url=ONNX_COMMUNITY_URL, licence="Apache-2.0"),
        script.CheckpointSource(url=META_CHECKPOINT_URL.replace("https://", "http://"), licence="Apache-2.0"),
        script.CheckpointSource(url=META_CHECKPOINT_URL, licence="MIT"),
        script.CheckpointSource(url=META_CHECKPOINT_URL, licence=""),
    ]

    for source in refused_sources:
        with pytest.raises(script.CheckpointError):
            script.download_checkpoint(folder, source, fake_fetch)

    assert fetched == []
    assert list(folder.iterdir()) == []


def test_sam21_export_script_fetches_nothing_into_a_folder_that_is_not_mode_700(tmp_path: Path) -> None:
    script = _load_script()
    fetched: list[str] = []
    open_folder = tmp_path / "open"
    open_folder.mkdir()
    open_folder.chmod(0o755)

    with pytest.raises(script.ExportFolderError):
        script.download_checkpoint(open_folder, script.META_CHECKPOINT, lambda url: fetched.append(url) or iter(()))

    assert fetched == []
    assert list(open_folder.iterdir()) == []


def test_sam21_export_script_removes_a_partial_checkpoint_when_the_fetch_fails(tmp_path: Path) -> None:
    script = _load_script()

    def failing_fetch(url: str) -> Iterator[bytes]:
        yield FAKE_CHECKPOINT[:8]
        raise OSError("connection reset")

    folder = _private_folder(tmp_path)

    with pytest.raises(script.CheckpointError):
        script.download_checkpoint(folder, script.META_CHECKPOINT, failing_fetch)

    assert list(folder.iterdir()) == []
