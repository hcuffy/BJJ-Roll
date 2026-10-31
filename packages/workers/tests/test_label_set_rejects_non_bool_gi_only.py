import json
from pathlib import Path

import pytest

from bjj_roll_workers.label_set import parse_label_set

LABEL_SET_FILE = Path(__file__).parents[1] / "src" / "bjj_roll_workers" / "label_set_v1.json"


def _raw_with_gi_only(value: object) -> dict:
    raw = json.loads(LABEL_SET_FILE.read_text(encoding="utf-8"))
    raw["positions"][0]["details"][0]["gi_only"] = value
    return raw


@pytest.mark.parametrize("value", ["true", "false", 1, 0, 1.0, None], ids=["string-true", "string-false", "one", "zero", "float-one", "null"])
def test_label_set_rejects_gi_only_that_is_not_a_bool(value: object) -> None:
    with pytest.raises(ValueError) as raised:
        parse_label_set(_raw_with_gi_only(value))
    assert str(raised.value) == "label set gi_only is not true or false"


@pytest.mark.parametrize("value", [True, False])
def test_label_set_accepts_bool_gi_only(value: bool) -> None:
    label_set = parse_label_set(_raw_with_gi_only(value))
    assert label_set.positions[0].details[0].gi_only is value
