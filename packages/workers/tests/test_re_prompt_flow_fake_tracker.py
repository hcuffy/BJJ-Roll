"""HEN-317: "Was this you?" re-prompt flow against a fake tracker. No Modal, SAM, network or real video; synthetic values only."""

from dataclasses import dataclass, field

import pytest

from bjj_roll_workers.geometry import FrameSize
from bjj_roll_workers.re_prompt_flow import (
    DriftEvent,
    KeepTrack,
    PromptAnswer,
    ReTap,
    TapPoint,
    VideoRePromptResult,
    VideoRun,
    count_re_prompts_by_style,
    run_re_prompt_flow,
)

FRAME_SIZE = FrameSize(width=640, height=360)
JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
FIRST_VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"
SECOND_VIDEO_ID = "7c2d4e6f-1a3b-4c5d-8e9f-0a1b2c3d4e5f"
FIRST_TAP = TapPoint(frame_index=0, x=0.4, y=0.5)
SECOND_VIDEO_FIRST_TAP = TapPoint(frame_index=3, x=0.6, y=0.2)


@dataclass
class FakeTracker:
    """Reports the scripted drifts in order and records every anchor; tracking (re)starts at each anchor's frame."""

    scripted_drifts: list[DriftEvent]
    anchors: list[TapPoint] = field(default_factory=list)
    tracked_from_frames: list[int] = field(default_factory=list)

    def anchor(self, tap: TapPoint) -> None:
        self.anchors.append(tap)
        self.tracked_from_frames.append(tap.frame_index)

    def next_drift(self) -> DriftEvent | None:
        return self.scripted_drifts.pop(0) if self.scripted_drifts else None


@dataclass
class FakeFrameSource:
    requested_frames: list[int] = field(default_factory=list)

    def frame_at(self, frame_index: int) -> bytes:
        self.requested_frames.append(frame_index)
        return f"synthetic-frame-{frame_index}".encode()


@dataclass
class ScriptedPrompter:
    """Answers each prompt with the next scripted answer and records what it was shown."""

    answers: list[PromptAnswer]
    shown: list[tuple[DriftEvent, bytes]] = field(default_factory=list)

    def ask_was_this_you(self, drift: DriftEvent, frame: bytes) -> PromptAnswer:
        self.shown.append((drift, frame))
        return self.answers.pop(0)


def _run(video: VideoRun, tracker: FakeTracker, prompter: ScriptedPrompter, frame_source: FakeFrameSource | None = None) -> VideoRePromptResult:
    return run_re_prompt_flow(JOB_ID, video, tracker, frame_source or FakeFrameSource(), prompter)


def test_re_prompt_flow_one_drift_gives_one_prompt_with_the_drift_frame() -> None:
    drift = DriftEvent(frame_index=120, reason="mask_jump")
    tracker = FakeTracker([drift])
    frame_source = FakeFrameSource()
    prompter = ScriptedPrompter([KeepTrack()])

    result = _run(VideoRun(FIRST_VIDEO_ID, "gi", FIRST_TAP, FRAME_SIZE), tracker, prompter, frame_source)

    assert prompter.shown == [(drift, b"synthetic-frame-120")]
    assert frame_source.requested_frames == [120]
    assert result.re_prompt_count == 1


def test_re_prompt_flow_yes_keeps_the_track_without_re_anchoring() -> None:
    tracker = FakeTracker([DriftEvent(frame_index=120, reason="mask_jump")])
    prompter = ScriptedPrompter([KeepTrack()])

    result = _run(VideoRun(FIRST_VIDEO_ID, "gi", FIRST_TAP, FRAME_SIZE), tracker, prompter)

    assert tracker.anchors == [FIRST_TAP]
    assert result.corrections == ()
    assert result.correction_count == 0


def test_re_prompt_flow_re_tap_re_anchors_at_the_drift_frame_and_resumes_there() -> None:
    later_drift = DriftEvent(frame_index=300, reason="mask_lost")
    tracker = FakeTracker([DriftEvent(frame_index=120, reason="mask_jump"), later_drift])
    prompter = ScriptedPrompter([ReTap(x=0.7, y=0.3), KeepTrack()])

    result = _run(VideoRun(FIRST_VIDEO_ID, "no-gi", FIRST_TAP, FRAME_SIZE), tracker, prompter)

    assert tracker.anchors == [FIRST_TAP, TapPoint(frame_index=120, x=0.7, y=0.3)]
    assert tracker.tracked_from_frames == [0, 120]
    assert prompter.shown[-1][0] == later_drift
    assert result.corrections == (TapPoint(frame_index=120, x=0.7, y=0.3),)


def test_re_prompt_flow_same_drift_reported_twice_gives_one_prompt() -> None:
    tracker = FakeTracker([DriftEvent(frame_index=120, reason="mask_jump"), DriftEvent(frame_index=120, reason="mask_jump")])
    prompter = ScriptedPrompter([ReTap(x=0.7, y=0.3), ReTap(x=0.1, y=0.1)])

    result = _run(VideoRun(FIRST_VIDEO_ID, "gi", FIRST_TAP, FRAME_SIZE), tracker, prompter)

    assert len(prompter.shown) == 1
    assert result.re_prompt_count == 1
    assert result.correction_count == 1
    assert tracker.anchors == [FIRST_TAP, TapPoint(frame_index=120, x=0.7, y=0.3)]


def test_re_prompt_flow_counts_per_video_and_per_style_for_three_drifts_over_two_videos() -> None:
    first_result = _run(
        VideoRun(FIRST_VIDEO_ID, "gi", FIRST_TAP, FRAME_SIZE),
        FakeTracker([DriftEvent(frame_index=50, reason="mask_jump"), DriftEvent(frame_index=90, reason="mask_lost")]),
        ScriptedPrompter([ReTap(x=0.2, y=0.8), KeepTrack()]),
    )
    second_result = _run(
        VideoRun(SECOND_VIDEO_ID, "no-gi", SECOND_VIDEO_FIRST_TAP, FRAME_SIZE),
        FakeTracker([DriftEvent(frame_index=40, reason="mask_jump")]),
        ScriptedPrompter([ReTap(x=0.5, y=0.5)]),
    )

    assert (first_result.video_id, first_result.style, first_result.re_prompt_count, first_result.correction_count) == (FIRST_VIDEO_ID, "gi", 2, 1)
    assert (second_result.video_id, second_result.style, second_result.re_prompt_count, second_result.correction_count) == (
        SECOND_VIDEO_ID,
        "no-gi",
        1,
        1,
    )
    counts_by_style = count_re_prompts_by_style([first_result, second_result])
    assert {style: (counts.re_prompt_count, counts.correction_count) for style, counts in counts_by_style.items()} == {"gi": (2, 1), "no-gi": (1, 1)}


def test_re_prompt_flow_second_video_starts_with_nothing_from_the_first() -> None:
    shared_prompter = ScriptedPrompter([ReTap(x=0.2, y=0.8), KeepTrack()])
    _run(VideoRun(FIRST_VIDEO_ID, "gi", FIRST_TAP, FRAME_SIZE), FakeTracker([DriftEvent(frame_index=50, reason="mask_jump")]), shared_prompter)
    second_tracker = FakeTracker([DriftEvent(frame_index=50, reason="mask_jump")])

    second_result = _run(VideoRun(SECOND_VIDEO_ID, "gi", SECOND_VIDEO_FIRST_TAP, FRAME_SIZE), second_tracker, shared_prompter)

    assert second_tracker.anchors == [SECOND_VIDEO_FIRST_TAP]
    assert second_result.re_prompt_count == 1
    assert second_result.corrections == ()


def test_re_prompt_flow_rejects_an_unknown_style() -> None:
    with pytest.raises(ValueError):
        VideoRun(FIRST_VIDEO_ID, "nogi", FIRST_TAP, FRAME_SIZE)  # type: ignore[arg-type]


def test_re_prompt_flow_counts_per_style_sum_two_videos_of_the_same_style() -> None:
    first_result = _run(
        VideoRun(FIRST_VIDEO_ID, "gi", FIRST_TAP, FRAME_SIZE),
        FakeTracker([DriftEvent(frame_index=50, reason="mask_jump"), DriftEvent(frame_index=90, reason="mask_lost")]),
        ScriptedPrompter([ReTap(x=0.2, y=0.8), KeepTrack()]),
    )
    second_result = _run(
        VideoRun(SECOND_VIDEO_ID, "gi", SECOND_VIDEO_FIRST_TAP, FRAME_SIZE),
        FakeTracker([DriftEvent(frame_index=40, reason="mask_jump")]),
        ScriptedPrompter([ReTap(x=0.5, y=0.5)]),
    )

    counts_by_style = count_re_prompts_by_style([first_result, second_result])

    assert {style: (counts.re_prompt_count, counts.correction_count) for style, counts in counts_by_style.items()} == {"gi": (3, 2)}


@dataclass
class StuckTracker:
    """Reports the same drift on every call, as a tracker stuck on one frame would; fails the test instead of hanging."""

    drift: DriftEvent
    calls: int = 0

    def anchor(self, tap: TapPoint) -> None:
        pass

    def next_drift(self) -> DriftEvent | None:
        self.calls += 1
        if self.calls > 100:
            raise AssertionError("re-prompt flow kept asking the tracker after a repeated drift frame")
        return self.drift


def test_re_prompt_flow_stops_when_the_tracker_repeats_a_drift_frame() -> None:
    tracker = StuckTracker(DriftEvent(frame_index=120, reason="mask_jump"))
    prompter = ScriptedPrompter([ReTap(x=0.7, y=0.3)])

    result = run_re_prompt_flow(JOB_ID, VideoRun(FIRST_VIDEO_ID, "gi", FIRST_TAP, FRAME_SIZE), tracker, FakeFrameSource(), prompter)

    assert tracker.calls == 2
    assert result.re_prompt_count == 1
    assert result.corrections == (TapPoint(frame_index=120, x=0.7, y=0.3),)
