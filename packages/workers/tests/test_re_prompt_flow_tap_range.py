import math
from dataclasses import dataclass, field

import pytest

from bjj_roll_workers.geometry import FrameSize, InvalidCoordinateError, TapPoint
from bjj_roll_workers.re_prompt_flow import DriftEvent, PromptAnswer, ReTap, VideoRun, run_re_prompt_flow

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"
FRAME_SIZE = FrameSize(width=640, height=360)
FIRST_TAP = TapPoint(frame_index=0, x=320.0, y=180.0)
DRIFT = DriftEvent(frame_index=120, reason="mask_jump")


@dataclass
class RecordingTracker:
    drifts: list[DriftEvent]
    anchors: list[TapPoint] = field(default_factory=list)

    def anchor(self, tap: TapPoint) -> None:
        self.anchors.append(tap)

    def next_drift(self) -> DriftEvent | None:
        return self.drifts.pop(0) if self.drifts else None


class BlankFrameSource:
    def frame_at(self, frame_index: int) -> bytes:
        return b""


@dataclass
class OneAnswerPrompter:
    answer: PromptAnswer

    def ask_was_this_you(self, drift: DriftEvent, frame: bytes) -> PromptAnswer:
        return self.answer


def _run_with_re_tap(x: float, y: float) -> RecordingTracker:
    tracker = RecordingTracker([DRIFT])
    run_re_prompt_flow(JOB_ID, VideoRun(VIDEO_ID, "gi", FIRST_TAP, FRAME_SIZE), tracker, BlankFrameSource(), OneAnswerPrompter(ReTap(x=x, y=y)))
    return tracker


@pytest.mark.parametrize(("x", "y"), [(0.0, 0.0), (320.0, 180.0), (639.0, 359.0), (639.99, 359.99)])
def test_re_prompt_flow_in_range_and_edge_re_taps_reach_the_tracker(x: float, y: float) -> None:
    tracker = _run_with_re_tap(x, y)

    assert tracker.anchors == [FIRST_TAP, TapPoint(frame_index=DRIFT.frame_index, x=x, y=y)]


@pytest.mark.parametrize(
    ("x", "y"),
    [(640.0, 10.0), (10.0, 360.0), (900.0, 900.0), (-1.0, 10.0), (10.0, -0.5), (math.nan, 10.0), (10.0, math.nan), (math.inf, 10.0)],
)
def test_re_prompt_flow_out_of_range_or_non_finite_re_tap_is_rejected_before_the_tracker(x: float, y: float) -> None:
    tracker = RecordingTracker([DRIFT])

    with pytest.raises(InvalidCoordinateError) as rejected:
        run_re_prompt_flow(JOB_ID, VideoRun(VIDEO_ID, "gi", FIRST_TAP, FRAME_SIZE), tracker, BlankFrameSource(), OneAnswerPrompter(ReTap(x=x, y=y)))

    assert tracker.anchors == [FIRST_TAP]
    assert str(x) not in str(rejected.value)
    assert str(y) not in str(rejected.value)


@pytest.mark.parametrize("first_tap", [TapPoint(frame_index=0, x=640.0, y=10.0), TapPoint(frame_index=0, x=10.0, y=360.0)])
def test_re_prompt_flow_first_tap_outside_the_frame_is_rejected_when_the_run_is_built(first_tap: TapPoint) -> None:
    with pytest.raises(InvalidCoordinateError):
        VideoRun(VIDEO_ID, "gi", first_tap, FRAME_SIZE)
