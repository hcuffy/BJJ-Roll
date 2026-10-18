#!/bin/sh
# Creates a starter `.leakcheck` at the repo root when it is missing, so a fresh clone gets a working pre-commit hook.
# Never reads, prints or overwrites an existing `.leakcheck`. Not a git repository: skips silently.
# Generic secret patterns only (this repo is public), plus a marker line that keeps the hook blocking until you delete it
# and add your own personal patterns.

# Only write when this checkout is itself the git root: a non-git copy nested inside another repo must not write to the outer root.
expectedRoot=$(cd "$(dirname "$0")/.." && pwd -P) || exit 0
repositoryRoot=$(git -C "$expectedRoot" rev-parse --show-toplevel 2>/dev/null) || exit 0
repositoryRoot=$(cd "$repositoryRoot" && pwd -P) || exit 0
if [ "$repositoryRoot" != "$expectedRoot" ]; then
  exit 0
fi
patternFile="$repositoryRoot/.leakcheck"

if [ -e "$patternFile" ] || [ -L "$patternFile" ]; then
  exit 0
fi

# umask 077 makes the file mode 600; noclobber (set -C) refuses to overwrite a file that appears meanwhile.
if (
  umask 077
  set -C
  cat > "$patternFile" <<'PATTERNS'
# Local only and gitignored: never commit this file or paste its patterns anywhere.
# One extended regex (grep -E) per line; blank lines and lines starting with # are skipped.
# Add your own personal patterns below the generic ones: emails, full name, home path.
# leakcheck-starter: delete this line after adding personal patterns
# Until that marker line is deleted, the pre-commit hook blocks every commit.

# GitHub tokens
ghp_[A-Za-z0-9]{36}
github_pat_[A-Za-z0-9_]{22,}
gho_[A-Za-z0-9]{36}
# Private key header
-----BEGIN [A-Z ]*PRIVATE KEY-----
# AWS access key id
AKIA[0-9A-Z]{16}
# Stripe live secret key
sk_live_[0-9A-Za-z]{10,}
# Slack tokens
xox[baprs]-[0-9A-Za-z-]{10,}
PATTERNS
) 2>/dev/null; then
  echo "prepare: created starter .leakcheck; add your personal patterns"
fi
exit 0
