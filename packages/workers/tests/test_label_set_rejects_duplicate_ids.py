import json
from pathlib import Path

import pytest

from bjj_roll_workers.label_set import parse_label_set

LABEL_SET_FILE = Path(__file__).parents[1] / "src" / "bjj_roll_workers" / "label_set_v1.json"


def _raw() -> dict:
    return json.loads(LABEL_SET_FILE.read_text(encoding="utf-8"))


def _duplicate_detail(raw: dict) -> None:
    details = raw["positions"][0]["details"]
    details.append({**details[0], "label": "copy"})


def _duplicate_variant(raw: dict) -> None:
    detail = next(detail for label in raw["events"] for detail in label["details"] if detail.get("variants"))
    detail["variants"].append(detail["variants"][0])


def _duplicate_class_across_lanes(raw: dict) -> None:
    raw["events"].append({**raw["events"][0], "id": raw["positions"][0]["id"]})


def _duplicate_class_in_lane(raw: dict) -> None:
    raw["positions"].append(dict(raw["positions"][2]))


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(_duplicate_detail, id="duplicate-detail-id"),
        pytest.param(_duplicate_class_in_lane, id="duplicate-class-id-in-lane"),
        pytest.param(_duplicate_class_across_lanes, id="duplicate-class-id-across-lanes"),
        pytest.param(_duplicate_variant, id="duplicate-variant-id-in-detail"),
    ],
)
def test_label_set_rejects_duplicate_ids(mutate) -> None:
    raw = _raw()
    parse_label_set(raw)
    mutate(raw)
    with pytest.raises(ValueError, match="duplicate"):
        parse_label_set(raw)


def test_label_set_duplicate_variant_error_repeats_no_file_value() -> None:
    raw = _raw()
    _duplicate_variant(raw)
    with pytest.raises(ValueError) as raised:
        parse_label_set(raw)
    assert str(raised.value) == "duplicate variant id in label set"
