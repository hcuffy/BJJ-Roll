"""HEN-316 gate: only `mount_escape` lists variants, and a ground-truth `variant` is an event field only (never on Lane A)."""

import json
from pathlib import Path

import pytest

from bjj_roll_workers.label_set import GroundTruthError, load_label_set, validate_ground_truth

VALID_FIXTURE = Path(__file__).parent / "fixtures" / "ground_truth_valid.json"


def test_label_set_only_mount_escape_has_variants() -> None:
    label_set = load_label_set()
    with_variants = {
        (label.id, detail.id): detail.variants for label in label_set.positions + label_set.events for detail in label.details if detail.variants
    }
    assert with_variants == {("escape", "mount_escape"): ("upa", "elbow_knee", "to_half")}


@pytest.mark.parametrize("value", [None, "upa"], ids=["null-variant", "listed-variant"])
def test_ground_truth_rejects_variant_on_a_position_segment(value: object) -> None:
    data = json.loads(VALID_FIXTURE.read_text(encoding="utf-8"))
    data["positions"][0]["variant"] = value
    with pytest.raises(GroundTruthError) as raised:
        validate_ground_truth(data)
    assert raised.value.rule == "unknown_field"
    assert raised.value.path == "$.positions[0]"
