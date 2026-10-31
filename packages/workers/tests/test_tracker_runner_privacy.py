import json
import stat
from pathlib import Path

import pytest

from bjj_roll_workers.geometry import TapPoint
from bjj_roll_workers.re_prompt_flow import KeepTrack, VideoRun, run_re_prompt_flow
from bjj_roll_workers.tracker_config import load_tracker_config
from bjj_roll_workers.tracker_runner import RePromptTrackerAdapter, track_video
from bjj_roll_workers.tracking_output import write_tracking_result
from tracker_fakes import PARTNER_LABEL, SELF_LABEL, LabelFakeTracker, TrackCall, drifting_self_layout, label_mask, make_clip, partner_tap, self_tap

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
FIRST_VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"
SECOND_VIDEO_ID = "7c2d4e6f-1a3b-4c5d-8e9f-0a1b2c3d4e5f"


def _swapped_layout(frame_index: int) -> dict[int, tuple[int, int]]:
    return {SELF_LABEL: (10, 7), PARTNER_LABEL: (1, 1)}


def test_tracker_runner_tracks_the_partner_in_memory_but_keeps_only_the_user(tmp_path: Path) -> None:
    frames = make_clip(350, drifting_self_layout)
    fake = LabelFakeTracker()
    footage_folder = tmp_path / "footage"
    footage_folder.mkdir(mode=stat.S_IRWXU)

    result = track_video(
        JOB_ID, FIRST_VIDEO_ID, frames, self_tap(0), fake, load_tracker_config(), other_taps={"partner": partner_tap(0)}, rss_reader=lambda: 0
    )
    written = write_tracking_result(result, footage_folder)

    assert set(fake.calls[0].prompts) == {"self", "partner"}
    assert set(fake.calls[1].prompts) == {"self", "partner"}
    assert all(tracked.tracked.mask == label_mask(frames[tracked.frame_index], SELF_LABEL) for tracked in result.frames)
    assert all(tracked.tracked.mask != label_mask(frames[tracked.frame_index], PARTNER_LABEL) for tracked in result.frames)
    stored = json.loads(written.read_text())
    assert "partner" not in written.read_text()
    partner_runs = [list(label_mask(frame, PARTNER_LABEL).runs) for frame in frames]
    assert all(entry["mask"]["runs"] not in partner_runs for entry in stored["frames"])


def test_tracker_runner_rejects_the_user_id_as_another_athlete() -> None:
    with pytest.raises(ValueError):
        track_video(
            JOB_ID,
            FIRST_VIDEO_ID,
            make_clip(5, drifting_self_layout),
            self_tap(0),
            LabelFakeTracker(),
            load_tracker_config(),
            other_taps={"self": partner_tap(0)},
        )


def test_tracker_runner_second_video_starts_from_its_own_tap_only() -> None:
    fake = LabelFakeTracker()
    track_video(JOB_ID, FIRST_VIDEO_ID, make_clip(350, drifting_self_layout), self_tap(0), fake, load_tracker_config(), rss_reader=lambda: 0)
    first_video_calls = len(fake.calls)
    second_frames = make_clip(350, _swapped_layout)
    second_tap = TapPoint(frame_index=0, x=11.5, y=8.5)

    second_result = track_video(JOB_ID, SECOND_VIDEO_ID, second_frames, second_tap, fake, load_tracker_config(), rss_reader=lambda: 0)

    assert fake.calls[first_video_calls].prompts == {"self": second_tap}
    assert second_result.video_id == SECOND_VIDEO_ID
    assert all(tracked.tracked.mask == label_mask(second_frames[tracked.frame_index], SELF_LABEL) for tracked in second_result.frames)


def test_tracker_runner_adapter_needs_this_videos_tap_before_tracking() -> None:
    adapter = RePromptTrackerAdapter(JOB_ID, SECOND_VIDEO_ID, make_clip(5, drifting_self_layout), LabelFakeTracker(), load_tracker_config())

    with pytest.raises(RuntimeError):
        adapter.next_drift()
    with pytest.raises(RuntimeError):
        adapter.result()


def test_tracker_runner_rejects_an_out_of_frame_tap_before_tracking() -> None:
    fake = LabelFakeTracker()

    with pytest.raises(ValueError):
        track_video(JOB_ID, FIRST_VIDEO_ID, make_clip(5, drifting_self_layout), TapPoint(0, 16.0, 1.0), fake, load_tracker_config())
    assert fake.calls == []


def test_tracker_runner_refuses_a_second_video_with_no_tap_of_its_own() -> None:
    fake = LabelFakeTracker()
    frames = make_clip(5, drifting_self_layout)
    track_video(JOB_ID, FIRST_VIDEO_ID, frames, self_tap(0), fake, load_tracker_config(), rss_reader=lambda: 0)
    first_video_calls = len(fake.calls)

    with pytest.raises(TypeError):
        track_video(JOB_ID, SECOND_VIDEO_ID, frames, None, fake, load_tracker_config(), rss_reader=lambda: 0)  # type: ignore[arg-type]  # a wrong type on purpose

    assert len(fake.calls) == first_video_calls


class _KeepEveryTrack:
    def ask_was_this_you(self, drift: object, frame: bytes) -> KeepTrack:
        return KeepTrack()


class _NoFrames:
    def frame_at(self, frame_index: int) -> bytes:
        return b""


def test_tracker_runner_refuses_a_batch_run_without_a_tap_for_each_video() -> None:
    fake = LabelFakeTracker()
    frames = make_clip(5, drifting_self_layout)
    first_video = VideoRun(video_id=FIRST_VIDEO_ID, style="gi", first_tap=self_tap(0), frame_size=frames[0].size)
    video_ids = (FIRST_VIDEO_ID, SECOND_VIDEO_ID)
    adapters = [RePromptTrackerAdapter(JOB_ID, video_id, frames, fake, load_tracker_config(), rss_reader=lambda: 0) for video_id in video_ids]

    first_result = run_re_prompt_flow(JOB_ID, first_video, adapters[0], _NoFrames(), _KeepEveryTrack())
    first_video_calls = len(fake.calls)
    with pytest.raises(TypeError):
        VideoRun(video_id=SECOND_VIDEO_ID, style="gi", first_tap=None, frame_size=frames[0].size)  # type: ignore[arg-type]  # a wrong type on purpose

    assert first_result.video_id == FIRST_VIDEO_ID
    assert fake.calls == [TrackCall(0, len(frames) - 1, {"self": self_tap(0)})]
    assert len(fake.calls) == first_video_calls
    with pytest.raises(RuntimeError):
        adapters[1].result()
