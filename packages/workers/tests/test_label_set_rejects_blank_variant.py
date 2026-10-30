"""HEN-316 gate: a variant on mount_escape must be exactly one of the listed ids; blank or padded strings are rejected."""

import json
from pathlib import Path

import pytest

from bjj_roll_workers.label_set import GroundTruthError, validate_ground_truth

VALID_FIXTURE = Path(__file__).parent / "fixtures" / "ground_truth_valid.json"


@pytest.mark.parametrize("value", ["", " ", " upa", "upa ", "upa\n"], ids=["empty", "space", "leading-space", "trailing-space", "trailing-newline"])
def test_mount_escape_rejects_blank_or_padded_variant(value: str) -> None:
    data = json.loads(VALID_FIXTURE.read_text(encoding="utf-8"))
    data["events"].append({"time": 80, "class": "escape", "detail": "mount_escape", "variant": value})
    with pytest.raises(GroundTruthError) as raised:
        validate_ground_truth(data)
    assert raised.value.rule == "unknown_variant"
    assert raised.value.path == "$.events[4].variant"
