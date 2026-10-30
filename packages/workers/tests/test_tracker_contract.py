"""HEN-318: the Tracker contract (`track(frames, prompts)` -> per frame `{athlete_id: {mask, box, score}}`), checked on the fake
model, plus the adapter that lets the HEN-317 re-prompt flow drive the chunked runner. Synthetic data only."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

import pytest

from bjj_roll_workers.geometry import TapPoint
from bjj_roll_workers.re_prompt_flow import DriftEvent, KeepTrack, PromptAnswer, ReTap, VideoRun, run_re_prompt_flow
from bjj_roll_workers.tracker import Frame, Prompt, TrackedObject, Tracker, TrackerContractError, check_track_output
from bjj_roll_workers.tracker_config import load_tracker_config
from bjj_roll_workers.tracker_runner import RePromptTrackerAdapter
from tracker_fakes import FRAME_SIZE, SELF_LABEL, LabelFakeTracker, label_box, label_mask, make_clip, self_tap

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"
JUMP_FRAME = 120


def _jumping_layout(frame_index: int) -> dict[int, tuple[int, int]]:
    return {SELF_LABEL: (1, 1) if frame_index < JUMP_FRAME else (11, 8)}


def test_tracker_contract_fake_model_returns_one_entry_per_frame_with_mask_box_and_score() -> None:
    frames = make_clip(12, _jumping_layout)
    tracker: Tracker = LabelFakeTracker()
    prompts: dict[str, Prompt] = {"self": self_tap(0, _jumping_layout)}

    output = tracker.track(frames, prompts)

    check_track_output(frames, prompts, output)
    assert len(output) == len(frames)
    for frame, tracks in zip(frames, output, strict=True):
        tracked = tracks["self"]
        assert tracked.mask == label_mask(frame, SELF_LABEL)
        assert tracked.box == label_box(frame, SELF_LABEL)
        assert 0.0 <= tracked.score <= 1.0


@dataclass
class _ShortOutputTracker:
    def track(self, frames: Sequence[Frame], prompts: Mapping[str, Prompt]) -> list[dict[str, TrackedObject]]:
        return LabelFakeTracker().track(frames, prompts)[:-1]


@dataclass
class _ExtraAthleteTracker:
    def track(self, frames: Sequence[Frame], prompts: Mapping[str, Prompt]) -> list[dict[str, TrackedObject]]:
        output = LabelFakeTracker().track(frames, prompts)
        return [{**tracks, "bystander": tracks["self"]} for tracks in output]


@pytest.mark.parametrize("broken_tracker", [_ShortOutputTracker(), _ExtraAthleteTracker()])
def test_tracker_contract_rejects_output_that_breaks_the_contract(broken_tracker: Tracker) -> None:
    frames = make_clip(5, _jumping_layout)
    prompts: dict[str, Prompt] = {"self": self_tap(0, _jumping_layout)}

    with pytest.raises(TrackerContractError):
        check_track_output(frames, prompts, broken_tracker.track(frames, prompts))


@dataclass
class _ScriptedPrompter:
    answers: list[PromptAnswer]
    shown: list[DriftEvent] = field(default_factory=list)

    def ask_was_this_you(self, drift: DriftEvent, frame: bytes) -> PromptAnswer:
        self.shown.append(drift)
        return self.answers.pop(0)


@dataclass
class _ClipFrameSource:
    frames: list[Frame]

    def frame_at(self, frame_index: int) -> bytes:
        return self.frames[frame_index].rgb


def test_tracker_contract_adapter_lets_the_re_prompt_flow_drive_the_runner() -> None:
    frames = make_clip(200, _jumping_layout)
    fake = LabelFakeTracker()
    adapter = RePromptTrackerAdapter(JOB_ID, VIDEO_ID, frames, fake, load_tracker_config(), rss_reader=lambda: 0)
    re_tap = ReTap(x=12.5, y=9.5)
    prompter = _ScriptedPrompter([re_tap])

    flow_result = run_re_prompt_flow(JOB_ID, VideoRun(VIDEO_ID, "gi", self_tap(0, _jumping_layout)), adapter, _ClipFrameSource(frames), prompter)

    assert prompter.shown == [DriftEvent(frame_index=JUMP_FRAME, reason="mask_jump")]
    assert fake.calls[-1].prompts == {"self": TapPoint(frame_index=JUMP_FRAME, x=re_tap.x, y=re_tap.y)}
    assert flow_result.correction_count == 1
    tracking = adapter.result()
    assert [tracked.frame_index for tracked in tracking.frames] == list(range(200))
    assert all(tracked.tracked.mask == label_mask(frames[tracked.frame_index], SELF_LABEL) for tracked in tracking.frames)
    assert tracking.drift_events == (DriftEvent(frame_index=JUMP_FRAME, reason="mask_jump"),)


def test_tracker_contract_adapter_keep_track_needs_no_second_run() -> None:
    frames = make_clip(200, _jumping_layout)
    fake = LabelFakeTracker()
    adapter = RePromptTrackerAdapter(JOB_ID, VIDEO_ID, frames, fake, load_tracker_config(), rss_reader=lambda: 0)

    run_re_prompt_flow(
        JOB_ID, VideoRun(VIDEO_ID, "gi", self_tap(0, _jumping_layout)), adapter, _ClipFrameSource(frames), _ScriptedPrompter([KeepTrack()])
    )

    assert len(fake.calls) == 1
    assert FRAME_SIZE == frames[0].size
