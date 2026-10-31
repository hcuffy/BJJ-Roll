import json
import re
from pathlib import Path

import pytest

from bjj_roll_workers.label_set import load_label_set, parse_label_set

LABEL_SET_FILE = Path(__file__).parents[1] / "src" / "bjj_roll_workers" / "label_set_v1.json"

POSITION_IDS = (
    "standing",
    "clinch",
    "closed_guard",
    "half_guard",
    "open_guard",
    "headquarters",
    "side_control",
    "north_south",
    "knee_on_belly",
    "mount",
    "back_control",
    "turtle",
    "front_headlock",
    "crucifix",
    "truck",
    "leg_entanglement",
    "scramble",
    "unknown",
)
EVENT_IDS = ("takedown", "guard_pull", "guard_pass", "sweep", "back_take", "submission", "escape", "transition", "reset")

GI_ONLY_DETAILS = {
    "standing": {"sleeve_control"},
    "open_guard": {"spider", "lasso", "collar_sleeve", "worm", "squid", "lapel_guard_other"},
    "sweep": {"spider_sweep", "lasso_sweep", "collar_sleeve_sweep", "lapel_sweep"},
    "submission": {"cross_collar", "bow_and_arrow", "ezekiel", "baseball_bat", "loop", "clock", "paper_cutter", "lapel_choke"},
}


def test_label_set_loads_with_18_positions_and_9_events() -> None:
    label_set = load_label_set()
    assert label_set.version == 1
    assert label_set.position_ids == POSITION_IDS
    assert label_set.event_ids == EVENT_IDS
    assert len(label_set.position_ids) == 18
    assert len(label_set.event_ids) == 9
    assert label_set.roles == ("top", "bottom", "neutral")
    assert label_set.submission_outcomes == ("attempt", "defended", "finish")
    assert label_set.styles == ("gi", "no-gi")


@pytest.mark.parametrize("style", ["gi", "no-gi"])
def test_label_set_level1_is_the_same_for_gi_and_no_gi(style: str) -> None:
    assert load_label_set().level1_classes(style) == (POSITION_IDS, EVENT_IDS)


def test_label_set_level1_rejects_unknown_style() -> None:
    with pytest.raises(ValueError):
        load_label_set().level1_classes("nogi")


@pytest.mark.parametrize("flag", ["gi_only", "no_gi_only", "style"])
def test_label_set_rejects_a_style_flag_on_a_level1_class(flag: str) -> None:
    raw = json.loads(LABEL_SET_FILE.read_text(encoding="utf-8"))
    parse_label_set(raw)
    raw["positions"][0][flag] = True
    with pytest.raises(ValueError):
        parse_label_set(raw)


def test_label_set_no_gi_pick_lists_hide_every_gi_detail() -> None:
    label_set = load_label_set()
    for class_id in POSITION_IDS + EVENT_IDS:
        gi_list = set(label_set.pick_list(class_id, "gi"))
        no_gi_list = set(label_set.pick_list(class_id, "no-gi"))
        gi_only = GI_ONLY_DETAILS.get(class_id, set())
        assert gi_only <= gi_list, class_id
        assert not (gi_only & no_gi_list), class_id
        assert gi_list - no_gi_list == gi_only, class_id


def test_label_set_pick_lists_keep_source_details() -> None:
    label_set = load_label_set()
    assert label_set.pick_list("closed_guard", "gi") == ()
    assert label_set.pick_list("half_guard", "no-gi") == (
        "knee_shield",
        "z_guard",
        "lockdown",
        "deep_half",
        "quarter_guard",
        "underhook_half",
        "dogfight",
    )
    assert label_set.pick_list("back_control", "gi") == ("two_hooks", "body_triangle", "one_hook", "chest_to_back")
    assert "mount_escape" in label_set.pick_list("escape", "no-gi")
    assert label_set.pick_list("submission", "no-gi")[:2] == ("rear_naked", "arm_in_rear_naked")
    assert label_set.pick_list("submission", "gi")[-1] == "twister"
    assert len(label_set.pick_list("submission", "gi")) == 40
    assert len(label_set.pick_list("submission", "no-gi")) == 32
    assert len(label_set.pick_list("takedown", "gi")) == 27


def test_label_set_pick_list_rejects_unknown_class() -> None:
    with pytest.raises(ValueError):
        load_label_set().pick_list("arm_drag", "gi")


SNAKE_CASE = re.compile("[a-z0-9_]+")


def _raw_label_set() -> dict:
    return json.loads(LABEL_SET_FILE.read_text(encoding="utf-8"))


def test_label_set_ids_are_snake_case() -> None:
    raw = _raw_label_set()
    for label in raw["positions"] + raw["events"]:
        assert SNAKE_CASE.fullmatch(label["id"]), label["id"]
        for detail in label["details"]:
            assert SNAKE_CASE.fullmatch(detail["id"]), detail["id"]
            for variant in detail.get("variants", []):
                assert SNAKE_CASE.fullmatch(variant), variant


def test_label_set_details_keep_the_source_name_as_label() -> None:
    label_set = load_label_set()
    labels = {(label.id, detail.id): detail.label for label in label_set.positions + label_set.events for detail in label.details}
    assert all(isinstance(text, str) and text for text in labels.values())
    assert labels[("standing", "neutral_stance")] == "neutral stance"
    assert labels[("standing", "sleeve_control")] == "sleeve control"
    assert labels[("clinch", "over_under")] == "over-under"
    assert labels[("back_control", "two_hooks")] == "two hooks"
    assert labels[("half_guard", "z_guard")] == "z_guard"
    assert labels[("guard_pass", "over_under")] == "over_under"


def test_label_set_mount_escape_is_one_item_with_variants() -> None:
    label_set = load_label_set()
    assert label_set.pick_list("escape", "no-gi").count("mount_escape") == 1
    assert label_set.variants("escape", "mount_escape") == ("upa", "elbow_knee", "to_half")
    assert label_set.variants("escape", "back_escape") == ()


def _first_detail(raw: dict) -> dict:
    return raw["positions"][0]["details"][0]


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(lambda raw: _first_detail(raw).update(id="neutral stance"), id="detail-id-with-space"),
        pytest.param(lambda raw: _first_detail(raw).update(id="over-under"), id="detail-id-with-hyphen"),
        pytest.param(lambda raw: _first_detail(raw).update(id="Neutral_Stance"), id="detail-id-upper-case"),
        pytest.param(lambda raw: _first_detail(raw).update(id=""), id="detail-id-empty"),
        pytest.param(lambda raw: raw["positions"][0].update(id="Standing"), id="class-id-upper-case"),
        pytest.param(lambda raw: raw["events"][6]["details"][0].update(variants=["elbow-knee"]), id="variant-id-with-hyphen"),
        pytest.param(lambda raw: _first_detail(raw).pop("label"), id="detail-label-missing"),
        pytest.param(lambda raw: _first_detail(raw).update(label=3), id="detail-label-not-a-string"),
    ],
)
def test_label_set_rejects_bad_ids_and_labels(mutate) -> None:
    raw = _raw_label_set()
    parse_label_set(raw)
    mutate(raw)
    with pytest.raises(ValueError):
        parse_label_set(raw)
