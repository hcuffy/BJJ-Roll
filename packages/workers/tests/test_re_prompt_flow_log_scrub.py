"""HEN-317: re-prompt flow logs carry no filename, URL, token or frame bytes. Synthetic values only."""

import json

import pytest

from bjj_roll_workers.re_prompt_flow import DriftEvent, KeepTrack, PromptAnswer, ReTap, TapPoint, VideoRun, run_re_prompt_flow

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
VIDEO_ID = "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"
EXAMPLE_DOMAIN = "example.invalid"
PRESIGNED_QUERY = "X-Amz-Credential=synthetic&X-Amz-Signature=synthetic0signature"
PRESIGNED_URL = f"https://storage.{EXAMPLE_DOMAIN}/bucket/videos/{VIDEO_ID}/source.mp4?{PRESIGNED_QUERY}"
SYNTHETIC_TOKEN = f"synthetic-bearer-{EXAMPLE_DOMAIN}-0123456789"
UPLOADED_FILENAME = "open-mat-roll-IMG_4412.MOV"
FRAME_BYTES = f"synthetic frame from {UPLOADED_FILENAME}".encode()
FORBIDDEN_FRAGMENTS = [PRESIGNED_URL, PRESIGNED_QUERY, "https://", "X-Amz-", UPLOADED_FILENAME, SYNTHETIC_TOKEN, "synthetic frame", "mask_jump"]


class PoisonedTracker:
    """Drift reasons carry URL, filename and token text that must never reach the logs."""

    def __init__(self) -> None:
        self.drifts = [
            DriftEvent(frame_index=120, reason=f"mask_jump near {PRESIGNED_URL} in {UPLOADED_FILENAME}"),
            DriftEvent(frame_index=300, reason=f"mask_jump {SYNTHETIC_TOKEN}"),
        ]

    def anchor(self, tap: TapPoint) -> None:
        pass

    def next_drift(self) -> DriftEvent | None:
        return self.drifts.pop(0) if self.drifts else None


class PoisonedFrameSource:
    def frame_at(self, frame_index: int) -> bytes:
        return FRAME_BYTES


class AlternatingPrompter:
    def __init__(self) -> None:
        self.answers: list[PromptAnswer] = [ReTap(x=0.7, y=0.3), KeepTrack()]

    def ask_was_this_you(self, drift: DriftEvent, frame: bytes) -> PromptAnswer:
        return self.answers.pop(0)


def test_re_prompt_flow_logs_no_filename_url_token_or_frame_bytes(capsys: pytest.CaptureFixture[str]) -> None:
    run_re_prompt_flow(
        JOB_ID, VideoRun(VIDEO_ID, "gi", TapPoint(frame_index=0, x=0.4, y=0.5)), PoisonedTracker(), PoisonedFrameSource(), AlternatingPrompter()
    )

    captured = capsys.readouterr()
    entries = [json.loads(line) for line in captured.out.splitlines() if line]
    assert [entry["event"] for entry in entries] == ["re_prompt_flow_started", "re_prompt_flow_finished"]
    assert all(entry["jobId"] == JOB_ID for entry in entries)
    for fragment in FORBIDDEN_FRAGMENTS:
        assert fragment not in captured.out
        assert fragment not in captured.err
