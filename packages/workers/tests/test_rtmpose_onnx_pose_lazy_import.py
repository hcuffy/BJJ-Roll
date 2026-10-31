import importlib
import sys
from pathlib import Path

from bjj_roll_workers.pose import Pose
from bjj_roll_workers.pose_config import load_pose_config


def test_rtmpose_onnx_pose_import_and_construction_load_no_model_packages(tmp_path: Path) -> None:
    for name in ("onnxruntime", "numpy"):
        sys.modules.pop(name, None)
    module = importlib.import_module("bjj_roll_workers.rtmpose_onnx_pose")

    pose: Pose = module.RtmPoseOnnxPose(weights_file=tmp_path / "end2end.onnx", config=load_pose_config())

    assert pose is not None
    assert "onnxruntime" not in sys.modules
    assert "numpy" not in sys.modules
