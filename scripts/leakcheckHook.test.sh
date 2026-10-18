#!/bin/sh
# Self-test for .githooks/pre-commit. Uses a temporary git repo and a dummy canary pattern only.
set -eu

hookSource="$(cd "$(dirname "$0")/.." && pwd)/.githooks/pre-commit"
workDirectory=$(mktemp -d)
trap 'rm -rf "$workDirectory"' EXIT

cd "$workDirectory"
git init -q
git config user.name "Leakcheck Test"
git config user.email "leakcheck-test@example.invalid"
git config commit.gpgsign false
mkdir .githooks
cp "$hookSource" .githooks/pre-commit
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks

dummyCanary="DUMMY""_CANARY_""424242"
printf '# dummy patterns for the self-test\n\nDUMMY_CANARY_[0-9]{6}\n' > .leakcheck

failures=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }

# 1. A staged canary is blocked; output names the file and the pattern line, not the canary or the pattern.
printf 'token = %s\n' "$dummyCanary" > leaked.txt
git add leaked.txt
if git commit -q -m "Add leaked file" > output.log 2>&1; then
  fail "staged canary was committed"
elif grep -q "leaked.txt matches pattern on line 3 of .leakcheck" output.log && ! grep -q -e "$dummyCanary" -e "DUMMY_CANARY_\[" output.log; then
  pass "staged canary blocked; output names file and pattern line only"
else
  fail "staged canary blocked but output is wrong"
fi
git reset -q leaked.txt
rm -f leaked.txt

# 2. Clean content commits normally.
printf 'hello\n' > clean.txt
git add clean.txt
if git commit -q -m "Add clean file" > output.log 2>&1; then
  pass "clean content commits"
else
  fail "clean content was blocked"
fi

# 3. A missing .leakcheck fails the commit (fail closed).
mv .leakcheck leakcheck.saved
printf 'more\n' >> clean.txt
git add clean.txt
if git commit -q -m "Change without leakcheck" > output.log 2>&1; then
  fail "commit passed without .leakcheck"
elif grep -q "missing .leakcheck" output.log; then
  pass "missing .leakcheck fails the commit"
else
  fail "missing .leakcheck failed with an unexpected message"
fi

# 4. A .leakcheck with only comments and blank lines also fails closed.
printf '# only a comment\n\n' > .leakcheck
printf 'again\n' >> clean.txt
git add clean.txt
if git commit -q -m "Change with empty leakcheck" > output.log 2>&1; then
  fail "commit passed with an empty .leakcheck"
elif grep -q "no usable patterns" output.log; then
  pass ".leakcheck without usable patterns fails the commit"
else
  fail "empty .leakcheck failed with an unexpected message"
fi

# 5. An invalid regex pattern blocks the commit without printing the pattern.
printf 'DUMMY_CANARY_[0-9]{6}\nDUMMY_(UNCLOSED\n' > .leakcheck
printf 'invalid pattern case\n' > invalidPattern.txt
git add invalidPattern.txt
if git commit -q -m "Change with invalid pattern" > output.log 2>&1; then
  fail "commit passed with an invalid pattern"
elif grep -q "invalid pattern on line 2; commit blocked" output.log && ! grep -q "UNCLOSED" output.log; then
  pass "invalid pattern blocks the commit; pattern not printed"
else
  fail "invalid pattern failed with an unexpected message"
fi

# 6. A CRLF .leakcheck still blocks the canary.
printf '# dummy patterns, CRLF line endings\r\nDUMMY_CANARY_[0-9]{6}\r\n' > .leakcheck
printf 'token = %s\n' "$dummyCanary" > leakedCrlf.txt
git add leakedCrlf.txt
if git commit -q -m "Add leaked file with CRLF leakcheck" > output.log 2>&1; then
  fail "staged canary was committed with a CRLF .leakcheck"
elif grep -q "leakedCrlf.txt matches pattern on line 2 of .leakcheck" output.log && ! grep -q -e "$dummyCanary" output.log; then
  pass "CRLF .leakcheck still blocks the canary"
else
  fail "CRLF .leakcheck blocked with an unexpected message"
fi

if [ "$failures" -ne 0 ]; then
  echo "leakcheck self-test: $failures failed"
  exit 1
fi
echo "leakcheck self-test: all 6 cases passed"
