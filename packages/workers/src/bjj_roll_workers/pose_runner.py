"""Pose estimation for one video (HEN-319): runs any `pose.Pose` backend on the tracker's boxes, frame by frame.

Input is the tracker's in-memory output per frame index (`{athlete_id: TrackedObject}`, sampled at the configured fps).
Every tracked athlete with a box gets a pose, so the bench can tell when the user's pose landed on the partner; only the
user's own pose ("self") is kept in the result. Partner and bystander poses never leave this function (D6). Logs carry the
job ID, timings, fps and thread count only (`job_logging`); the fps and thread count are also stored with the result.
"""

import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from bjj_roll_workers.geometry import InvalidCoordinateError
from bjj_roll_workers.job_logging import log_job_event
from bjj_roll_workers.pose import Pose, PoseKeypoints, check_pose_output
from bjj_roll_workers.pose_bench import PoseBenchReport, is_tangled, is_tangled_miss, summarise_bench
from bjj_roll_workers.pose_config import PoseConfig
from bjj_roll_workers.tracker import Frame, FrameTracks
from bjj_roll_workers.tracker_runner import OWN_ATHLETE_ID


@dataclass(frozen=True)
class PoseRunInfo:
    frames_per_second: int
    intra_op_threads: int


@dataclass(frozen=True)
class FramePose:
    """The user's own keypoints on one frame; None when the tracker had no box for the user there."""

    frame_index: int
    keypoints: PoseKeypoints | None


@dataclass(frozen=True)
class VideoPoseResult:
    video_id: str
    frames: tuple[FramePose, ...]
    bench: PoseBenchReport
    run: PoseRunInfo


def estimate_video_poses(
    job_id: str, video_id: str, frames: Sequence[Frame], tracks: Mapping[int, FrameTracks], pose: Pose, config: PoseConfig
) -> VideoPoseResult:
    """Estimate the user's pose on every tracked frame (frame index = position in `frames`)."""
    if any(OWN_ATHLETE_ID not in frame_tracks for frame_tracks in tracks.values()):
        raise ValueError("every tracked frame needs the user's own track")
    run = PoseRunInfo(frames_per_second=config.frames_per_second, intra_op_threads=config.intra_op_threads)
    started_at = time.monotonic()
    log_job_event("pose_run_started", job_id, frames_per_second=run.frames_per_second, intra_op_threads=run.intra_op_threads)
    own_poses: list[FramePose] = []
    tangled_frame_count = missed_tangled_frame_count = 0
    for frame_index in sorted(tracks):
        if not 0 <= frame_index < len(frames) or frames[frame_index].frame_index != frame_index:
            raise ValueError("tracks must refer to frames of this video")
        frame, frame_tracks = frames[frame_index], tracks[frame_index]
        poses: dict[str, PoseKeypoints] = {}
        for athlete_id, tracked in frame_tracks.items():
            if tracked.box is None:
                continue
            if tracked.box.x_max > frame.size.width or tracked.box.y_max > frame.size.height:
                raise InvalidCoordinateError("box is outside the frame")
            keypoints = pose.estimate(frame, tracked.box)
            check_pose_output(frame, keypoints)
            poses[athlete_id] = keypoints
        own_keypoints = poses.get(OWN_ATHLETE_ID)
        if is_tangled(frame_tracks, OWN_ATHLETE_ID):
            tangled_frame_count += 1
            missed_tangled_frame_count += is_tangled_miss(own_keypoints, frame_tracks[OWN_ATHLETE_ID])
        own_poses.append(FramePose(frame_index=frame_index, keypoints=own_keypoints))
    log_job_event(
        "pose_run_finished",
        job_id,
        duration_seconds=time.monotonic() - started_at,
        frames_per_second=run.frames_per_second,
        intra_op_threads=run.intra_op_threads,
    )
    return VideoPoseResult(
        video_id=video_id,
        frames=tuple(own_poses),
        bench=summarise_bench(len(own_poses), tangled_frame_count, missed_tangled_frame_count),
        run=run,
    )
