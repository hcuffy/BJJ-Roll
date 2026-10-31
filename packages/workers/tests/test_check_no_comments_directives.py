import subprocess
import sys
from pathlib import Path

import pytest

CHECKER = Path(__file__).resolve().parents[1] / "scripts" / "check_no_comments.py"


def run_checker(tmp_path: Path, source: str) -> subprocess.CompletedProcess[str]:
    target = tmp_path / "sample.py"
    target.write_text(source, encoding="utf-8")
    return subprocess.run([sys.executable, str(CHECKER), str(target)], capture_output=True, text=True, check=False)


@pytest.mark.parametrize(
    "source",
    [
        "total = 1\n",
        "#!/usr/bin/env python3\ntotal = 1\n",
        "import os  # noqa: F401 - imported for its side effect\n",
        "total: int = 'a'  # type: ignore[assignment]  # wrong type on purpose\n",
        "text = '# not a comment'\n",
    ],
)
def test_check_no_comments_passes_code_and_directives_with_a_reason(tmp_path: Path, source: str) -> None:
    assert run_checker(tmp_path, source).returncode == 0


@pytest.mark.parametrize(
    "source",
    [
        "# explains the next line\ntotal = 1\n",
        "total = 1  # trailing note\n",
        '"""Module docstring."""\ntotal = 1\n',
        'def run() -> None:\n    """Function docstring."""\n',
        'class Job:\n    """Class docstring."""\n',
        "import os  # noqa: F401\n",
        "total: int = 'a'  # type: ignore[assignment]\n",
        "total = 1\n#!/usr/bin/env python3\n",
    ],
)
def test_check_no_comments_fails_prose_comments_docstrings_and_bare_directives(tmp_path: Path, source: str) -> None:
    result = run_checker(tmp_path, source)

    assert result.returncode == 1
    assert "sample.py:" in result.stdout
