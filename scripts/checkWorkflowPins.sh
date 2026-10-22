#!/bin/sh
# Fails if a GitHub Actions workflow uses a third-party action that is not pinned to a full 40-character commit SHA
# with the version in a trailing comment, or if a workflow has no top-level `permissions:` block (HEN-225).
# Local actions (`./...`) are exempt. Docker actions must be pinned by `@sha256:` digest.
# Usage: sh scripts/checkWorkflowPins.sh [workflow directory]   (default: .github/workflows)
set -eu

workflowDirectory="${1:-.github/workflows}"
failures=0
checkedFiles=0
usesListFile=$(mktemp)
trap 'rm -f "$usesListFile"' EXIT

report() {
  echo "FAIL: $1"
  failures=$((failures + 1))
}

for workflowFile in "$workflowDirectory"/*.yml "$workflowDirectory"/*.yaml; do
  [ -f "$workflowFile" ] || continue
  checkedFiles=$((checkedFiles + 1))

  if ! grep -qE '^permissions:' "$workflowFile"; then
    report "$workflowFile has no top-level permissions: block"
  fi

  # Every `uses:` line, with its line number: "12:      - uses: owner/repo@ref # v1.2.3"
  grep -nE '^[[:space:]]*(-[[:space:]]+)?uses:' "$workflowFile" > "$usesListFile" || true
  while IFS= read -r usesLine; do
    lineNumber="${usesLine%%:*}"
    lineText="${usesLine#*:}"
    actionReference=$(printf '%s\n' "$lineText" | sed -E 's/^[[:space:]]*(-[[:space:]]+)?uses:[[:space:]]*//; s/[[:space:]]+#.*$//; s/^["'\'']//; s/["'\'']$//')
    trailingComment=$(printf '%s\n' "$lineText" | sed -nE 's/^.*[[:space:]]#[[:space:]]*([^[:space:]].*)$/\1/p')

    case "$actionReference" in
      ./*)
        continue
        ;;
      docker://*)
        if ! printf '%s\n' "$actionReference" | grep -qE '@sha256:[0-9a-f]{64}$'; then
          report "$workflowFile:$lineNumber docker action is not pinned by sha256 digest: $actionReference"
        fi
        continue
        ;;
    esac

    if ! printf '%s\n' "$actionReference" | grep -qE '^[^@[:space:]]+@[0-9a-f]{40}$'; then
      report "$workflowFile:$lineNumber action is not pinned to a full commit SHA: $actionReference"
    elif [ -z "$trailingComment" ]; then
      report "$workflowFile:$lineNumber pinned action has no version comment (add e.g. '# v4.2.2'): $actionReference"
    fi
  done < "$usesListFile"
done

if [ "$checkedFiles" -eq 0 ]; then
  echo "FAIL: no workflow files found in $workflowDirectory"
  exit 1
fi

if [ "$failures" -gt 0 ]; then
  echo "Workflow pin check failed: $failures problem(s) in $checkedFiles workflow file(s). See AGENTS.md, 'GitHub Actions pins'."
  exit 1
fi

echo "Workflow pin check passed: $checkedFiles workflow file(s), every action pinned by SHA, every workflow has top-level permissions."
