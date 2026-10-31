import math

import pytest

from bjj_roll_workers.geometry import Box, FrameSize, InvalidCoordinateError, TapPoint, validate_tap_in_frame

FRAME_SIZE = FrameSize(width=640, height=360)
FRAME_COUNT = 100


@pytest.mark.parametrize("x, y", [(0.0, 0.0), (639.9, 359.9), (320.5, 10.0)])
def test_geometry_accepts_a_tap_inside_the_frame(x: float, y: float) -> None:
    tap = TapPoint(frame_index=99, x=x, y=y)

    assert validate_tap_in_frame(tap, FRAME_SIZE, FRAME_COUNT) == tap


@pytest.mark.parametrize("x, y", [(-1.0, 5.0), (5.0, -0.1), (math.nan, 5.0), (5.0, math.inf), (-math.inf, 5.0)])
def test_geometry_rejects_negative_or_non_finite_coordinates(x: float, y: float) -> None:
    with pytest.raises(InvalidCoordinateError):
        TapPoint(frame_index=0, x=x, y=y)


@pytest.mark.parametrize("frame_index", [-1, True, 1.5])
def test_geometry_rejects_a_bad_frame_index(frame_index: object) -> None:
    with pytest.raises(InvalidCoordinateError):
        TapPoint(frame_index=frame_index, x=1.0, y=1.0)  # type: ignore[arg-type]  # a wrong type on purpose


@pytest.mark.parametrize("tap", [TapPoint(0, 640.0, 10.0), TapPoint(0, 10.0, 360.0), TapPoint(100, 10.0, 10.0)])
def test_geometry_rejects_a_tap_outside_the_frame_or_the_video(tap: TapPoint) -> None:
    with pytest.raises(InvalidCoordinateError):
        validate_tap_in_frame(tap, FRAME_SIZE, FRAME_COUNT)


def test_geometry_box_rejects_inverted_or_non_finite_corners() -> None:
    with pytest.raises(InvalidCoordinateError):
        Box(x_min=5.0, y_min=0.0, x_max=4.0, y_max=1.0)
    with pytest.raises(InvalidCoordinateError):
        Box(x_min=0.0, y_min=0.0, x_max=math.nan, y_max=1.0)


def test_geometry_error_message_carries_no_coordinate_values() -> None:
    with pytest.raises(InvalidCoordinateError) as error:
        validate_tap_in_frame(TapPoint(0, 12345.0, 10.0), FRAME_SIZE, FRAME_COUNT)

    assert "12345" not in str(error.value)
