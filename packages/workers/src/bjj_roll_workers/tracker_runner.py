"""Chunked tracking of one video (HEN-318): runs any `tracker.Tracker` backend over a whole clip.

The clip is split into chunks of `chunk_frames` (30 s at 10 fps) that overlap by `chunk_overlap_frames` (1 s). The first
chunk starts at the user's tap; every later chunk starts inside the previous one's last second and is re-prompted from the
previous chunk's masks on that first overlap frame. Overlap frames are kept from the earlier chunk. Peak RSS is logged after
each chunk; once it is over `peak_rss_limit_bytes`, the following chunks use `fallback_chunk_frames` (15 s). All numbers come
from `tracker_config`.

Only the user's own track ("self") is kept in the result; partner and bystander taps are tracked in memory to keep the
user's mask apart and are dropped (D6). Each call starts from that video's own tap only (D15). Drift events are part of the
result and are never logged; logs carry the job ID, timings and peak RSS only (`job_logging`).
"""

import resource
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

from bjj_roll_workers.drift_detector import detect_drift
from bjj_roll_workers.geometry import TapPoint, validate_tap_in_frame
from bjj_roll_workers.job_logging import log_job_event
from bjj_roll_workers.re_prompt_flow import DriftEvent
from bjj_roll_workers.tracker import Frame, FrameTracks, MaskPrompt, Prompt, TrackedFrame, Tracker, check_track_output
from bjj_roll_workers.tracker_config import TrackerConfig

OWN_ATHLETE_ID = "self"
_RU_MAXRSS_BYTES_PER_UNIT = 1 if sys.platform == "darwin" else 1024

type RssReader = Callable[[], int]


def read_peak_rss_bytes() -> int:
    """Peak resident set size of this process so far (ru_maxrss is KiB on Linux, bytes on macOS)."""
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * _RU_MAXRSS_BYTES_PER_UNIT


@dataclass(frozen=True)
class VideoTrackingResult:
    """The user's own track for one video, from the tap frame on, plus its drift events (frame index + reason)."""

    video_id: str
    frames: tuple[TrackedFrame, ...]
    drift_events: tuple[DriftEvent, ...]


def _track_in_chunks(
    job_id: str, frames: Sequence[Frame], prompts: dict[str, Prompt], start: int, tracker: Tracker, config: TrackerConfig, rss_reader: RssReader
) -> list[FrameTracks]:
    chunk_frames = config.chunk_frames
    kept: list[FrameTracks] = []
    while True:
        started_at = time.monotonic()
        end = min(start + chunk_frames, len(frames))
        chunk = frames[start:end]
        if any(frame.frame_index != start + offset for offset, frame in enumerate(chunk)):
            raise ValueError("frames must be consecutive from frame index 0")
        output = tracker.track(chunk, prompts)
        check_track_output(chunk, prompts, output)
        kept.extend(output if not kept else output[config.chunk_overlap_frames :])
        peak_rss_bytes = rss_reader()
        log_job_event("tracker_chunk_finished", job_id, duration_seconds=time.monotonic() - started_at, peak_rss_bytes=peak_rss_bytes)
        if peak_rss_bytes > config.peak_rss_limit_bytes and chunk_frames != config.fallback_chunk_frames:
            chunk_frames = config.fallback_chunk_frames
            log_job_event("tracker_chunk_length_fallback", job_id)
        if end >= len(frames):
            return kept
        next_start = end - config.chunk_overlap_frames
        prompts = {athlete_id: MaskPrompt(frame_index=next_start, mask=tracked.mask) for athlete_id, tracked in output[next_start - start].items()}
        start = next_start


def track_video(
    job_id: str,
    video_id: str,
    frames: Sequence[Frame],
    own_tap: TapPoint,
    tracker: Tracker,
    config: TrackerConfig,
    *,
    other_taps: Mapping[str, TapPoint] | None = None,
    rss_reader: RssReader = read_peak_rss_bytes,
) -> VideoTrackingResult:
    """Track the user from `own_tap` to the end of `frames` (frame index = position, sampled at `config.frames_per_second`)."""
    other_taps = dict(other_taps or {})
    if OWN_ATHLETE_ID in other_taps:
        raise ValueError("other athletes cannot use the user's athlete ID")
    if not frames:
        raise ValueError("video has no frames")
    taps = {OWN_ATHLETE_ID: own_tap, **other_taps}
    for tap in taps.values():
        validate_tap_in_frame(tap, frames[0].size, len(frames))
        if tap.frame_index != own_tap.frame_index:
            raise ValueError("every tap must be on the user's tap frame")
    started_at = time.monotonic()
    log_job_event("tracker_run_started", job_id)
    prompts: dict[str, Prompt] = dict(taps)
    tracks = _track_in_chunks(job_id, frames, prompts, own_tap.frame_index, tracker, config, rss_reader)
    own_frames = tuple(
        TrackedFrame(frame_index=own_tap.frame_index + offset, tracked=frame_tracks[OWN_ATHLETE_ID]) for offset, frame_tracks in enumerate(tracks)
    )
    log_job_event("tracker_run_finished", job_id, duration_seconds=time.monotonic() - started_at)
    return VideoTrackingResult(video_id=video_id, frames=own_frames, drift_events=detect_drift(own_frames))


class RePromptTrackerAdapter:
    """Lets the HEN-317 re-prompt flow (`re_prompt_flow.Tracker`) drive the chunked runner for one video.

    `anchor(tap)` (re)tracks the user from the tap frame to the end; frames before it are kept from the earlier run.
    `next_drift()` hands out the drift events found from that frame on. Make a new adapter per video (D15).
    """

    def __init__(
        self,
        job_id: str,
        video_id: str,
        frames: Sequence[Frame],
        tracker: Tracker,
        config: TrackerConfig,
        *,
        rss_reader: RssReader = read_peak_rss_bytes,
    ) -> None:
        self._job_id, self._video_id, self._frames, self._tracker, self._config, self._rss_reader = (
            job_id,
            video_id,
            frames,
            tracker,
            config,
            rss_reader,
        )
        self._result: VideoTrackingResult | None = None
        self._pending_drifts: list[DriftEvent] = []

    def anchor(self, tap: TapPoint) -> None:
        new_run = track_video(self._job_id, self._video_id, self._frames, tap, self._tracker, self._config, rss_reader=self._rss_reader)
        earlier_frames: tuple[TrackedFrame, ...] = ()
        earlier_drifts: tuple[DriftEvent, ...] = ()
        if self._result is not None:
            earlier_frames = tuple(tracked for tracked in self._result.frames if tracked.frame_index < tap.frame_index)
            earlier_drifts = tuple(drift for drift in self._result.drift_events if drift.frame_index <= tap.frame_index)
        new_drifts = tuple(drift for drift in new_run.drift_events if drift not in earlier_drifts)
        self._result = VideoTrackingResult(video_id=self._video_id, frames=earlier_frames + new_run.frames, drift_events=earlier_drifts + new_drifts)
        self._pending_drifts = list(new_drifts)

    def next_drift(self) -> DriftEvent | None:
        if self._result is None:
            raise RuntimeError("anchor this video's own tap first")
        return self._pending_drifts.pop(0) if self._pending_drifts else None

    def result(self) -> VideoTrackingResult:
        if self._result is None:
            raise RuntimeError("anchor this video's own tap first")
        return self._result
