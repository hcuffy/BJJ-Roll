"""HEN-318: peak RSS is logged per chunk; above the limit (3 GiB) the next chunks drop to 15 s. RSS is faked."""

import json

import pytest

from bjj_roll_workers.tracker_config import load_tracker_config
from bjj_roll_workers.tracker_runner import track_video
from tracker_fakes import LabelFakeTracker, drifting_self_layout, make_clip, self_tap

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"
GIB = 1024**3


def _log_entries(output: str) -> list[dict[str, object]]:
    return [json.loads(line) for line in output.splitlines() if line]


def test_tracker_runner_drops_to_fifteen_second_chunks_after_peak_rss_goes_over_the_limit(capsys: pytest.CaptureFixture[str]) -> None:
    frames = make_clip(900, drifting_self_layout)
    fake = LabelFakeTracker()
    readings = iter([1 * GIB, 3 * GIB + 1, 3 * GIB + 1, 3 * GIB + 1, 3 * GIB + 1])

    result = track_video(JOB_ID, VIDEO_ID, frames, self_tap(0), fake, load_tracker_config(), rss_reader=lambda: next(readings))

    assert [(call.first_frame_index, call.last_frame_index) for call in fake.calls] == [(0, 299), (290, 589), (580, 729), (720, 869), (860, 899)]
    assert [tracked.frame_index for tracked in result.frames] == list(range(900))
    entries = _log_entries(capsys.readouterr().out)
    chunk_entries = [entry for entry in entries if entry["event"] == "tracker_chunk_finished"]
    assert [entry["peakRssBytes"] for entry in chunk_entries] == [1 * GIB] + [3 * GIB + 1] * 4
    fallback_entries = [entry for entry in entries if entry["event"] == "tracker_chunk_length_fallback"]
    assert fallback_entries == [{"event": "tracker_chunk_length_fallback", "jobId": JOB_ID, "chunkIndex": 1, "chunkFrames": 150}]


def test_tracker_runner_keeps_thirty_second_chunks_at_exactly_the_limit() -> None:
    frames = make_clip(900, drifting_self_layout)
    fake = LabelFakeTracker()

    track_video(JOB_ID, VIDEO_ID, frames, self_tap(0), fake, load_tracker_config(), rss_reader=lambda: 3 * GIB)

    assert [(call.first_frame_index, call.last_frame_index) for call in fake.calls] == [(0, 299), (290, 589), (580, 879), (870, 899)]
