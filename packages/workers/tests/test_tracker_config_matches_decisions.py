"""HEN-318: chunk length, overlap, fps, RSS limit and fallback come from config (DECISIONS.md A7), not from code."""

import json
from pathlib import Path

import pytest

from bjj_roll_workers.tracker_config import TrackerConfig, load_tracker_config

GIB = 1024**3


def test_tracker_config_holds_the_decided_values() -> None:
    config = load_tracker_config()

    assert config.frames_per_second == 10
    assert (config.chunk_frames, config.chunk_overlap_frames, config.fallback_chunk_frames) == (300, 10, 150)
    assert config.peak_rss_limit_bytes == 3 * GIB


def test_tracker_config_rejects_an_overlap_as_long_as_the_fallback_chunk(tmp_path: Path) -> None:
    config_path = tmp_path / "tracker_config.json"
    config_path.write_text(
        json.dumps(
            {"frames_per_second": 10, "chunk_seconds": 30, "chunk_overlap_seconds": 15, "fallback_chunk_seconds": 15, "peak_rss_limit_bytes": GIB}
        )
    )

    with pytest.raises(ValueError):
        load_tracker_config(config_path)


def test_tracker_config_rejects_unknown_keys(tmp_path: Path) -> None:
    config_path = tmp_path / "tracker_config.json"
    values = {"frames_per_second": 10, "chunk_seconds": 30, "chunk_overlap_seconds": 1, "fallback_chunk_seconds": 15, "peak_rss_limit_bytes": GIB}
    config_path.write_text(json.dumps({**values, "chunk_minutes": 1}))

    with pytest.raises(ValueError):
        load_tracker_config(config_path)
    assert isinstance(TrackerConfig(**values), TrackerConfig)
