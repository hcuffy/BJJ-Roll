"""Shared coordinate types for the tracker (HEN-318) and the pose runner (HEN-319).

Convention: pixels of the sampled frame, origin at the top-left corner, x grows to the right, y grows down, always tied to a
frame index of the video sampled at the configured fps (`tracker_config.json`). A pixel (column c, row r) covers
[c, c + 1) x [r, r + 1), so a point inside a frame of width W and height H has 0 <= x < W and 0 <= y < H. A `Box` uses the
same axes with `x_min <= x_max` and `y_min <= y_max` (max edges exclusive). A `Keypoint` (HEN-319) is a named point on that
frame with a score; poses are the 17 COCO keypoints in `COCO17_KEYPOINT_NAMES` order.

Values are checked when they are built (negative, non-finite and non-integer frame indexes are rejected) and again against
the frame size and frame count at the interface boundary (`validate_tap_in_frame`). Error messages never carry the values.
"""

import math
from dataclasses import dataclass


class InvalidCoordinateError(ValueError):
    pass


def _check_coordinate(value: float) -> None:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value) or value < 0:
        raise InvalidCoordinateError("coordinate must be a finite number >= 0")


def _check_frame_index(frame_index: int) -> None:
    if isinstance(frame_index, bool) or not isinstance(frame_index, int) or frame_index < 0:
        raise InvalidCoordinateError("frame index must be an integer >= 0")


@dataclass(frozen=True)
class FrameSize:
    width: int
    height: int

    def __post_init__(self) -> None:
        for side in (self.width, self.height):
            if isinstance(side, bool) or not isinstance(side, int) or side <= 0:
                raise InvalidCoordinateError("frame size must be positive integers")


@dataclass(frozen=True)
class PixelPoint:
    x: float
    y: float

    def __post_init__(self) -> None:
        _check_coordinate(self.x)
        _check_coordinate(self.y)


@dataclass(frozen=True)
class TapPoint:
    """The user's tap on themselves: frame index plus pixel x/y in that frame."""

    frame_index: int
    x: float
    y: float

    def __post_init__(self) -> None:
        _check_frame_index(self.frame_index)
        _check_coordinate(self.x)
        _check_coordinate(self.y)


@dataclass(frozen=True)
class Box:
    x_min: float
    y_min: float
    x_max: float
    y_max: float

    def __post_init__(self) -> None:
        for value in (self.x_min, self.y_min, self.x_max, self.y_max):
            _check_coordinate(value)
        if self.x_min > self.x_max or self.y_min > self.y_max:
            raise InvalidCoordinateError("box min corner must not be past its max corner")

    @property
    def centre(self) -> tuple[float, float]:
        return ((self.x_min + self.x_max) / 2, (self.y_min + self.y_max) / 2)

    @property
    def diagonal(self) -> float:
        return math.hypot(self.x_max - self.x_min, self.y_max - self.y_min)


def box_iou(first: Box, second: Box) -> float:
    """Intersection over union of two boxes; 0.0 when they do not overlap or both are empty."""
    overlap_width = max(0.0, min(first.x_max, second.x_max) - max(first.x_min, second.x_min))
    overlap_height = max(0.0, min(first.y_max, second.y_max) - max(first.y_min, second.y_min))
    intersection = overlap_width * overlap_height
    union = (first.x_max - first.x_min) * (first.y_max - first.y_min) + (second.x_max - second.x_min) * (second.y_max - second.y_min) - intersection
    return intersection / union if union > 0 else 0.0


COCO17_KEYPOINT_NAMES = (
    "nose",
    "left_eye",
    "right_eye",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
)
"""The COCO-17 body skeleton in COCO's order. Every pose is exactly these keypoints in this order (HEN-319)."""


@dataclass(frozen=True)
class Keypoint:
    """One named body keypoint in frame pixels with the model's confidence in [0, 1]."""

    name: str
    x: float
    y: float
    score: float

    def __post_init__(self) -> None:
        if self.name not in COCO17_KEYPOINT_NAMES:
            raise InvalidCoordinateError("keypoint name is not a COCO-17 keypoint")
        _check_coordinate(self.x)
        _check_coordinate(self.y)
        if isinstance(self.score, bool) or not isinstance(self.score, int | float) or not 0.0 <= self.score <= 1.0:
            raise InvalidCoordinateError("keypoint score must be in [0, 1]")


def validate_point_in_frame(point: PixelPoint | TapPoint | Keypoint, frame_size: FrameSize) -> None:
    if not (point.x < frame_size.width and point.y < frame_size.height):
        raise InvalidCoordinateError("point is outside the frame")


def validate_tap_in_frame(tap: TapPoint, frame_size: FrameSize, frame_count: int) -> TapPoint:
    """Boundary check for a tap: on a frame of this video and inside that frame. Returns the tap unchanged."""
    if tap.frame_index >= frame_count:
        raise InvalidCoordinateError("tap frame is outside the video")
    validate_point_in_frame(tap, frame_size)
    return tap
