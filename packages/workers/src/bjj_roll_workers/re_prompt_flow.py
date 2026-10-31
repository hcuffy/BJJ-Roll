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
    frame_index: int
    reason: str


@dataclass(frozen=True)
class KeepTrack: ...


@dataclass(frozen=True)
class ReTap:
    x: float
    y: float


type PromptAnswer = KeepTrack | ReTap


class Tracker(Protocol):
    def anchor(self, tap: TapPoint) -> None: ...

    def next_drift(self) -> DriftEvent | None: ...


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
