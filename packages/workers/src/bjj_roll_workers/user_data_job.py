"""Runs one user-data job inside a Modal function and keeps user data out of logs and errors (HEN-227)."""

import time
from collections.abc import Callable

from bjj_roll_workers.job_logging import log_job_event
from bjj_roll_workers.modal_call_input import InvalidModalCallInputError, ModalCallInput, parse_modal_call_input

type JobHandler = Callable[[ModalCallInput], dict[str, object]]


def run_user_data_job(job_id: object, input_object_key: object, handler: JobHandler) -> dict[str, object]:
    """Validate the call input, run the handler and return a job result (ARCHITECTURE §3.5).

    An exception is logged as the job ID and its class name only; the message, traceback and inputs are dropped.
    """
    try:
        job = parse_modal_call_input(job_id, input_object_key)
    except InvalidModalCallInputError:
        log_job_event("user_data_job_rejected", None, error_class=InvalidModalCallInputError.__name__)
        raise InvalidModalCallInputError() from None
    started_at = time.monotonic()
    log_job_event("user_data_job_started", job.job_id)
    try:
        output = handler(job)
    except Exception as error:  # noqa: BLE001 - every failure becomes a job result without its message.
        log_job_event("user_data_job_failed", job.job_id, duration_seconds=time.monotonic() - started_at, error_class=type(error).__name__)
        return {"outcome": "failed", "jobId": job.job_id, "errorClass": "internal", "retryable": True}
    log_job_event("user_data_job_succeeded", job.job_id, duration_seconds=time.monotonic() - started_at)
    return {"outcome": "succeeded", "jobId": job.job_id, **output}
