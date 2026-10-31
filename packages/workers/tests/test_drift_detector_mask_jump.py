"""HEN-318: the drift rule flags a synthetic mask jump and a lost mask, and nothing on a stable track. Synthetic masks only."""

import json
from pathlib import Path

from bjj_roll_workers.drift_detector import (
    MAX_AREA_CHANGE_RATIO,
    MAX_CENTRE_JUMP_IN_BOX_DIAGONALS,
    MIN_TRACK_SCORE,
    REASON_MASK_JUMP,
    REASON_MASK_LOST,
    REASON_MASK_SIZE_JUMP,
    detect_drift,
)
from bjj_roll_workers.geometry import Box, FrameSize
from bjj_roll_workers.re_prompt_flow import DriftEvent
from bjj_roll_workers.tracker import Mask, TrackedFrame, TrackedObject

FRAME_SIZE = FrameSize(width=100, height=100)
DRIFT_FIXTURE = Path(__file__).parent / "fixtures" / "drift_tracks.json"


def _square(frame_index: int, left: float, top: float, side: float = 10.0, score: float = 0.9) -> TrackedFrame:
    pixels = bytearray(FRAME_SIZE.width * FRAME_SIZE.height)
    for y in range(int(top), int(top + side)):
        for x in range(int(left), int(left + side)):
            pixels[y * FRAME_SIZE.width + x] = 1
    box = Box(x_min=left, y_min=top, x_max=left + side, y_max=top + side)
    return TrackedFrame(frame_index=frame_index, tracked=TrackedObject(mask=Mask.from_pixels(FRAME_SIZE, bytes(pixels)), box=box, score=score))


def _lost(frame_index: int) -> TrackedFrame:
    empty = Mask.from_pixels(FRAME_SIZE, bytes(FRAME_SIZE.width * FRAME_SIZE.height))
    return TrackedFrame(frame_index=frame_index, tracked=TrackedObject(mask=empty, box=None, score=0.0))


def test_drift_detector_rule_constants_are_named() -> None:
    assert (MIN_TRACK_SCORE, MAX_CENTRE_JUMP_IN_BOX_DIAGONALS, MAX_AREA_CHANGE_RATIO) == (0.5, 0.5, 2.0)


def test_drift_detector_stable_track_has_no_drift() -> None:
    stable = [_square(frame_index, 20.0 + frame_index * 0.5, 30.0) for frame_index in range(50)]

    assert detect_drift(stable) == ()


def test_drift_detector_flags_a_mask_jump_at_its_frame() -> None:
    track = [_square(frame_index, 20.0, 30.0) for frame_index in range(10)] + [_square(frame_index, 70.0, 75.0) for frame_index in range(10, 20)]

    assert detect_drift(track) == (DriftEvent(frame_index=10, reason=REASON_MASK_JUMP),)


def test_drift_detector_flags_a_size_jump() -> None:
    track = [_square(0, 20.0, 30.0, side=10.0), _square(1, 17.0, 27.0, side=16.0)]

    assert detect_drift(track) == (DriftEvent(frame_index=1, reason=REASON_MASK_SIZE_JUMP),)


def test_drift_detector_flags_a_lost_mask_once_per_loss() -> None:
    track = [_square(0, 20.0, 30.0), _lost(1), _lost(2), _square(3, 20.0, 30.0, score=MIN_TRACK_SCORE - 0.01), _square(4, 20.0, 30.0)]

    assert detect_drift(track) == (DriftEvent(frame_index=1, reason=REASON_MASK_LOST),)


def test_drift_detector_just_under_the_jump_limit_is_stable() -> None:
    diagonal = (10.0**2 + 10.0**2) ** 0.5
    step = diagonal * MAX_CENTRE_JUMP_IN_BOX_DIAGONALS * 0.99

    assert detect_drift([_square(0, 20.0, 30.0), _square(1, 20.0 + step, 30.0)]) == ()


def test_drift_detector_flags_a_shrink_past_the_area_ratio() -> None:
    track = [_square(0, 20.0, 30.0, side=10.0), _square(1, 21.5, 31.5, side=7.0)]

    assert detect_drift(track) == (DriftEvent(frame_index=1, reason=REASON_MASK_SIZE_JUMP),)


def test_drift_detector_min_track_score_is_the_lowest_good_score() -> None:
    at_limit = [_square(0, 20.0, 30.0), _square(1, 20.0, 30.0, score=MIN_TRACK_SCORE)]
    under_limit = [_square(0, 20.0, 30.0), _square(1, 20.0, 30.0, score=MIN_TRACK_SCORE - 0.01)]

    assert detect_drift(at_limit) == ()
    assert detect_drift(under_limit) == (DriftEvent(frame_index=1, reason=REASON_MASK_LOST),)


def test_drift_detector_flags_the_jump_fixture_and_not_the_stable_fixture() -> None:
    fixture = json.loads(DRIFT_FIXTURE.read_text())
    assert FrameSize(**fixture["frame_size"]) == FRAME_SIZE
    tracks = {
        name: [_square(index, left, top, fixture["square_side"]) for index, (left, top) in enumerate(squares)]
        for name, squares in fixture["tracks"].items()
    }

    assert detect_drift(tracks["stable"]) == ()
    assert detect_drift(tracks["jump"]) == (DriftEvent(frame_index=6, reason=REASON_MASK_JUMP),)
