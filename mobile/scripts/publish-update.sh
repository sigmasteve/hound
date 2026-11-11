#!/bin/bash
# Publishes an over-the-air update to one app, and stops before anything
# is uploaded if the code points at the other app's database.
#
#   npm run update:production -- --message "What changed"
#   npm run update:staging -- --message "What changed"
#
# An update only reaches phones whose build has the same runtime version,
# which is app.json's "version" (runtimeVersion policy appVersion). While
# a new build (say 0.12.0) is waiting on Apple, or people are still moving
# onto it, list the version they're moving from (0.11.0) in
# scripts/also-publish.txt: the same update then also goes out to those
# phones, stamped with their version. Empty the file once Admin's
# minimum version is raised and the old version is left behind.
#
# Keep the code safe for the older build while it's listed: anything that
# needs the new build's native code has to check it's there first.
# Each app builds into its own folder (dist-production, dist-staging).
# Both used to build into dist/, so a staging and a production publish
# running at the same time from two Terminal windows could upload each
# other's code. That's how the production update for #330 went out with
# staging's database address on 17 Oct 2026.
set -euo pipefail
cd "$(dirname "$0")/.."

PRODUCTION_REF=vaypjksgpuuopqvurcus
STAGING_REF=quglaamzzhebqrlhvfuc
# Production's own domain (Supabase custom domain, November 2026): the
# same database at an address people can read, which iOS shows when
# signing in with Facebook or Apple. Either address counts as production.
PRODUCTION_DOMAIN=auth.houndchallenge.net

target=${1:-}
shift || true
case "$target" in
  production)
    branch=production environment=production
    expect_urls="https://$PRODUCTION_REF.supabase.co https://$PRODUCTION_DOMAIN"
    reject_urls="https://$STAGING_REF.supabase.co"
    unset APP_VARIANT
    ;;
  staging)
    branch=staging environment=preview
    expect_urls="https://$STAGING_REF.supabase.co"
    reject_urls="https://$PRODUCTION_REF.supabase.co https://$PRODUCTION_DOMAIN"
    export APP_VARIANT=staging
    ;;
  *)
    echo 'Usage: npm run update:production -- --message "What changed"  (or update:staging)'
    exit 1
    ;;
esac

out="dist-$target"
rm -rf "$out"
echo "Building the $target update into $out/ with the $environment environment..."
npx eas-cli env:exec "$environment" \
  "npx expo export --output-dir $out --dump-assetmap --dump-sourcemap --platform ios --platform android --clear"

# The full address, as EXPO_PUBLIC_SUPABASE_URL puts it in the code. The
# bare project ids and the domain also appear in the app on purpose
# (Settings shows PR or STG, src/lib/appVersion.ts), so they can't be what's
# checked. Source maps are skipped: they hold the app's source text, not its
# settings.
for platform in ios android; do
  bundle_dir="$out/_expo/static/js/$platform"
  for url in $reject_urls; do
    if grep -rqsF --exclude='*.map' "$url" "$bundle_dir"; then
      echo "STOPPED: the $platform code points at the wrong database ($url). Nothing was published."
      exit 1
    fi
  done
  found=
  for url in $expect_urls; do
    if grep -rqsF --exclude='*.map' "$url" "$bundle_dir"; then found=$url; fi
  done
  if [ -z "$found" ]; then
    echo "STOPPED: the $platform code doesn't point at the $target database ($expect_urls). Nothing was published."
    exit 1
  fi
done
echo "Checked: iPhone and Android code both point at the $target database."

npx eas-cli update --branch "$branch" --environment "$environment" --skip-bundler --input-dir "$out" "$@"

# The same update for older versions' phones (also-publish.txt).
also_file="scripts/also-publish.txt"
if [ -f "$also_file" ]; then
  current=$(node -p "require('./app.json').expo.version")
  for v in $(grep -v '^[[:space:]]*#' "$also_file" | tr ',' ' '); do
    v=$(echo "$v" | tr -d '[:space:]')
    [ -z "$v" ] && continue
    if ! echo "$v" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
      echo "Skipped \"$v\" in $also_file: a version looks like 0.11.0."
      continue
    fi
    [ "$v" = "$current" ] && continue
    echo "Also publishing this update for phones on $v..."
    HOUND_PUBLISH_VERSION="$v" npx eas-cli update --branch "$branch" --environment "$environment" --skip-bundler --input-dir "$out" "$@"
  done
fi
