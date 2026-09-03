#!/usr/bin/env bash
# Wait until the plugin webhook route stops 404ing, i.e. the deploy landed.
# 404 = code absent. 400 = deployed and rejecting an unsigned body (correct).
# 503 = deployed but the signing secret is missing from this build.
set -uo pipefail
URL="https://100lights.com/api/plugins/webhook"

for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$URL")"
  if [ "$code" != "404" ] && [ "$code" != "000" ]; then
    echo "DEPLOYED — HTTP $code"
    exit 0
  fi
  sleep 20
done

echo "still 404 after 20 minutes"
exit 1
