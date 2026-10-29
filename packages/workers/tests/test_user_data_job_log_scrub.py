"""HEN-227: user-data job logs carry only the job ID, timings and the error class. Synthetic values only."""

import json

import pytest

from bjj_roll_workers.modal_call_input import InvalidModalCallInputError
from bjj_roll_workers.user_data_job import run_user_data_job

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
OBJECT_KEY = "videos/3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f/source.mp4"
EXAMPLE_DOMAIN = "example.invalid"
SYNTHETIC_EMAIL = f"athlete@{EXAMPLE_DOMAIN}"
PRESIGNED_QUERY = "X-Amz-Credential=synthetic&X-Amz-Signature=synthetic0signature"
PRESIGNED_URL = f"https://storage.example.invalid/bucket/{OBJECT_KEY}?{PRESIGNED_QUERY}"
SYNTHETIC_TOKEN = f"synthetic-bearer-{EXAMPLE_DOMAIN}-0123456789"
UPLOADED_FILENAME = "open-mat-roll-IMG_4412.MOV"
FORBIDDEN_FRAGMENTS = [PRESIGNED_URL, PRESIGNED_QUERY, "https://", "X-Amz-", SYNTHETIC_EMAIL, "@", UPLOADED_FILENAME, SYNTHETIC_TOKEN, OBJECT_KEY]


class VendorDownloadError(RuntimeError):
    pass


def _failing_handler(job: object) -> dict[str, object]:
    raise VendorDownloadError(f"fetch {PRESIGNED_URL} for {SYNTHETIC_EMAIL} ({UPLOADED_FILENAME}) with {SYNTHETIC_TOKEN}")


def _log_entries(output: str) -> list[dict[str, object]]:
    return [json.loads(line) for line in output.splitlines() if line]


def test_user_data_job_exception_logs_only_job_id_and_error_class(capsys: pytest.CaptureFixture[str]) -> None:
    result = run_user_data_job(JOB_ID, OBJECT_KEY, _failing_handler)

    captured = capsys.readouterr()
    print(captured.out, end="")  # Shown with `pytest -s` as the HEN-227 log-scrub evidence.
    assert result == {"outcome": "failed", "jobId": JOB_ID, "errorClass": "internal", "retryable": True}
    entries = _log_entries(captured.out)
    assert [sorted(entry) for entry in entries] == [["event", "jobId"], ["durationSeconds", "errorClass", "event", "jobId"]]
    assert entries[1] == {
        "event": "user_data_job_failed",
        "jobId": JOB_ID,
        "errorClass": "VendorDownloadError",
        "durationSeconds": entries[1]["durationSeconds"],
    }
    for fragment in FORBIDDEN_FRAGMENTS:
        assert fragment not in captured.out
        assert fragment not in captured.err


def test_user_data_job_success_logs_no_object_keys(capsys: pytest.CaptureFixture[str]) -> None:
    output_key = f"videos/3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f/jobs/{JOB_ID}/track.json"
    result = run_user_data_job(JOB_ID, OBJECT_KEY, lambda job: {"outputObjectKeys": [output_key], "needsUserConfirmation": False})

    captured = capsys.readouterr()
    assert result == {"outcome": "succeeded", "jobId": JOB_ID, "outputObjectKeys": [output_key], "needsUserConfirmation": False}
    assert [entry["event"] for entry in _log_entries(captured.out)] == ["user_data_job_started", "user_data_job_succeeded"]
    assert "videos/" not in captured.out


def test_user_data_job_invalid_input_logs_no_input(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(InvalidModalCallInputError) as raised:
        run_user_data_job(JOB_ID, PRESIGNED_URL, _failing_handler)

    captured = capsys.readouterr()
    assert raised.value.__cause__ is None
    assert raised.value.__suppress_context__
    assert _log_entries(captured.out) == [{"event": "user_data_job_rejected", "jobId": None, "errorClass": "InvalidModalCallInputError"}]
    for fragment in FORBIDDEN_FRAGMENTS:
        assert fragment not in captured.out
        assert fragment not in str(raised.value)
