import importlib
import sys
from pathlib import Path

from bjj_roll_workers.tracker import Tracker


def test_sam21_onnx_tracker_import_and_construction_load_no_model_packages(tmp_path: Path) -> None:
    for name in ("onnxruntime", "numpy"):
        sys.modules.pop(name, None)
    module = importlib.import_module("bjj_roll_workers.sam21_onnx_tracker")

    tracker: Tracker = module.Sam21OnnxTracker(weights_folder=tmp_path)

    assert tracker is not None
    assert "onnxruntime" not in sys.modules
    assert "numpy" not in sys.modules
