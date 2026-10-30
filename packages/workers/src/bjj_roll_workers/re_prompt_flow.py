"""Re-prompt flow ("Was this you?") on tracker drift (HEN-317, code part of HEN-72).

The flow talks to a tracker through `Tracker`: drift events come in (HEN-67 drift log shape: frame index + reason),
anchors go out (a frame index and a tap point). The SAM 2.1 adapter from HEN-67 plugs in here later; tests use a fake.

Each drift is shown once with its frame and answered once: "yes" keeps the track, a re-tap re-anchors the tracker at the
drift frame and tracking continues from there. Counts and corrections live only in that video's result, and every call
starts from that video's own first tap, so nothing is carried to another video (D15). Logs carry the job ID and timings
only (`job_logging`); drift reasons, frames and taps are never logged.
"""

import time
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal, Protocol, get_args

from bjj_roll_workers.geometry import TapPoint
from bjj_roll_workers.job_logging import log_job_event

type Style = Literal["gi", "no-gi"]
_STYLES: tuple[str, ...] = get_args(Style.__value__)


@dataclass(frozen=True)
class DriftEvent:
    """One entry of the HEN-67 drift log."""

    frame_index: int
    reason: str


@dataclass(frozen=True)
class KeepTrack:
    """The user answered "yes, this was me"."""


@dataclass(frozen=True)
class ReTap:
    """The user tapped themselves on the drift frame."""

    x: float
    y: float


type PromptAnswer = KeepTrack | ReTap


class Tracker(Protocol):
    def anchor(self, tap: TapPoint) -> None:
        """Put the track on the tapped person at `tap.frame_index`; tracking continues from that frame."""
        ...

    def next_drift(self) -> DriftEvent | None:
        """Track on from the current anchor and return the next drift, or None at the end of the video."""
        ...


class FrameSource(Protocol):
    def frame_at(self, frame_index: int) -> bytes: ...


class Prompter(Protocol):
    def ask_was_this_you(self, drift: DriftEvent, frame: bytes) -> PromptAnswer: ...


@dataclass(frozen=True)
class VideoRun:
    video_id: str
    style: Style
    first_tap: TapPoint

    def __post_init__(self) -> None:
        if self.style not in _STYLES:
            raise ValueError("unknown style")


@dataclass(frozen=True)
class VideoRePromptResult:
    video_id: str
    style: Style
    re_prompt_count: int
    corrections: tuple[TapPoint, ...]

    @property
    def correction_count(self) -> int:
        return len(self.corrections)


@dataclass(frozen=True)
class RePromptCounts:
    re_prompt_count: int
    correction_count: int


def run_re_prompt_flow(job_id: str, video: VideoRun, tracker: Tracker, frame_source: FrameSource, prompter: Prompter) -> VideoRePromptResult:
    """Track one video from its first tap, prompting once per drift. `tracker` must be new for this video."""
    started_at = time.monotonic()
    log_job_event("re_prompt_flow_started", job_id)
    prompted_frames: set[int] = set()
    corrections: list[TapPoint] = []
    tracker.anchor(video.first_tap)
    while (drift := tracker.next_drift()) is not None:
        if drift.frame_index in prompted_frames:
            continue
        prompted_frames.add(drift.frame_index)
        answer = prompter.ask_was_this_you(drift, frame_source.frame_at(drift.frame_index))
        if isinstance(answer, ReTap):
            correction = TapPoint(frame_index=drift.frame_index, x=answer.x, y=answer.y)
            corrections.append(correction)
            tracker.anchor(correction)
    log_job_event("re_prompt_flow_finished", job_id, duration_seconds=time.monotonic() - started_at)
    return VideoRePromptResult(video_id=video.video_id, style=video.style, re_prompt_count=len(prompted_frames), corrections=tuple(corrections))


def count_re_prompts_by_style(results: Iterable[VideoRePromptResult]) -> dict[Style, RePromptCounts]:
    totals: dict[Style, RePromptCounts] = {}
    for result in results:
        previous = totals.get(result.style, RePromptCounts(re_prompt_count=0, correction_count=0))
        totals[result.style] = RePromptCounts(
            re_prompt_count=previous.re_prompt_count + result.re_prompt_count,
            correction_count=previous.correction_count + result.correction_count,
        )
    return totals
