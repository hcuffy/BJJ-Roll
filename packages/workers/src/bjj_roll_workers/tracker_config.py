"""Tracker runner settings (HEN-318, DECISIONS.md A7), read from `tracker_config.json` next to this module.

Frames are sampled at `frames_per_second`. Videos are tracked in chunks of `chunk_seconds` that overlap by
`chunk_overlap_seconds`; once a chunk's peak RSS goes over `peak_rss_limit_bytes`, the following chunks use
`fallback_chunk_seconds`.
"""

import json
from dataclasses import dataclass, fields
from pathlib import Path

_TRACKER_CONFIG_PATH = Path(__file__).with_name("tracker_config.json")


@dataclass(frozen=True)
class TrackerConfig:
    frames_per_second: int
    chunk_seconds: int
    chunk_overlap_seconds: int
    fallback_chunk_seconds: int
    peak_rss_limit_bytes: int

    def __post_init__(self) -> None:
        for field in fields(self):
            value = getattr(self, field.name)
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise ValueError("tracker config values must be positive integers")
        if not self.chunk_overlap_seconds < self.fallback_chunk_seconds <= self.chunk_seconds:
            raise ValueError("tracker config needs overlap < fallback chunk <= chunk")

    @property
    def chunk_frames(self) -> int:
        return self.chunk_seconds * self.frames_per_second

    @property
    def fallback_chunk_frames(self) -> int:
        return self.fallback_chunk_seconds * self.frames_per_second

    @property
    def chunk_overlap_frames(self) -> int:
        return self.chunk_overlap_seconds * self.frames_per_second


def load_tracker_config(path: Path = _TRACKER_CONFIG_PATH) -> TrackerConfig:
    values = json.loads(path.read_text(encoding="utf-8"))
    expected_keys = {field.name for field in fields(TrackerConfig)}
    if not isinstance(values, dict) or set(values) != expected_keys:
        raise ValueError("tracker config keys do not match")
    return TrackerConfig(**values)
