"""Drift detector for the user's track (HEN-318). Drift events use the HEN-67 drift log shape (`re_prompt_flow.DriftEvent`)
and are stored with the video's results, never logged.

Rule, checked frame by frame on the user's track:
- lost: the mask is empty or its score is below `MIN_TRACK_SCORE`; flagged once on the first frame of each loss.
- jump: the box centre moved more than `MAX_CENTRE_JUMP_IN_BOX_DIAGONALS` of the previous box's diagonal since the
  previous good frame.
- size jump: the mask area grew or shrank by more than `MAX_AREA_CHANGE_RATIO` since the previous good frame.
After a loss the next good frame starts a fresh comparison.
"""

import math
from collections.abc import Sequence

from bjj_roll_workers.re_prompt_flow import DriftEvent
from bjj_roll_workers.tracker import TrackedFrame

MIN_TRACK_SCORE = 0.5
MAX_CENTRE_JUMP_IN_BOX_DIAGONALS = 0.5
MAX_AREA_CHANGE_RATIO = 2.0

REASON_MASK_LOST = "mask_lost"
REASON_MASK_JUMP = "mask_jump"
REASON_MASK_SIZE_JUMP = "mask_size_jump"


def _drift_reason(previous: TrackedFrame, current: TrackedFrame) -> str | None:
    previous_box, current_box = previous.tracked.box, current.tracked.box
    assert previous_box is not None and current_box is not None
    (previous_x, previous_y), (current_x, current_y) = previous_box.centre, current_box.centre
    if math.hypot(current_x - previous_x, current_y - previous_y) > MAX_CENTRE_JUMP_IN_BOX_DIAGONALS * previous_box.diagonal:
        return REASON_MASK_JUMP
    area_ratio = current.tracked.mask.area / previous.tracked.mask.area
    if area_ratio > MAX_AREA_CHANGE_RATIO or area_ratio < 1 / MAX_AREA_CHANGE_RATIO:
        return REASON_MASK_SIZE_JUMP
    return None


def detect_drift(track: Sequence[TrackedFrame]) -> tuple[DriftEvent, ...]:
    events: list[DriftEvent] = []
    previous_good: TrackedFrame | None = None
    in_loss = False
    for current in track:
        if current.tracked.box is None or current.tracked.mask.area == 0 or current.tracked.score < MIN_TRACK_SCORE:
            if not in_loss:
                events.append(DriftEvent(frame_index=current.frame_index, reason=REASON_MASK_LOST))
            in_loss, previous_good = True, None
            continue
        in_loss = False
        if previous_good is not None and (reason := _drift_reason(previous_good, current)) is not None:
            events.append(DriftEvent(frame_index=current.frame_index, reason=reason))
        previous_good = current
    return tuple(events)
