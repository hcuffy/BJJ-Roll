"""Validator for the only arguments a user-data Modal function receives (HEN-227).

Mirrors `modalCallInputSchema` in packages/shared/src/schemas/jobContract.ts until JSON Schema generation lands (ARCHITECTURE §3.6).
"""

import re
from dataclasses import dataclass

_UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
_JOB_ID_PATTERN = re.compile(_UUID_PATTERN, re.IGNORECASE)
_INPUT_OBJECT_KEY_PATTERN = re.compile(rf"videos/{_UUID_PATTERN}/(source|transcode)\.[a-z0-9]{{2,4}}")


class InvalidModalCallInputError(ValueError):
    """Raised with a fixed message: the rejected value may hold a URL, email or filename and is never echoed."""

    def __init__(self) -> None:
        super().__init__("invalid Modal call input")


@dataclass(frozen=True)
class ModalCallInput:
    job_id: str
    input_object_key: str


def parse_modal_call_input(job_id: object, input_object_key: object) -> ModalCallInput:
    """Accept a job ID and a server-built object key; reject bytes, URLs, query strings, emails and filenames."""
    if not isinstance(job_id, str) or not isinstance(input_object_key, str):
        raise InvalidModalCallInputError()
    if _JOB_ID_PATTERN.fullmatch(job_id) is None or _INPUT_OBJECT_KEY_PATTERN.fullmatch(input_object_key) is None:
        raise InvalidModalCallInputError()
    return ModalCallInput(job_id=job_id, input_object_key=input_object_key)
