import ast
import io
import re
import sys
import tokenize
from pathlib import Path

SOURCE_FOLDERS = ("src", "tests", "scripts")
DIRECTIVE_PATTERNS = (
    re.compile(r"^# noqa: [A-Z]+[0-9]+(, [A-Z]+[0-9]+)* - \S"),
    re.compile(r"^# type: ignore\[[a-z-]+(, [a-z-]+)*\]  # \S"),
)
DOCSTRING_OWNERS = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)


def is_allowed_comment(token: tokenize.TokenInfo) -> bool:
    if token.start == (1, 0) and token.string.startswith("#!"):
        return True
    return any(pattern.match(token.string) for pattern in DIRECTIVE_PATTERNS)


def comment_lines(source: str) -> list[int]:
    tokens = tokenize.generate_tokens(io.StringIO(source).readline)
    return [token.start[0] for token in tokens if token.type == tokenize.COMMENT and not is_allowed_comment(token)]


def docstring_lines(source: str) -> list[int]:
    lines = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, DOCSTRING_OWNERS) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str):
                lines.append(first.lineno)
    return lines


def find_prose(path: Path) -> list[str]:
    source = path.read_text(encoding="utf-8")
    lines = sorted(comment_lines(source) + docstring_lines(source))
    return [
        f"{path}:{line}: no prose comments or docstrings; only `# noqa: CODE - reason`, `# type: ignore[code]  # reason`, a shebang" for line in lines
    ]


def source_files(arguments: list[str]) -> list[Path]:
    if arguments:
        return [Path(argument) for argument in arguments]
    return sorted(path for folder in SOURCE_FOLDERS for path in Path(folder).rglob("*.py"))


def main(arguments: list[str]) -> int:
    findings = [finding for path in source_files(arguments) for finding in find_prose(path)]
    print("\n".join(findings) if findings else "No prose comments or docstrings in Python source.")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
