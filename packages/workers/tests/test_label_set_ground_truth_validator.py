import copy
import json
from collections.abc import Callable
from pathlib import Path

import pytest

from bjj_roll_workers.label_set import GroundTruthError, load_ground_truth, validate_ground_truth

VALID_FIXTURE = Path(__file__).parent / "fixtures" / "ground_truth_valid.json"


def _valid() -> dict:
    return json.loads(VALID_FIXTURE.read_text(encoding="utf-8"))


def test_ground_truth_valid_fixture_passes() -> None:
    ground_truth = load_ground_truth(VALID_FIXTURE)
    assert ground_truth.video_id == "3f1c2b7e-8a4d-4c6b-9e2f-1a2b3c4d5e6f"
    assert ground_truth.style == "gi"
    assert [segment.class_id for segment in ground_truth.positions] == ["standing", "closed_guard", "side_control"]
    assert [event.class_id for event in ground_truth.events] == ["guard_pull", "sweep", "submission", "submission"]
    assert ground_truth.events[2].outcome == "attempt"


def test_ground_truth_valid_no_gi_file_passes() -> None:
    data = _valid()
    data["style"] = "no-gi"
    data["events"] = [event for event in data["events"] if event.get("detail") not in {"spider_sweep", "cross_collar"}]
    assert validate_ground_truth(data).style == "no-gi"


def _set(path: tuple, value: object) -> Callable[[dict], None]:
    def mutate(data: dict) -> None:
        target = data
        for key in path[:-1]:
            target = target[key]
        target[path[-1]] = value

    return mutate


def _delete(path: tuple) -> Callable[[dict], None]:
    def mutate(data: dict) -> None:
        target = data
        for key in path[:-1]:
            target = target[key]
        del target[path[-1]]

    return mutate


REJECTIONS = [
    pytest.param(_set(("positions", 1, "class"), "x_guard"), "unknown_class", id="position-class-outside-set"),
    pytest.param(_set(("events", 0, "class"), "arm_drag"), "unknown_class", id="event-class-outside-set"),
    pytest.param(_set(("positions", 0, "class"), "takedown"), "unknown_class", id="event-class-in-position-lane"),
    pytest.param(_set(("positions", 1, "start"), 10), "overlap", id="overlapping-positions"),
    pytest.param(_delete(("style",)), "style", id="missing-style"),
    pytest.param(_set(("style",), "nogi"), "style", id="unknown-style"),
    pytest.param(_set(("style",), "no-gi"), "gi_only_detail", id="gi-detail-on-no-gi"),
    pytest.param(_delete(("events", 2, "outcome")), "missing_outcome", id="submission-without-outcome"),
    pytest.param(_set(("notes",), "good roll"), "unknown_field", id="extra-top-level-field"),
    pytest.param(_set(("positions", 0, "comment"), "slow start"), "unknown_field", id="extra-position-field"),
    pytest.param(_set(("events", 1, "filename"), "IMG_4412.MOV"), "unknown_field", id="extra-event-field"),
]


@pytest.mark.parametrize(("mutate", "rule"), REJECTIONS)
def test_ground_truth_validator_rejects(mutate: Callable[[dict], None], rule: str) -> None:
    data = _valid()
    mutate(data)
    with pytest.raises(GroundTruthError) as raised:
        validate_ground_truth(data)
    assert raised.value.rule == rule


MORE_REJECTIONS = [
    pytest.param(_set(("video_id",), "IMG_4412.MOV"), "video_id", id="filename-as-video-id"),
    pytest.param(_set(("positions", 0, "role"), "guard"), "role", id="unknown-role"),
    pytest.param(_set(("positions", 0, "end"), 0), "time", id="empty-segment"),
    pytest.param(_set(("events", 0, "detail"), "berimbolo"), "unknown_detail", id="detail-not-in-pick-list"),
    pytest.param(_set(("events", 0, "outcome"), "finish"), "outcome", id="outcome-on-non-submission"),
    pytest.param(_set(("events", 2, "outcome"), "tap"), "outcome", id="unknown-outcome"),
    pytest.param(_set(("events", 0, "start"), 1), "time", id="event-with-time-and-span"),
    pytest.param(_set(("events", 0, "time"), True), "time", id="boolean-time"),
]


@pytest.mark.parametrize(("mutate", "rule"), MORE_REJECTIONS)
def test_ground_truth_validator_rejects_malformed_values(mutate: Callable[[dict], None], rule: str) -> None:
    data = _valid()
    mutate(data)
    with pytest.raises(GroundTruthError) as raised:
        validate_ground_truth(data)
    assert raised.value.rule == rule


def test_ground_truth_error_never_echoes_file_values() -> None:
    data = copy.deepcopy(_valid())
    data["events"][1]["filename"] = "IMG_4412.MOV"
    with pytest.raises(GroundTruthError) as raised:
        validate_ground_truth(data)
    assert "IMG_4412" not in str(raised.value)
    assert "filename" not in str(raised.value)


def _escape_event(**fields: object) -> dict:
    data = _valid()
    data["events"].append({"time": 80, "class": "escape", **fields})
    return data


@pytest.mark.parametrize(
    "fields",
    [
        pytest.param({"detail": "mount_escape"}, id="no-variant"),
        pytest.param({"detail": "mount_escape", "variant": None}, id="null-variant"),
        pytest.param({"detail": "mount_escape", "variant": "elbow_knee"}, id="listed-variant"),
    ],
)
def test_ground_truth_accepts_null_or_listed_variant(fields: dict) -> None:
    event = validate_ground_truth(_escape_event(**fields)).events[-1]
    assert event.detail == fields["detail"]
    assert event.variant == fields.get("variant")


@pytest.mark.parametrize(
    "fields",
    [
        pytest.param({"detail": "mount_escape", "variant": "bridge_roll"}, id="unknown-variant"),
        pytest.param({"detail": "mount_escape", "variant": "Upa"}, id="variant-wrong-case"),
        pytest.param({"detail": "mount_escape", "variant": 1}, id="variant-not-a-string"),
        pytest.param({"detail": "back_escape", "variant": "upa"}, id="variant-on-detail-without-variants"),
        pytest.param({"variant": "upa"}, id="variant-without-detail"),
        pytest.param({"detail": "back_escape", "variant": None}, id="null-variant-on-detail-without-variants"),
        pytest.param({"variant": None}, id="null-variant-without-detail"),
    ],
)
def test_ground_truth_rejects_unknown_variant(fields: dict) -> None:
    with pytest.raises(GroundTruthError) as raised:
        validate_ground_truth(_escape_event(**fields))
    assert raised.value.rule == "unknown_variant"
    assert raised.value.path == "$.events[4].variant"
    assert str(raised.value) == "unknown_variant at $.events[4].variant"


@pytest.mark.parametrize("value", [float("inf"), float("-inf"), float("nan")], ids=["infinity", "minus-infinity", "nan"])
@pytest.mark.parametrize(
    ("location", "path"),
    [
        pytest.param(("positions", 2, "end"), "$.positions[2].end", id="segment-end"),
        pytest.param(("positions", 0, "start"), "$.positions[0].start", id="segment-start"),
        pytest.param(("events", 0, "time"), "$.events[0].time", id="event-time"),
    ],
)
def test_ground_truth_rejects_non_finite_times(value: float, location: tuple, path: str) -> None:
    data = _valid()
    _set(location, value)(data)
    with pytest.raises(GroundTruthError) as raised:
        validate_ground_truth(data)
    assert raised.value.rule == "time"
    assert raised.value.path == path
    assert str(raised.value) == f"time at {path}"
