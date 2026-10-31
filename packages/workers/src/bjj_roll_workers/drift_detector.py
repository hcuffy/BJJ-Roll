import math
from collections.abc import Sequence

from bjj_roll_workers.re_prompt_flow import DriftEvent
from bjj_roll_workers.tracker import TrackedFrame

MIN_TRACK_SCORE_UNTUNED = 0.5
MAX_CENTRE_JUMP_IN_BOX_DIAGONALS_UNTUNED = 0.5
MAX_AREA_CHANGE_RATIO_UNTUNED = 2.0

REASON_MASK_LOST = "mask_lost"
REASON_MASK_JUMP = "mask_jump"
REASON_MASK_SIZE_JUMP = "mask_size_jump"


def _drift_reason(previous: TrackedFrame, current: TrackedFrame) -> str | None:
    previous_box, current_box = previous.tracked.box, current.tracked.box
    assert previous_box is not None and current_box is not None
    (previous_x, previous_y), (current_x, current_y) = previous_box.centre, current_box.centre
    if math.hypot(current_x - previous_x, current_y - previous_y) > MAX_CENTRE_JUMP_IN_BOX_DIAGONALS_UNTUNED * previous_box.diagonal:
        return REASON_MASK_JUMP
    area_ratio = current.tracked.mask.area / previous.tracked.mask.area
    if area_ratio > MAX_AREA_CHANGE_RATIO_UNTUNED or area_ratio < 1 / MAX_AREA_CHANGE_RATIO_UNTUNED:
        return REASON_MASK_SIZE_JUMP
    return None


def detect_drift(track: Sequence[TrackedFrame]) -> tuple[DriftEvent, ...]:
    events: list[DriftEvent] = []
    previous_good: TrackedFrame | None = None
    in_loss = False
    for current in track:
        if current.tracked.box is None or current.tracked.mask.area == 0 or current.tracked.score < MIN_TRACK_SCORE_UNTUNED:
            if not in_loss:
                events.append(DriftEvent(frame_index=current.frame_index, reason=REASON_MASK_LOST))
            in_loss, previous_good = True, None
            continue
        in_loss = False
        if previous_good is not None and (reason := _drift_reason(previous_good, current)) is not None:
            events.append(DriftEvent(frame_index=current.frame_index, reason=reason))
        previous_good = current
    return tuple(events)
