#!/bin/sh
# Self-test for .githooks/pre-commit. Uses a temporary git repo and a dummy canary pattern only.
set -eu

sourceRoot="$(cd "$(dirname "$0")/.." && pwd)"
hookSource="$sourceRoot/.githooks/pre-commit"
starterSource="$sourceRoot/scripts/createStarterLeakcheck.sh"
workDirectory=$(mktemp -d)
trap 'rm -rf "$workDirectory"' EXIT

cd "$workDirectory"
git init -q
git config user.name "Leakcheck Test"
git config user.email "leakcheck-test@example.invalid"
git config commit.gpgsign false
mkdir .githooks
cp "$hookSource" .githooks/pre-commit
mkdir scripts
cp "$starterSource" scripts/createStarterLeakcheck.sh
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

# 7. A missing .leakcheck gets a starter (mode 600, notice only); the starter blocks even a clean commit, printing no patterns.
starterMarker="# leakcheck-starter: delete this line after adding personal patterns"
rm -f .leakcheck
sh scripts/createStarterLeakcheck.sh > output.log 2>&1
starterMode=$(ls -l .leakcheck 2>/dev/null | cut -c1-10)
starterMarkerCount=$(grep -cxF -e "$starterMarker" .leakcheck 2>/dev/null || true)
printf 'clean change with the starter\n' >> clean.txt
git add clean.txt
if [ "$starterMode" != "-rw-------" ]; then
  fail "starter .leakcheck missing or not mode 600 (got $starterMode)"
elif [ "$starterMarkerCount" != "1" ]; then
  fail "starter .leakcheck does not have exactly one marker line (got $starterMarkerCount)"
elif [ "$(cat output.log)" != "prepare: created starter .leakcheck; add your personal patterns" ]; then
  fail "starter creation printed unexpected output"
elif git commit -q -m "Clean change with starter leakcheck" > output.log 2>&1; then
  fail "clean commit passed with the starter .leakcheck (marker ignored)"
elif grep -q "still the starter file" output.log && grep -qF "delete the line \"$starterMarker\"" output.log && ! grep -q -e "ghp_" -e "AKIA" -e "PRIVATE KEY" output.log; then
  pass "missing .leakcheck: starter created (mode 600, one marker) and it blocks a clean commit without printing patterns"
else
  fail "starter .leakcheck blocked with an unexpected message"
fi

# 8. An existing .leakcheck is left untouched: same checksum and mtime, no output.
printf 'DUMMY_CANARY_[0-9]{6}\n' > .leakcheck
touch -t 200102030405.06 .leakcheck
touch -r .leakcheck mtimeReference
checksumBefore=$(cksum < .leakcheck)
sh scripts/createStarterLeakcheck.sh > output.log 2>&1
if [ "$(cksum < .leakcheck)" = "$checksumBefore" ] && [ ! .leakcheck -nt mtimeReference ] && [ ! mtimeReference -nt .leakcheck ] && [ ! -s output.log ]; then
  pass "existing .leakcheck untouched (checksum and mtime equal, no output)"
else
  fail "existing .leakcheck was changed or output was printed"
fi

# 9. Starter with the marker deleted and a dummy personal pattern added: a clean commit passes.
rm -f .leakcheck
sh scripts/createStarterLeakcheck.sh > /dev/null 2>&1
grep -vxF -e "$starterMarker" .leakcheck > editedLeakcheck.tmp || true
printf 'jane\\.dummy@example\\.invalid\n' >> editedLeakcheck.tmp
cat editedLeakcheck.tmp > .leakcheck
rm -f editedLeakcheck.tmp
printf 'clean change after editing the starter\n' >> clean.txt
git add clean.txt
if git commit -q -m "Clean change with edited starter" > output.log 2>&1; then
  pass "marker deleted and personal pattern added: clean commit passes"
else
  fail "clean commit blocked after deleting the marker"
fi

# 10. The same edited starter blocks a staged dummy personal match, without printing it.
dummyEmail="jane.dummy""@example.invalid"
printf 'contact = %s\n' "$dummyEmail" > leakedEmail.txt
git add leakedEmail.txt
if git commit -q -m "Add dummy email" > output.log 2>&1; then
  fail "edited starter let a dummy personal match through"
elif grep -q "leakedEmail.txt matches pattern on line" output.log && ! grep -qF "$dummyEmail" output.log; then
  pass "edited starter blocks a staged dummy personal match"
else
  fail "dummy personal match blocked with an unexpected message"
fi
git reset -q leakedEmail.txt
rm -f leakedEmail.txt

# 11. The edited starter's generic patterns block a staged dummy GitHub token (ghp_ plus 36 x), without printing it.
dummyGithubToken="ghp""_$(printf 'x%.0s' $(seq 1 36))"
printf 'token = %s\n' "$dummyGithubToken" > leakedGithubToken.txt
git add leakedGithubToken.txt
if git commit -q -m "Add dummy GitHub token" > output.log 2>&1; then
  fail "edited starter let a dummy GitHub token through"
elif grep -q "leakedGithubToken.txt matches pattern on line" output.log && ! grep -q "$dummyGithubToken" output.log; then
  pass "edited starter blocks a dummy GitHub token"
else
  fail "dummy GitHub token blocked with an unexpected message"
fi
git reset -q leakedGithubToken.txt
rm -f leakedGithubToken.txt

# 12. Outside a git repository the starter script skips silently and creates nothing.
outsideDirectory="$workDirectory/outside"
mkdir -p "$outsideDirectory/scripts"
cp "$starterSource" "$outsideDirectory/scripts/createStarterLeakcheck.sh"
if (cd "$outsideDirectory" && GIT_CEILING_DIRECTORIES="$workDirectory" sh scripts/createStarterLeakcheck.sh > "$workDirectory/output.log" 2>&1) \
  && [ ! -e "$outsideDirectory/.leakcheck" ] && [ ! -s output.log ]; then
  pass "outside a git repository: skipped silently, nothing created"
else
  fail "starter script misbehaved outside a git repository"
fi

# 13. A non-git copy nested inside another repo skips silently and never writes .leakcheck to the outer repo root.
rm -f .leakcheck
nestedDirectory="$workDirectory/nestedCopy"
mkdir -p "$nestedDirectory/scripts"
cp "$starterSource" "$nestedDirectory/scripts/createStarterLeakcheck.sh"
if (cd "$nestedDirectory" && sh scripts/createStarterLeakcheck.sh > "$workDirectory/output.log" 2>&1) \
  && [ ! -e "$workDirectory/.leakcheck" ] && [ ! -e "$nestedDirectory/.leakcheck" ] && [ ! -s output.log ]; then
  pass "non-git copy nested in another repo: skipped silently, outer root untouched"
else
  fail "nested non-git copy wrote a .leakcheck or printed output"
fi

# 14. Marker text that is not the exact full line (a longer comment, or part of a pattern) does not trip the starter block.
printf '%s (already done)\n %s\nDUMMY_CANARY_[0-9]{6}|%s\n' "$starterMarker" "$starterMarker" "$starterMarker" > .leakcheck
printf 'clean change with marker-like lines\n' >> clean.txt
git add clean.txt
if git commit -q -m "Clean change with marker-like lines" > output.log 2>&1; then
  pass "marker text inside a longer line does not block a clean commit"
else
  fail "marker text inside a longer line tripped the starter block"
fi

if [ "$failures" -ne 0 ]; then
  echo "leakcheck self-test: $failures failed"
  exit 1
fi
echo "leakcheck self-test: all 14 cases passed"
