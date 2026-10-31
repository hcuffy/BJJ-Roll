import json
import math
import re
from dataclasses import dataclass
from functools import cache
from itertools import pairwise
from pathlib import Path

_LABEL_SET_PATH = Path(__file__).with_name("label_set_v1.json")
_ID_PATTERN = re.compile("^[a-z0-9_]+$")
_UUID_PATTERN = re.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)


@dataclass(frozen=True)
class Detail:
    id: str
    label: str
    gi_only: bool
    variants: tuple[str, ...]


@dataclass(frozen=True)
class LabelClass:
    id: str
    name: str
    details: tuple[Detail, ...]


@dataclass(frozen=True)
class LabelSet:
    version: int
    styles: tuple[str, ...]
    roles: tuple[str, ...]
    submission_outcomes: tuple[str, ...]
    positions: tuple[LabelClass, ...]
    events: tuple[LabelClass, ...]

    @property
    def position_ids(self) -> tuple[str, ...]:
        return tuple(label.id for label in self.positions)

    @property
    def event_ids(self) -> tuple[str, ...]:
        return tuple(label.id for label in self.events)

    def level1_classes(self, style: str) -> tuple[tuple[str, ...], tuple[str, ...]]:
        self._require_style(style)
        return self.position_ids, self.event_ids

    def pick_list(self, class_id: str, style: str) -> tuple[str, ...]:
        self._require_style(style)
        for label in self.positions + self.events:
            if label.id == class_id:
                return tuple(detail.id for detail in label.details if style == "gi" or not detail.gi_only)
        raise ValueError("unknown label class")

    def variants(self, class_id: str, detail_id: str) -> tuple[str, ...]:
        for label in self.positions + self.events:
            if label.id == class_id:
                for detail in label.details:
                    if detail.id == detail_id:
                        return detail.variants
        raise ValueError("unknown label detail")

    def _require_style(self, style: str) -> None:
        if style not in self.styles:
            raise ValueError("unknown style")


_CLASS_FIELDS = {"id", "name", "details", "note"}
_DETAIL_FIELDS = {"id", "label", "gi_only", "group", "variants"}


def _parse_class(raw: dict) -> LabelClass:
    if set(raw) - _CLASS_FIELDS or any(set(detail) - _DETAIL_FIELDS for detail in raw["details"]):
        raise ValueError("unknown field in label set")
    details = tuple(_parse_detail(detail) for detail in raw["details"])
    if len({detail.id for detail in details}) != len(details):
        raise ValueError("duplicate detail id in label set")
    return LabelClass(id=_label_id(raw["id"]), name=raw["name"], details=details)


def _label_id(value: object) -> str:
    if not isinstance(value, str) or _ID_PATTERN.fullmatch(value) is None:
        raise ValueError("label set id is not snake_case")
    return value


def _parse_detail(raw: dict) -> Detail:
    if not isinstance(raw.get("label"), str) or not raw["label"]:
        raise ValueError("label set detail needs a label")
    if type(raw.get("gi_only", False)) is not bool:
        raise ValueError("label set gi_only is not true or false")
    variants = tuple(_label_id(variant) for variant in raw.get("variants", ()))
    if len(set(variants)) != len(variants):
        raise ValueError("duplicate variant id in label set")
    return Detail(
        id=_label_id(raw["id"]),
        label=raw["label"],
        gi_only=raw.get("gi_only", False),
        variants=variants,
    )


def parse_label_set(raw: dict) -> LabelSet:
    label_set = LabelSet(
        version=raw["version"],
        styles=tuple(raw["styles"]),
        roles=tuple(raw["roles"]),
        submission_outcomes=tuple(raw["submission_outcomes"]),
        positions=tuple(_parse_class(label) for label in raw["positions"]),
        events=tuple(_parse_class(label) for label in raw["events"]),
    )
    class_ids = label_set.position_ids + label_set.event_ids
    if len(set(class_ids)) != len(class_ids):
        raise ValueError("duplicate class id in label set")
    return label_set


@cache
def load_label_set() -> LabelSet:
    return parse_label_set(json.loads(_LABEL_SET_PATH.read_text(encoding="utf-8")))


class GroundTruthError(ValueError):
    def __init__(self, rule: str, path: str) -> None:
        super().__init__(f"{rule} at {path}")
        self.rule = rule
        self.path = path


@dataclass(frozen=True)
class PositionSegment:
    start: float
    end: float
    class_id: str
    role: str


@dataclass(frozen=True)
class Event:
    start: float
    end: float | None
    class_id: str
    detail: str | None
    variant: str | None
    outcome: str | None


@dataclass(frozen=True)
class GroundTruth:
    video_id: str
    style: str
    positions: tuple[PositionSegment, ...]
    events: tuple[Event, ...]


_TOP_LEVEL_FIELDS = {"video_id", "style", "positions", "events"}
_POSITION_FIELDS = {"start", "end", "class", "role"}
_EVENT_FIELDS = {"time", "start", "end", "class", "detail", "variant", "outcome"}


def _require_object(value: object, fields: set[str], required: set[str], path: str) -> dict:
    if not isinstance(value, dict):
        raise GroundTruthError("not_an_object", path)
    if set(value) - fields:
        raise GroundTruthError("unknown_field", path)
    for name in sorted(required - set(value)):
        raise GroundTruthError("missing_field", f"{path}.{name}")
    return value


def _seconds(value: object, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value) or value < 0:
        raise GroundTruthError("time", path)
    return float(value)


def _span(raw: dict, path: str) -> tuple[float, float]:
    start = _seconds(raw["start"], f"{path}.start")
    end = _seconds(raw["end"], f"{path}.end")
    if end <= start:
        raise GroundTruthError("time", path)
    return start, end


def _detail(label_set: LabelSet, class_id: str, detail: object, style: str, path: str) -> str:
    if not isinstance(detail, str) or detail not in label_set.pick_list(class_id, "gi"):
        raise GroundTruthError("unknown_detail", path)
    if detail not in label_set.pick_list(class_id, style):
        raise GroundTruthError("gi_only_detail", path)
    return detail


def _variant(label_set: LabelSet, class_id: str, detail: str | None, raw: dict, path: str) -> str | None:
    if "variant" not in raw:
        return None
    allowed = label_set.variants(class_id, detail) if detail is not None else ()
    if not allowed:
        raise GroundTruthError("unknown_variant", path)
    variant = raw["variant"]
    if variant is None:
        return None
    if not isinstance(variant, str) or variant not in allowed:
        raise GroundTruthError("unknown_variant", path)
    return variant


def _position(label_set: LabelSet, raw: object, path: str) -> PositionSegment:
    raw = _require_object(raw, _POSITION_FIELDS, _POSITION_FIELDS, path)
    if raw["class"] not in label_set.position_ids:
        raise GroundTruthError("unknown_class", f"{path}.class")
    if raw["role"] not in label_set.roles:
        raise GroundTruthError("role", f"{path}.role")
    start, end = _span(raw, path)
    return PositionSegment(start=start, end=end, class_id=raw["class"], role=raw["role"])


def _event(label_set: LabelSet, raw: object, style: str, path: str) -> Event:
    raw = _require_object(raw, _EVENT_FIELDS, {"class"}, path)
    class_id = raw["class"]
    if class_id not in label_set.event_ids:
        raise GroundTruthError("unknown_class", f"{path}.class")
    if "time" in raw:
        if "start" in raw or "end" in raw:
            raise GroundTruthError("time", path)
        start, end = _seconds(raw["time"], f"{path}.time"), None
    elif "start" in raw and "end" in raw:
        start, end = _span(raw, path)
    else:
        raise GroundTruthError("time", path)
    detail = _detail(label_set, class_id, raw["detail"], style, f"{path}.detail") if "detail" in raw else None
    variant = _variant(label_set, class_id, detail, raw, f"{path}.variant")
    outcome = raw.get("outcome")
    if class_id == "submission":
        if outcome is None:
            raise GroundTruthError("missing_outcome", f"{path}.outcome")
        if outcome not in label_set.submission_outcomes:
            raise GroundTruthError("outcome", f"{path}.outcome")
    elif "outcome" in raw:
        raise GroundTruthError("outcome", f"{path}.outcome")
    return Event(start=start, end=end, class_id=class_id, detail=detail, variant=variant, outcome=outcome)


def validate_ground_truth(data: object, label_set: LabelSet | None = None) -> GroundTruth:
    label_set = label_set or load_label_set()
    raw = _require_object(data, _TOP_LEVEL_FIELDS, _TOP_LEVEL_FIELDS - {"style"}, "$")
    if raw.get("style") not in label_set.styles:
        raise GroundTruthError("style", "$.style")
    style = raw["style"]
    if not isinstance(raw["video_id"], str) or _UUID_PATTERN.fullmatch(raw["video_id"]) is None:
        raise GroundTruthError("video_id", "$.video_id")
    for lane in ("positions", "events"):
        if not isinstance(raw[lane], list):
            raise GroundTruthError("not_a_list", f"$.{lane}")

    positions = tuple(_position(label_set, segment, f"$.positions[{index}]") for index, segment in enumerate(raw["positions"]))
    ordered = sorted(enumerate(positions), key=lambda item: item[1].start)
    for (_, previous), (index, current) in pairwise(ordered):
        if current.start < previous.end:
            raise GroundTruthError("overlap", f"$.positions[{index}]")

    events = tuple(_event(label_set, event, style, f"$.events[{index}]") for index, event in enumerate(raw["events"]))
    return GroundTruth(video_id=raw["video_id"], style=style, positions=positions, events=events)


def load_ground_truth(path: Path) -> GroundTruth:
    return validate_ground_truth(json.loads(path.read_text(encoding="utf-8")))
