"""HEN-318: 30 s chunks at 10 fps with 1 s overlap; each chunk is re-prompted from the previous chunk's masks. Fake model only."""

from bjj_roll_workers.tracker_config import load_tracker_config
from bjj_roll_workers.tracker_runner import track_video
from tracker_fakes import SELF_LABEL, LabelFakeTracker, drifting_self_layout, label_mask, make_clip, masks_prompt_of, self_tap

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"
CLIP_FRAMES = 800


def test_tracker_runner_chunks_overlap_by_one_second_and_hand_off_masks() -> None:
    frames = make_clip(CLIP_FRAMES, drifting_self_layout)
    fake = LabelFakeTracker()

    result = track_video(JOB_ID, VIDEO_ID, frames, self_tap(0), fake, load_tracker_config(), rss_reader=lambda: 0)

    assert [(call.first_frame_index, call.last_frame_index) for call in fake.calls] == [(0, 299), (290, 589), (580, 799)]
    assert fake.calls[0].prompts == {"self": self_tap(0)}
    for previous_call_output_frame, call in zip((290, 580), fake.calls[1:], strict=True):
        prompt = masks_prompt_of(call.prompts["self"])
        assert prompt.frame_index == previous_call_output_frame == call.first_frame_index
        assert prompt.mask == label_mask(frames[previous_call_output_frame], SELF_LABEL)
    assert [tracked.frame_index for tracked in result.frames] == list(range(CLIP_FRAMES))
    assert all(tracked.tracked.mask == label_mask(frames[tracked.frame_index], SELF_LABEL) for tracked in result.frames)


def test_tracker_runner_starts_at_the_tap_frame() -> None:
    frames = make_clip(400, drifting_self_layout)
    fake = LabelFakeTracker()

    result = track_video(JOB_ID, VIDEO_ID, frames, self_tap(25), fake, load_tracker_config(), rss_reader=lambda: 0)

    assert [(call.first_frame_index, call.last_frame_index) for call in fake.calls] == [(25, 324), (315, 399)]
    assert [tracked.frame_index for tracked in result.frames] == list(range(25, 400))


def test_tracker_runner_short_clip_is_one_chunk() -> None:
    frames = make_clip(40, drifting_self_layout)
    fake = LabelFakeTracker()

    result = track_video(JOB_ID, VIDEO_ID, frames, self_tap(0), fake, load_tracker_config(), rss_reader=lambda: 0)

    assert [(call.first_frame_index, call.last_frame_index) for call in fake.calls] == [(0, 39)]
    assert len(result.frames) == 40
