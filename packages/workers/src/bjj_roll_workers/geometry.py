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


def validate_point_in_frame(point: PixelPoint | TapPoint, frame_size: FrameSize) -> None:
    if not (point.x < frame_size.width and point.y < frame_size.height):
        raise InvalidCoordinateError("point is outside the frame")


def validate_tap_in_frame(tap: TapPoint, frame_size: FrameSize, frame_count: int) -> TapPoint:
    if tap.frame_index >= frame_count:
        raise InvalidCoordinateError("tap frame is outside the video")
    validate_point_in_frame(tap, frame_size)
    return tap
