#!/bin/sh
# Self-test for scripts/checkModalResidency.sh. Plants bad files in temporary fixtures only, then checks the real files pass.
set -eu

checkScript="$(cd "$(dirname "$0")" && pwd)/checkModalResidency.sh"
workDirectory=$(mktemp -d)
trap 'rm -rf "$workDirectory"' EXIT

goodDecorator='@app.function(image=image, region="eu", routing_region="eu-west", enable_memory_snapshot=False)'
failures=0
caseCount=0
pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; failures=$((failures + 1)); }

# writeFixture <name> <Node caller line> <Modal app lines>
writeFixture() {
  mkdir -p "$workDirectory/$1/node" "$workDirectory/$1/app"
  printf '%s\n' "$2" > "$workDirectory/$1/node/caller.ts"
  printf '%s\n' "$3" > "$workDirectory/$1/app/modal_app.py"
}

# expectResult <name> <pass|fail> <description>
expectResult() {
  caseCount=$((caseCount + 1))
  if sh "$checkScript" "$workDirectory/$1/node" "$workDirectory/$1/app" > "$workDirectory/$1.log" 2>&1; then
    actual="pass"
  else
    actual="fail"
  fi
  if [ "$actual" = "$2" ]; then
    pass "$3"
  else
    fail "$3 (expected $2, got $actual)"
  fi
}

writeFixture good "await trackVideo.remote([jobId, objectKey]);" "$goodDecorator"
expectResult good pass "remote call and pinned decorator pass"

writeFixture nodeSpawn "await trackVideo.spawn([jobId, objectKey]);" "$goodDecorator"
expectResult nodeSpawn fail "spawn call in the Node caller fails"

writeFixture appSpawn "await trackVideo.remote([jobId, objectKey]);" "$goodDecorator
call = track_video.spawn(job_id, key)"
expectResult appSpawn fail "spawn call in the Modal app fails"

writeFixture noRegion "await trackVideo.remote([jobId, objectKey]);" '@app.function(image=image, routing_region="eu-west", enable_memory_snapshot=False)'
expectResult noRegion fail "decorator without region fails"

writeFixture noRouting "await trackVideo.remote([jobId, objectKey]);" '@app.function(image=image, region="eu", enable_memory_snapshot=False)'
expectResult noRouting fail "decorator without routing_region fails"

writeFixture snapshotOn "await trackVideo.remote([jobId, objectKey]);" '@app.function(image=image, region="eu", routing_region="eu-west", enable_memory_snapshot=True)'
expectResult snapshotOn fail "decorator with memory snapshots on fails"

writeFixture splitDecorator "await trackVideo.remote([jobId, objectKey]);" '@app.function(
    image=image, region="eu", routing_region="eu-west", enable_memory_snapshot=False
)'
expectResult splitDecorator fail "decorator split over lines fails closed"

caseCount=$((caseCount + 1))
if sh "$checkScript" > "$workDirectory/real.log" 2>&1; then
  pass "real Node caller and Modal app pass"
else
  cat "$workDirectory/real.log"
  fail "real Node caller and Modal app pass (expected pass, got fail)"
fi

if [ "$failures" -gt 0 ]; then
  echo "Modal residency self-test: $failures of $caseCount cases failed"
  exit 1
fi
echo "Modal residency self-test: all $caseCount cases passed"
