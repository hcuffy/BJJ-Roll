"""Tracker interface (HEN-318): `track(frames, prompts)` -> one `{athlete_id: TrackedObject}` per frame.

Backends sit behind `Tracker`: the local CPU SAM 2.1 small ONNX backend (`sam21_onnx_tracker`) now, a Modal backend later,
and a fake model in tests. Callers (`tracker_runner`) never see which one runs. Coordinates follow `geometry`.

Contract for `track`:
- `frames` are consecutive frames of one video (sampled at the configured fps), in order, at least one.
- every prompt sits on `frames[0]`: a `TapPoint` (the user's tap) or a `MaskPrompt` (a mask from the previous chunk).
- the result has exactly one dict per frame, in order, with exactly the prompted athlete IDs as keys.
- a `TrackedObject` has a mask the size of its frame, the mask's box (None when the mask is empty) and a score in [0, 1].
- `track` keeps nothing between calls: every call starts only from its own prompts, so nothing crosses videos (D15).
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol, Self

from bjj_roll_workers.geometry import Box, FrameSize, TapPoint

RGB_CHANNELS = 3


class TrackerContractError(RuntimeError):
    pass


@dataclass(frozen=True)
class Frame:
    """One sampled frame: row-major RGB bytes, `RGB_CHANNELS` bytes per pixel."""

    frame_index: int
    size: FrameSize
    rgb: bytes

    def __post_init__(self) -> None:
        if len(self.rgb) != self.size.width * self.size.height * RGB_CHANNELS:
            raise ValueError("frame bytes do not match the frame size")


@dataclass(frozen=True)
class Mask:
    """Binary mask as row-major run lengths, alternating background and foreground, starting with background (may be 0)."""

    size: FrameSize
    runs: tuple[int, ...]

    def __post_init__(self) -> None:
        if any(run < 0 for run in self.runs) or sum(self.runs) != self.size.width * self.size.height:
            raise ValueError("mask runs do not cover the frame")

    @classmethod
    def from_pixels(cls, size: FrameSize, pixels: bytes) -> Self:
        runs: list[int] = []
        current_value, run_length = 0, 0
        for pixel in pixels:
            value = 1 if pixel else 0
            if value == current_value:
                run_length += 1
            else:
                runs.append(run_length)
                current_value, run_length = value, 1
        runs.append(run_length)
        return cls(size=size, runs=tuple(runs))

    def to_pixels(self) -> bytes:
        return b"".join((b"\x01" if position % 2 else b"\x00") * run for position, run in enumerate(self.runs))

    @property
    def area(self) -> int:
        return sum(self.runs[1::2])


@dataclass(frozen=True)
class MaskPrompt:
    frame_index: int
    mask: Mask


type Prompt = TapPoint | MaskPrompt


@dataclass(frozen=True)
class TrackedObject:
    mask: Mask
    box: Box | None
    score: float


@dataclass(frozen=True)
class TrackedFrame:
    frame_index: int
    tracked: TrackedObject


type FrameTracks = dict[str, TrackedObject]


class Tracker(Protocol):
    def track(self, frames: Sequence[Frame], prompts: Mapping[str, Prompt]) -> list[FrameTracks]:
        """Track every prompted athlete through `frames` (see the module contract)."""
        ...


def check_track_output(frames: Sequence[Frame], prompts: Mapping[str, Prompt], output: Sequence[Mapping[str, TrackedObject]]) -> None:
    """Enforce the `Tracker` contract on a backend's output at the boundary. Messages carry no values."""
    if len(output) != len(frames):
        raise TrackerContractError("tracker returned a different number of frames")
    for frame, tracks in zip(frames, output, strict=True):
        if set(tracks) != set(prompts):
            raise TrackerContractError("tracker returned athletes that were not prompted, or missed one")
        for tracked in tracks.values():
            if tracked.mask.size != frame.size:
                raise TrackerContractError("mask size does not match the frame")
            if not 0.0 <= tracked.score <= 1.0:
                raise TrackerContractError("score is outside [0, 1]")
            if (tracked.box is None) != (tracked.mask.area == 0):
                raise TrackerContractError("box must be None exactly when the mask is empty")
