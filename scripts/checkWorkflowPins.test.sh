#!/bin/sh
# Self-test for scripts/checkWorkflowPins.sh. Uses temporary workflow fixtures only.
set -eu

checkScript="$(cd "$(dirname "$0")" && pwd)/checkWorkflowPins.sh"
workDirectory=$(mktemp -d)
trap 'rm -rf "$workDirectory"' EXIT

pinnedSha="11d5960a326750d5838078e36cf38b85af677262"
failures=0
caseCount=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }

# writeWorkflow <name> <permissions line or empty> <uses line>
writeWorkflow() {
  caseDirectory="$workDirectory/$1"
  mkdir -p "$caseDirectory"
  {
    echo "name: fixture"
    echo "on: pull_request"
    [ -n "$2" ] && echo "$2"
    echo "jobs:"
    echo "  fixture:"
    echo "    runs-on: ubuntu-latest"
    echo "    steps:"
    echo "$3"
  } > "$caseDirectory/fixture.yml"
}

# expectResult <name> <pass|fail> <description> [expected output text]
expectResult() {
  caseCount=$((caseCount + 1))
  if sh "$checkScript" "$workDirectory/$1" > "$workDirectory/$1.log" 2>&1; then
    actual="pass"
  else
    actual="fail"
  fi
  if [ "$actual" != "$2" ]; then
    fail "$3 (expected $2, got $actual)"
  elif [ -n "${4:-}" ] && ! grep -qF "$4" "$workDirectory/$1.log"; then
    fail "$3 (output does not mention '$4')"
  else
    pass "$3"
  fi
}

writeWorkflow pinned "permissions: {}" "      - uses: actions/checkout@$pinnedSha # v4.4.0"
expectResult pinned pass "SHA-pinned action with version comment passes"

writeWorkflow quoted "permissions:
  contents: read" "      - uses: \"actions/checkout@$pinnedSha\" # v4.4.0"
expectResult quoted pass "quoted SHA-pinned action passes"

writeWorkflow local "permissions: {}" "      - uses: ./.github/actions/setup"
expectResult local pass "local action is exempt"

writeWorkflow subdirectory "permissions: {}" "      - uses: github/codeql-action/init@$pinnedSha # v4.39.1"
expectResult subdirectory pass "SHA-pinned action in a subdirectory passes"

writeWorkflow movingTag "permissions: {}" "      - uses: actions/checkout@v4"
expectResult movingTag fail "moving major tag fails" "fixture.yml:8 action is not pinned to a full commit SHA: actions/checkout@v4"

writeWorkflow exactTag "permissions: {}" "      - uses: astral-sh/setup-uv@v10.3.0 # v10.3.0"
expectResult exactTag fail "exact version tag fails"

writeWorkflow shortSha "permissions: {}" "      - uses: actions/checkout@11d5960 # v4.4.0"
expectResult shortSha fail "short SHA fails"

writeWorkflow branch "permissions: {}" "      - uses: actions/checkout@main"
expectResult branch fail "branch reference fails"

writeWorkflow noComment "permissions: {}" "      - uses: actions/checkout@$pinnedSha"
expectResult noComment fail "SHA pin without version comment fails" "has no version comment"

writeWorkflow jobLevel "permissions: {}" "      - run: echo fixture
  reusable:
    uses: owner/repo/.github/workflows/build.yml@v1"
expectResult jobLevel fail "unpinned reusable workflow call fails"

writeWorkflow dockerTag "permissions: {}" "      - uses: docker://alpine:3.22"
expectResult dockerTag fail "docker action by tag fails" "not pinned by sha256 digest"

writeWorkflow dockerDigest "permissions: {}" "      - uses: docker://alpine@sha256:4bcff63911fcb4448bd4fdacec207030997caf25e9bea4045fa6c8c44de311d1"
expectResult dockerDigest pass "docker action by sha256 digest passes"

writeWorkflow noPermissions "" "      - uses: actions/checkout@$pinnedSha # v4.4.0"
expectResult noPermissions fail "workflow without top-level permissions fails" "has no top-level permissions: block"

writeWorkflow jobPermissionsOnly "" "      - uses: actions/checkout@$pinnedSha # v4.4.0
    permissions:
      contents: read"
expectResult jobPermissionsOnly fail "job-level permissions alone do not count as top-level"

mkdir -p "$workDirectory/empty"
expectResult empty fail "empty workflow directory fails"

if [ "$failures" -gt 0 ]; then
  echo "workflow pin self-test: $failures of $caseCount cases failed"
  exit 1
fi
echo "workflow pin self-test: all $caseCount cases passed"
