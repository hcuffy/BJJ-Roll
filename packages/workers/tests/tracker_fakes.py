from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field

from bjj_roll_workers.geometry import Box, FrameSize, TapPoint
from bjj_roll_workers.tracker import Frame, Mask, MaskPrompt, Prompt, TrackedObject

SELF_LABEL = 1
PARTNER_LABEL = 2
FAKE_SCORE = 0.9
FRAME_SIZE = FrameSize(width=16, height=12)
SQUARE_SIZE = 3

type SquarePosition = tuple[int, int]
type ClipLayout = Callable[[int], Mapping[int, SquarePosition]]


def draw_frame(frame_index: int, size: FrameSize, squares: Mapping[int, SquarePosition], *, extra: bytes = b"") -> Frame:
    labels = bytearray(size.width * size.height)
    for label, (left, top) in squares.items():
        for y in range(top, top + SQUARE_SIZE):
            for x in range(left, left + SQUARE_SIZE):
                labels[y * size.width + x] = label
    rgb = bytearray()
    for index, label in enumerate(labels):
        filler = extra[index % len(extra)] if extra else 0
        rgb += bytes((label, filler, filler))
    return Frame(frame_index=frame_index, size=size, rgb=bytes(rgb))


def make_clip(frame_count: int, layout: ClipLayout, size: FrameSize = FRAME_SIZE, *, extra: bytes = b"") -> list[Frame]:
    return [draw_frame(frame_index, size, layout(frame_index), extra=extra) for frame_index in range(frame_count)]


def drifting_self_layout(frame_index: int) -> dict[int, SquarePosition]:
    return {SELF_LABEL: (1 + frame_index // 100, 1), PARTNER_LABEL: (10, 7)}


def label_mask(frame: Frame, label: int) -> Mask:
    return Mask.from_pixels(frame.size, bytes(1 if frame.rgb[index * 3] == label else 0 for index in range(frame.size.width * frame.size.height)))


def label_box(frame: Frame, label: int) -> Box | None:
    xs = [index % frame.size.width for index in range(frame.size.width * frame.size.height) if frame.rgb[index * 3] == label]
    ys = [index // frame.size.width for index in range(frame.size.width * frame.size.height) if frame.rgb[index * 3] == label]
    if not xs:
        return None
    return Box(x_min=min(xs), y_min=min(ys), x_max=max(xs) + 1, y_max=max(ys) + 1)


def self_tap(frame_index: int = 0, layout: ClipLayout = drifting_self_layout) -> TapPoint:
    left, top = layout(frame_index)[SELF_LABEL]
    return TapPoint(frame_index=frame_index, x=left + 1.5, y=top + 1.5)


def partner_tap(frame_index: int = 0, layout: ClipLayout = drifting_self_layout) -> TapPoint:
    left, top = layout(frame_index)[PARTNER_LABEL]
    return TapPoint(frame_index=frame_index, x=left + 1.5, y=top + 1.5)


@dataclass(frozen=True)
class TrackCall:
    first_frame_index: int
    last_frame_index: int
    prompts: dict[str, Prompt]


@dataclass
class LabelFakeTracker:
    calls: list[TrackCall] = field(default_factory=list)

    def track(self, frames: Sequence[Frame], prompts: Mapping[str, Prompt]) -> list[dict[str, TrackedObject]]:
        self.calls.append(TrackCall(frames[0].frame_index, frames[-1].frame_index, dict(prompts)))
        labels = {athlete_id: self._label_under(frames[0], prompt) for athlete_id, prompt in prompts.items()}
        output: list[dict[str, TrackedObject]] = []
        for frame in frames:
            tracks: dict[str, TrackedObject] = {}
            for athlete_id, label in labels.items():
                box = label_box(frame, label)
                tracks[athlete_id] = TrackedObject(mask=label_mask(frame, label), box=box, score=FAKE_SCORE if box else 0.0)
            output.append(tracks)
        return output

    @staticmethod
    def _label_under(frame: Frame, prompt: Prompt) -> int:
        if isinstance(prompt, TapPoint):
            return frame.rgb[(int(prompt.y) * frame.size.width + int(prompt.x)) * 3]
        pixels = prompt.mask.to_pixels()
        counts = Counter(frame.rgb[index * 3] for index, value in enumerate(pixels) if value)
        return counts.most_common(1)[0][0] if counts else 0


def masks_prompt_of(prompt: Prompt) -> MaskPrompt:
    assert isinstance(prompt, MaskPrompt)
    return prompt
