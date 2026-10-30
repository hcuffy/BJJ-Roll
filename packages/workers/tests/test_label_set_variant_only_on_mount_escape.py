"""HEN-316: the `variant` key (a value or null) is allowed only on mount_escape events; any other event carrying it is rejected."""

import json
from pathlib import Path

import pytest

from bjj_roll_workers.label_set import GroundTruthError, validate_ground_truth

VALID_FIXTURE = Path(__file__).parent / "fixtures" / "ground_truth_valid.json"


def _with_event(event: dict) -> dict:
    data = json.loads(VALID_FIXTURE.read_text(encoding="utf-8"))
    data["events"].append({"time": 80, **event})
    return data


@pytest.mark.parametrize("value", ["upa", None], ids=["variant-value", "variant-null"])
def test_mount_escape_event_accepts_variant_value_or_null(value: object) -> None:
    event = validate_ground_truth(_with_event({"class": "escape", "detail": "mount_escape", "variant": value})).events[-1]
    assert (event.class_id, event.detail, event.variant) == ("escape", "mount_escape", value)


OTHER_EVENTS = [
    pytest.param({"class": "escape", "detail": "side_control_escape"}, id="other-escape-detail"),
    pytest.param({"class": "escape"}, id="escape-without-detail"),
    pytest.param({"class": "sweep", "detail": "scissor"}, id="sweep"),
    pytest.param({"class": "takedown"}, id="takedown-without-detail"),
    pytest.param({"class": "submission", "detail": "armbar", "outcome": "attempt"}, id="submission"),
]


@pytest.mark.parametrize("value", ["upa", None], ids=["variant-value", "variant-null"])
@pytest.mark.parametrize("event", OTHER_EVENTS)
def test_other_event_with_variant_key_is_rejected(event: dict, value: object) -> None:
    with pytest.raises(GroundTruthError) as raised:
        validate_ground_truth(_with_event({**event, "variant": value}))
    assert raised.value.rule == "unknown_variant"
    assert raised.value.path == "$.events[4].variant"


@pytest.mark.parametrize("event", OTHER_EVENTS)
def test_other_event_without_variant_key_still_passes(event: dict) -> None:
    assert validate_ground_truth(_with_event(event)).events[-1].variant is None
