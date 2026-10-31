"""Frame sampler (HEN-351): turns a decoded clip into the frames the tracker reads, at `tracker_config.frames_per_second`.

From each sample time k / frames_per_second it keeps the first source frame at or after that time, renumbers the kept frames from 0 and
records each one's timestamp in seconds. A clip slower than the sampling rate is refused. Frames stay in memory and are never logged.
"""

import math
from collections.abc import Iterable
from dataclasses import dataclass
from fractions import Fraction

from bjj_roll_workers.tracker import Frame

_MAX_FRAME_RATE_DENOMINATOR = 1001


@dataclass(frozen=True)
class SampledClip:
    frames: tuple[Frame, ...]
    timestamps_seconds: tuple[float, ...]


def sample_frames(source: Iterable[Frame], source_frames_per_second: float, frames_per_second: int) -> SampledClip:
    if frames_per_second <= 0 or not math.isfinite(source_frames_per_second) or source_frames_per_second < frames_per_second:
        raise ValueError("clip must be at least the sampling rate")
    source_frames_per_sample = Fraction(source_frames_per_second).limit_denominator(_MAX_FRAME_RATE_DENOMINATOR) / frames_per_second
    frames: list[Frame] = []
    timestamps: list[float] = []
    for source_index, frame in enumerate(source):
        if frame.frame_index != source_index:
            raise ValueError("source frames must be consecutive from frame index 0")
        if source_index >= len(frames) * source_frames_per_sample:
            frames.append(Frame(frame_index=len(frames), size=frame.size, rgb=frame.rgb))
            timestamps.append(source_index / source_frames_per_second)
    return SampledClip(frames=tuple(frames), timestamps_seconds=tuple(timestamps))
