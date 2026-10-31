import pytest

from bjj_roll_workers.frame_sampler import sample_frames
from bjj_roll_workers.geometry import FrameSize
from bjj_roll_workers.tracker import RGB_CHANNELS, Frame
from bjj_roll_workers.tracker_config import load_tracker_config

FRAME_SIZE = FrameSize(width=4, height=3)
FRAMES_PER_SECOND = load_tracker_config().frames_per_second


def _synthetic_clip(frame_count: int) -> list[Frame]:
    return [
        Frame(frame_index=index, size=FRAME_SIZE, rgb=bytes([index % 256]) * (FRAME_SIZE.width * FRAME_SIZE.height * RGB_CHANNELS))
        for index in range(frame_count)
    ]


def test_frame_sampler_keeps_every_third_frame_of_a_30_fps_clip_at_10_fps() -> None:
    clip = _synthetic_clip(60)

    sampled = sample_frames(clip, 30, FRAMES_PER_SECOND)

    assert FRAMES_PER_SECOND == 10
    assert len(sampled.frames) == 20
    assert [frame.frame_index for frame in sampled.frames] == list(range(20))
    assert [frame.rgb for frame in sampled.frames] == [clip[index].rgb for index in range(0, 60, 3)]
    assert sampled.timestamps_seconds == pytest.approx([index / 10 for index in range(20)])


def test_frame_sampler_takes_the_first_frame_at_or_after_each_sample_time() -> None:
    clip = _synthetic_clip(10)

    sampled = sample_frames(clip, 25, FRAMES_PER_SECOND)

    assert [frame.rgb for frame in sampled.frames] == [clip[index].rgb for index in (0, 3, 5, 8)]
    assert sampled.timestamps_seconds == pytest.approx([0.0, 0.12, 0.2, 0.32])


def test_frame_sampler_refuses_a_slow_clip_or_frames_out_of_order() -> None:
    with pytest.raises(ValueError):
        sample_frames(_synthetic_clip(10), 8, FRAMES_PER_SECOND)
    with pytest.raises(ValueError):
        sample_frames(_synthetic_clip(10), float("nan"), FRAMES_PER_SECOND)
    with pytest.raises(ValueError):
        sample_frames(_synthetic_clip(10)[1:], 30, FRAMES_PER_SECOND)
