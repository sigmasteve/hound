# Vendored: @supabase/supabase-js

`supabase.js` is the unmodified UMD browser build from
`@supabase/supabase-js@2.116.0` (`dist/umd/supabase.js` in the published
npm package). Vendored locally rather than loaded from a CDN — same
reasoning as the root `vendor/` directory (see its own README): this page
has no build step, and a page that only handles auth shouldn't depend on a
third-party CDN staying up or unblocked to work at all.

To update: download a newer version's tarball (`npm pack
@supabase/supabase-js@<version>`), pull `dist/umd/supabase.js` back out,
and replace this file.
