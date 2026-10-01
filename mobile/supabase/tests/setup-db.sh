#!/bin/bash
# Starts a throwaway copy of Supabase's Postgres (the same image Supabase
# runs) in Docker and applies every migration in order, from 0001.
#
#   mobile/supabase/tests/setup-db.sh        # container named hounddb
#   CONTAINER=other mobile/supabase/tests/setup-db.sh
#
# Then run the tests:  PSQL="docker exec -i hounddb psql -U postgres" mobile/supabase/tests/run.sh
set -euo pipefail
CONTAINER=${CONTAINER:-hounddb}
IMAGE=${IMAGE:-supabase/postgres:17.11.0.002}
MIGRATIONS="$(cd "$(dirname "$0")/../migrations" && pwd)"

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  sleep 2
done
sleep 5

# A real project's auth.users has columns that Supabase's sign-in service
# adds when it starts. This image alone doesn't run that service, so add
# the ones the migrations use.
docker exec "$CONTAINER" psql -U supabase_admin -d postgres -q -v ON_ERROR_STOP=1 -c "
  alter table auth.users
    add column if not exists banned_until timestamptz,
    add column if not exists is_anonymous boolean not null default false,
    add column if not exists deleted_at timestamptz,
    add column if not exists is_sso_user boolean not null default false;"

# Each file runs as one transaction, the way `supabase db push` applies it.
docker exec "$CONTAINER" mkdir -p /migrations
docker cp "$MIGRATIONS/." "$CONTAINER:/migrations/" >/dev/null
count=0
for f in $(cd "$MIGRATIONS" && ls [0-9]*.sql | sort); do
  if ! docker exec "$CONTAINER" psql -U postgres -q -1 -v ON_ERROR_STOP=1 -f "/migrations/$f" >/tmp/migration.log 2>&1; then
    echo "Migration $f failed:"
    grep -E "ERROR|LINE|CONTEXT" /tmp/migration.log | head -10
    exit 1
  fi
  count=$((count + 1))
done
echo "Applied $count migrations to a fresh database."
