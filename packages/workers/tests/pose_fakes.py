"""Fake pose model and synthetic two-person clips for the HEN-319 pose tests. No model, weights or real video.

Frames use the tracker fakes' label convention (red channel: 0 background, 1 the user, 2 the partner). The fake pose model
finds the most common person label inside the box it is given and puts all 17 COCO keypoints on that label's centroid, so a
box that is mostly covered by the partner yields the partner's pose: the mislabel a top-down model makes when athletes tangle.
Each label gets its own score, so a partner keypoint is recognisable anywhere it might leak.
"""

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from bjj_roll_workers.geometry import COCO17_KEYPOINT_NAMES, Box, FrameSize, Keypoint
from bjj_roll_workers.tracker import Frame, FrameTracks, Mask, TrackedObject
from tracker_fakes import PARTNER_LABEL, SELF_LABEL

SELF_KEYPOINT_SCORE = 0.875
PARTNER_KEYPOINT_SCORE = 0.4375
LABEL_SCORES = {SELF_LABEL: SELF_KEYPOINT_SCORE, PARTNER_LABEL: PARTNER_KEYPOINT_SCORE}
POSE_FRAME_SIZE = FrameSize(width=24, height=16)
TRACK_SCORE = 0.9

type Rectangle = tuple[int, int, int, int]


def draw_rectangles(frame_index: int, rectangles: Sequence[tuple[int, Rectangle]], size: FrameSize = POSE_FRAME_SIZE, *, extra: bytes = b"") -> Frame:
    """Paint (label, (x_min, y_min, x_max, y_max)) rectangles in order; later ones cover earlier ones."""
    labels = bytearray(size.width * size.height)
    for label, (x_min, y_min, x_max, y_max) in rectangles:
        for y in range(y_min, y_max):
            for x in range(x_min, x_max):
                labels[y * size.width + x] = label
    rgb = bytearray()
    for index, label in enumerate(labels):
        filler = extra[index % len(extra)] if extra else 0
        rgb += bytes((label, filler, filler))
    return Frame(frame_index=frame_index, size=size, rgb=bytes(rgb))


def label_pixels(frame: Frame, label: int) -> list[tuple[int, int]]:
    return [
        (index % frame.size.width, index // frame.size.width)
        for index in range(frame.size.width * frame.size.height)
        if frame.rgb[index * 3] == label
    ]


def tracked_label(frame: Frame, label: int) -> TrackedObject:
    pixels = label_pixels(frame, label)
    mask = Mask.from_pixels(frame.size, bytes(1 if frame.rgb[index * 3] == label else 0 for index in range(frame.size.width * frame.size.height)))
    if not pixels:
        return TrackedObject(mask=mask, box=None, score=0.0)
    xs, ys = [x for x, _ in pixels], [y for _, y in pixels]
    return TrackedObject(mask=mask, box=Box(x_min=min(xs), y_min=min(ys), x_max=max(xs) + 1, y_max=max(ys) + 1), score=TRACK_SCORE)


def frame_tracks(frame: Frame, athletes: Mapping[str, int]) -> FrameTracks:
    """What the tracker hands over in memory: every tracked athlete's mask and box on this frame."""
    return {athlete_id: tracked_label(frame, label) for athlete_id, label in athletes.items()}


@dataclass(frozen=True)
class PoseCall:
    frame_index: int
    box: Box


@dataclass
class LabelFakePose:
    """Implements `bjj_roll_workers.pose.Pose` without a model. Keeps only the call log."""

    calls: list[PoseCall] = field(default_factory=list)

    def estimate(self, frame: Frame, box: Box) -> tuple[Keypoint, ...]:
        self.calls.append(PoseCall(frame.frame_index, box))
        inside = Counter(
            frame.rgb[(y * frame.size.width + x) * 3]
            for y in range(int(box.y_min), int(box.y_max))
            for x in range(int(box.x_min), int(box.x_max))
            if frame.rgb[(y * frame.size.width + x) * 3] in LABEL_SCORES
        )
        if not inside:
            return tuple(Keypoint(name=name, x=box.x_min, y=box.y_min, score=0.0) for name in COCO17_KEYPOINT_NAMES)
        label = inside.most_common(1)[0][0]
        pixels = label_pixels(frame, label)
        centre_x = sum(x for x, _ in pixels) / len(pixels) + 0.5
        centre_y = sum(y for _, y in pixels) / len(pixels) + 0.5
        return tuple(Keypoint(name=name, x=centre_x, y=centre_y, score=LABEL_SCORES[label]) for name in COCO17_KEYPOINT_NAMES)
