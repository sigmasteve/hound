#!/bin/bash
# Publishes an over-the-air update to one app, and stops before anything
# is uploaded if the code points at the other app's database.
#
#   npm run update:production -- --message "What changed"
#   npm run update:staging -- --message "What changed"
#
# Each app builds into its own folder (dist-production, dist-staging).
# Both used to build into dist/, so a staging and a production publish
# running at the same time from two Terminal windows could upload each
# other's code. That's how the production update for #330 went out with
# staging's database address on 17 Oct 2026.
set -euo pipefail
cd "$(dirname "$0")/.."

PRODUCTION_REF=vaypjksgpuuopqvurcus
STAGING_REF=quglaamzzhebqrlhvfuc

target=${1:-}
shift || true
case "$target" in
  production)
    branch=production environment=production expect=$PRODUCTION_REF reject=$STAGING_REF
    unset APP_VARIANT
    ;;
  staging)
    branch=staging environment=preview expect=$STAGING_REF reject=$PRODUCTION_REF
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
# bare project ids also appear in the app on purpose (Settings shows PR or
# STG, src/lib/appVersion.ts), so they can't be what's checked. Source
# maps are skipped: they hold the app's source text, not its settings.
expect_url="https://$expect.supabase.co"
reject_url="https://$reject.supabase.co"
for platform in ios android; do
  bundle_dir="$out/_expo/static/js/$platform"
  if grep -rqsF --exclude='*.map' "$reject_url" "$bundle_dir"; then
    echo "STOPPED: the $platform code points at the wrong database ($reject_url). Nothing was published."
    exit 1
  fi
  if ! grep -rqsF --exclude='*.map' "$expect_url" "$bundle_dir"; then
    echo "STOPPED: the $platform code doesn't point at the $target database ($expect_url). Nothing was published."
    exit 1
  fi
done
echo "Checked: iPhone and Android code both point at the $target database."

npx eas-cli update --branch "$branch" --environment "$environment" --skip-bundler --input-dir "$out" "$@"
