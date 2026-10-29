"""Modal app for user-data jobs, pinned to the EU (HEN-227).

Every user-data function sets `region="eu"`, `routing_region="eu-west"` and `enable_memory_snapshot=False`,
checked statically by tests/test_modal_app_eu_residency.py and scripts/checkModalResidency.sh.
`routing_region` is fixed at the first deploy, so the first `modal deploy` must already carry it.
Node calls these functions with `.remote()` only (HEN-48 option A). The handlers are filled in by the spikes (HEN-67, HEN-73, HEN-81).
"""

import modal

from bjj_roll_workers.modal_call_input import ModalCallInput
from bjj_roll_workers.user_data_job import run_user_data_job

app = modal.App("bjj-roll-workers")
image = modal.Image.debian_slim(python_version="3.13").add_local_python_source("bjj_roll_workers")


def _not_implemented(job: ModalCallInput) -> dict[str, object]:
    raise NotImplementedError


@app.function(image=image, region="eu", routing_region="eu-west", enable_memory_snapshot=False)
def track_video(job_id: str, input_object_key: str) -> dict[str, object]:
    return run_user_data_job(job_id, input_object_key, _not_implemented)


@app.function(image=image, region="eu", routing_region="eu-west", enable_memory_snapshot=False)
def classify_video(job_id: str, input_object_key: str) -> dict[str, object]:
    return run_user_data_job(job_id, input_object_key, _not_implemented)


@app.function(image=image, region="eu", routing_region="eu-west", enable_memory_snapshot=False)
def render_masked_video(job_id: str, input_object_key: str) -> dict[str, object]:
    return run_user_data_job(job_id, input_object_key, _not_implemented)
