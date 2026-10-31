import json
from dataclasses import dataclass, fields
from pathlib import Path

_POSE_CONFIG_PATH = Path(__file__).with_name("pose_config.json")


@dataclass(frozen=True)
class PoseConfig:
    frames_per_second: int
    intra_op_threads: int

    def __post_init__(self) -> None:
        for field in fields(self):
            value = getattr(self, field.name)
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise ValueError("pose config values must be positive integers")


def load_pose_config(path: Path = _POSE_CONFIG_PATH) -> PoseConfig:
    values = json.loads(path.read_text(encoding="utf-8"))
    expected_keys = {field.name for field in fields(PoseConfig)}
    if not isinstance(values, dict) or set(values) != expected_keys:
        raise ValueError("pose config keys do not match")
    return PoseConfig(**values)
