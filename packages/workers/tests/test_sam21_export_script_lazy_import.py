import importlib
import importlib.util
import stat
import sys
from pathlib import Path
from types import ModuleType

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export_sam21_small_onnx.py"
MODEL_PACKAGES = ("torch", "sam2")


def _load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("export_sam21_small_onnx", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_sam21_export_script_imports_no_model_packages() -> None:
    loaded_before = {name for name in sys.modules if name.split(".")[0] in MODEL_PACKAGES}

    script = _load_script()

    assert {name for name in sys.modules if name.split(".")[0] in MODEL_PACKAGES} == loaded_before
    assert script.CHECKPOINT_URL == "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt"
    assert script.CHECKPOINT_LICENCE == "Apache-2.0"
    assert (script.VISION_ENCODER_FILE, script.MASK_DECODER_FILE) == ("vision_encoder.onnx", "prompt_encoder_mask_decoder.onnx")


def test_sam21_export_script_refuses_a_folder_that_is_not_mode_700_before_loading_a_model(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    script = _load_script()
    imported: list[str] = []
    monkeypatch.setattr(importlib, "import_module", lambda name, package=None: imported.append(name))
    open_folder = tmp_path / "open"
    open_folder.mkdir(mode=0o755)
    open_folder.chmod(0o755)

    assert script.main(["--checkpoint", str(tmp_path / "missing.pt"), "--output-folder", str(open_folder)]) == 1
    assert script.main(["--checkpoint", str(tmp_path / "missing.pt"), "--output-folder", str(tmp_path / "absent")]) == 1
    private_folder = tmp_path / "private"
    private_folder.mkdir(mode=stat.S_IRWXU)
    (private_folder / script.VISION_ENCODER_FILE).touch()
    assert script.main(["--checkpoint", str(tmp_path / "missing.pt"), "--output-folder", str(private_folder)]) == 1
    assert imported == []
