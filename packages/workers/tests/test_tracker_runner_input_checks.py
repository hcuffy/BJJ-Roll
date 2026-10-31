from collections.abc import Mapping, Sequence

import pytest

from bjj_roll_workers.geometry import InvalidCoordinateError, TapPoint
from bjj_roll_workers.tracker import Frame, Prompt, TrackedObject, TrackerContractError
from bjj_roll_workers.tracker_config import load_tracker_config
from bjj_roll_workers.tracker_runner import track_video
from tracker_fakes import LabelFakeTracker, drifting_self_layout, make_clip, partner_tap, self_tap

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"


class _ShortOutputTracker:
    def track(self, frames: Sequence[Frame], prompts: Mapping[str, Prompt]) -> list[dict[str, TrackedObject]]:
        return LabelFakeTracker().track(frames, prompts)[:-1]


def test_tracker_runner_rejects_a_partner_tap_on_another_frame() -> None:
    fake = LabelFakeTracker()

    with pytest.raises(ValueError):
        track_video(
            JOB_ID, VIDEO_ID, make_clip(20, drifting_self_layout), self_tap(0), fake, load_tracker_config(), other_taps={"partner": partner_tap(3)}
        )
    assert fake.calls == []


def test_tracker_runner_rejects_frames_that_are_not_consecutive() -> None:
    frames = make_clip(20, drifting_self_layout)
    del frames[5]

    with pytest.raises(ValueError):
        track_video(JOB_ID, VIDEO_ID, frames, self_tap(0), LabelFakeTracker(), load_tracker_config(), rss_reader=lambda: 0)


def test_tracker_runner_checks_the_backend_output_against_the_contract() -> None:
    with pytest.raises(TrackerContractError):
        track_video(
            JOB_ID, VIDEO_ID, make_clip(20, drifting_self_layout), self_tap(0), _ShortOutputTracker(), load_tracker_config(), rss_reader=lambda: 0
        )


def test_tracker_runner_never_tracks_from_a_negative_x_tap() -> None:
    fake = LabelFakeTracker()

    with pytest.raises(InvalidCoordinateError):
        track_video(JOB_ID, VIDEO_ID, make_clip(20, drifting_self_layout), TapPoint(0, -1.0, 2.0), fake, load_tracker_config(), rss_reader=lambda: 0)
    assert fake.calls == []
