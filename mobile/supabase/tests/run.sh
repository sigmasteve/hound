#!/bin/bash
# Runs every test file in this folder against a database that already has
# all migrations applied. Each file runs in its own transaction and rolls
# back, so the database is left as it was.
#
#   PSQL="docker exec -i hounddb psql -U postgres" ./run.sh
#
# Exits non-zero if any test fails or any file errors.
set -u
cd "$(dirname "$0")"
PSQL=${PSQL:-psql}
failed=0
for f in [0-9]*.sql; do
  out=$( { echo 'begin;'; cat _helpers.sql "$f"; echo 'rollback;'; } | $PSQL -X -q -t -A -v ON_ERROR_STOP=1 2>&1 )
  rc=$?
  bad=$(echo "$out" | grep -E '^not ok' || true)
  plan=$(echo "$out" | grep -E '^# Looks like' || true)
  if [ $rc -ne 0 ] || [ -n "$bad" ] || [ -n "$plan" ]; then
    echo "FAIL $f"
    echo "$out" | grep -E '^(not ok|#|psql|ERROR)' | sed 's/^/  /'
    failed=1
  else
    echo "ok   $f ($(echo "$out" | grep -cE '^ok') checks)"
  fi
done
exit $failed
