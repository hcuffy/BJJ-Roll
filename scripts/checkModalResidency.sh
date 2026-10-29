#!/bin/sh
# Fails if the Node Modal caller or the Modal app code uses a spawn-style call instead of `.remote()` (HEN-227), or if a
# Modal function in the app code is not pinned to region="eu", routing_region="eu-west" with memory snapshots off.
# Usage: sh scripts/checkModalResidency.sh [Node caller directory] [Modal app directory]
set -eu

nodeCallerDirectory="${1:-packages/backend/src/jobs}"
modalAppDirectory="${2:-packages/workers/src/bjj_roll_workers}"
failures=0
decoratorFailuresFile=$(mktemp)
trap 'rm -f "$decoratorFailuresFile"' EXIT

# Any spawn-style call (`spawn`, `spawnMap`, `spawn_map`, `_experimental_spawn`) queues inputs outside the eu-west routing path.
if grep -rnEi 'spawn' "$nodeCallerDirectory" "$modalAppDirectory"; then
  echo "FAIL: only .remote() may call a Modal user-data function, spawn is forbidden (HEN-227)"
  failures=$((failures + 1))
fi

# One-line decorators only, so a decorator split over lines fails closed.
for appFile in "$modalAppDirectory"/*.py; do
  [ -f "$appFile" ] || continue
  grep -nE '@app\.(function|cls)' "$appFile" | while IFS= read -r decoratorLine; do
    case "$decoratorLine" in
      *'region="eu"'*'routing_region="eu-west"'*'enable_memory_snapshot=False'*) ;;
      *) echo "FAIL: $appFile:$decoratorLine must set region=\"eu\", routing_region=\"eu-west\", enable_memory_snapshot=False" ;;
    esac
  done
done > "$decoratorFailuresFile"
if [ -s "$decoratorFailuresFile" ]; then
  cat "$decoratorFailuresFile"
  failures=$((failures + 1))
fi

if [ "$failures" -gt 0 ]; then
  exit 1
fi
echo "Modal residency guard passed: .remote() only, every Modal function pinned to eu / eu-west without memory snapshots"
