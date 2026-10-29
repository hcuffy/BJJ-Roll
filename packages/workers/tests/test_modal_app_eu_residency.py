"""HEN-227: static proof that every user-data Modal function runs and routes in the EU without memory snapshots.

Reads `modal_app.py` as a syntax tree and never imports `modal`, so nothing here reaches Modal's servers.
"""

import ast
from pathlib import Path

MODAL_APP_PATH = Path(__file__).resolve().parents[1] / "src" / "bjj_roll_workers" / "modal_app.py"
USER_DATA_FUNCTIONS = {"track_video", "classify_video", "render_masked_video"}
REQUIRED_KEYWORDS = {"region": "eu", "routing_region": "eu-west", "enable_memory_snapshot": False}


def _modal_app_tree() -> ast.Module:
    return ast.parse(MODAL_APP_PATH.read_text(encoding="utf-8"), filename=str(MODAL_APP_PATH))


def _app_decorators(function: ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef) -> list[ast.expr]:
    def is_app_attribute(node: ast.expr) -> bool:
        return isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "app"

    return [decorator for decorator in function.decorator_list if is_app_attribute(decorator.func if isinstance(decorator, ast.Call) else decorator)]


def _decorated_definitions() -> dict[str, ast.expr]:
    definitions: dict[str, ast.expr] = {}
    for node in ast.walk(_modal_app_tree()):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            for decorator in _app_decorators(node):
                definitions[node.name] = decorator
    return definitions


def test_modal_app_eu_residency_covers_every_user_data_function() -> None:
    assert set(_decorated_definitions()) == USER_DATA_FUNCTIONS


def test_modal_app_eu_residency_pins_region_and_routing_and_disables_snapshots() -> None:
    for name, decorator in _decorated_definitions().items():
        assert isinstance(decorator, ast.Call), f"{name} must call app.function(...)"
        assert isinstance(decorator.func, ast.Attribute) and decorator.func.attr == "function", f"{name} must use app.function"
        assert all(keyword.arg is not None for keyword in decorator.keywords), f"{name} must not pass **kwargs"
        literal_keywords = {keyword.arg: keyword.value.value for keyword in decorator.keywords if isinstance(keyword.value, ast.Constant)}
        for keyword, expected in REQUIRED_KEYWORDS.items():
            assert keyword in literal_keywords, f"{name} must set {keyword} as a literal"
            assert literal_keywords[keyword] is expected or literal_keywords[keyword] == expected, f"{name}: {keyword} must be {expected!r}"


def test_modal_app_eu_residency_has_no_snapshot_or_spawn() -> None:
    for node in ast.walk(_modal_app_tree()):
        if isinstance(node, ast.keyword):
            assert node.arg not in {"snap", "experimental_options"}, "memory snapshot options are not allowed on user-data functions"
        if isinstance(node, ast.Attribute):
            assert "spawn" not in node.attr, "only .remote() may call a user-data function"
