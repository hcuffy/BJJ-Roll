"""HEN-227: a Modal function accepts a job ID and a server-built object key, nothing else. Synthetic values only."""

import pytest

from bjj_roll_workers.modal_call_input import InvalidModalCallInputError, ModalCallInput, parse_modal_call_input

JOB_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
OBJECT_KEY = "videos/3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f/source.mp4"
EXAMPLE_DOMAIN = "example.invalid"
SYNTHETIC_EMAIL = f"athlete@{EXAMPLE_DOMAIN}"
PRESIGNED_QUERY = "X-Amz-Expires=300&X-Amz-Signature=synthetic"


def test_modal_call_input_accepts_job_id_and_object_key() -> None:
    assert parse_modal_call_input(JOB_ID, OBJECT_KEY) == ModalCallInput(job_id=JOB_ID, input_object_key=OBJECT_KEY)
    assert parse_modal_call_input(JOB_ID, OBJECT_KEY.replace("source", "transcode")).input_object_key.endswith("transcode.mp4")


@pytest.mark.parametrize(
    ("job_id", "input_object_key"),
    [
        pytest.param(JOB_ID, b"\x00\x01video-bytes", id="bytes"),
        pytest.param(JOB_ID, bytearray(b"\x00\x01"), id="bytearray"),
        pytest.param(JOB_ID, f"https://storage.example.invalid/{OBJECT_KEY}?{PRESIGNED_QUERY}", id="url-with-query"),
        pytest.param(JOB_ID, f"{OBJECT_KEY}?{PRESIGNED_QUERY}", id="key-with-query"),
        pytest.param(JOB_ID, f"videos/3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f/{SYNTHETIC_EMAIL}.mp4", id="email"),
        pytest.param(SYNTHETIC_EMAIL, OBJECT_KEY, id="email-as-job-id"),
        pytest.param(JOB_ID, "videos/3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f/IMG_4412.MOV", id="filename"),
        pytest.param(JOB_ID, "open mat roll.mp4", id="bare-filename"),
        pytest.param(JOB_ID, f"{OBJECT_KEY}\n", id="trailing-newline"),
        pytest.param("job-1", OBJECT_KEY, id="job-id-not-uuid"),
    ],
)
def test_modal_call_input_rejects_user_data(job_id: object, input_object_key: object) -> None:
    with pytest.raises(InvalidModalCallInputError) as raised:
        parse_modal_call_input(job_id, input_object_key)
    assert str(raised.value) == "invalid Modal call input"
