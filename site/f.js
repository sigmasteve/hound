(function () {
  'use strict';

  var cfg = window.HOUND_CONFIG || {};
  var isConfigured =
    !!cfg.supabaseUrl &&
    !!cfg.supabasePublishableKey &&
    cfg.supabaseUrl.indexOf('YOUR_') !== 0 &&
    cfg.supabasePublishableKey.indexOf('YOUR_') !== 0;

  var client = isConfigured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey) : null;
  var card = document.getElementById('invite-card');

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
  }

  function render(html) {
    card.innerHTML = html;
  }

  // The actual path is always /f/<code> — vercel.json rewrites that to
  // this page without changing what the browser shows, so the code is
  // still read straight from the URL rather than a query param.
  function codeFromPath() {
    var parts = window.location.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  }

  if (!isConfigured) {
    render('<p class="section-sub">This site isn’t connected to a Hound project yet — see site/README.md.</p>');
    return;
  }

  var code = codeFromPath();
  if (!code) {
    render('<h2 class="section-title">This invite link doesn’t look right</h2>');
    return;
  }

  function showLookupError(message) {
    render('<h2 class="section-title">This invite link doesn’t look right</h2>' +
      '<p class="section-sub">' + escapeHtml(message) + '</p>');
  }

  // friend_code_owner_name is anon-callable on purpose (see
  // 0019_friend_codes.sql) — this page has no session yet for most
  // visitors, so it can't go through the normal authenticated profiles
  // read the app itself uses. The .catch() matters as much as the
  // res.error check: a thrown/rejected request (network hiccup, or the
  // 0019 migration not having been run against this project yet, so the
  // function doesn't exist at all) needs to still replace the "Loading…"
  // placeholder instead of leaving the page hung on it forever.
  client.rpc('friend_code_owner_name', { code: code })
    .then(function (res) {
      var row = res.data && res.data[0];
      if (res.error || !row) {
        showLookupError('It may have been mistyped, or the account it belonged to no longer exists.');
        return;
      }
      showInvite(row.name);
    })
    .catch(function (e) {
      showLookupError((e && e.message) || 'Something went wrong loading this invite — try again in a moment.');
    });

  function showInvite(inviterName) {
    render(
      '<h2 class="section-title">' + escapeHtml(inviterName) + ' invited you to Hound</h2>' +
      '<p class="section-sub">Accept to connect once you\'re signed in.</p>' +
      '<div class="ctas" id="invite-ctas"><p class="section-sub">Checking your account…</p></div>',
    );

    function showSignedOutCta() {
      var ctas = document.getElementById('invite-ctas');
      // Carries the code forward so index.html's own app.js can redeem
      // it automatically right after sign-up/log-in succeeds, instead
      // of asking someone to come back to this link a second time.
      // Absolute path, not relative — the browser's visible URL is still
      // /f/<code> (see vercel.json's rewrite), so a relative
      // "index.html" would resolve against /f/ and land back on this
      // same rewrite rule instead of the real page.
      ctas.innerHTML =
        '<a class="btn btn-primary" href="/index.html?f=' + encodeURIComponent(code) +
        '#auth">Sign up or log in to accept</a>';
    }

    client.auth.getSession()
      .then(function (res) {
        var session = res.data && res.data.session;
        if (session) {
          var ctas = document.getElementById('invite-ctas');
          ctas.innerHTML =
            '<button class="btn btn-primary" id="accept-btn">Add ' + escapeHtml(inviterName) + ' as a friend</button>';
          document.getElementById('accept-btn').addEventListener('click', acceptInvite);
        } else {
          showSignedOutCta();
        }
      })
      // No session info at all beats hanging on "Checking your
      // account…" forever — same fallback as not being signed in, since
      // signing in/up is the safe default action either way.
      .catch(showSignedOutCta);
  }

  function acceptInvite() {
    var btn = document.getElementById('accept-btn');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    client.rpc('add_friend_by_code', { code: code })
      .then(function (res) {
        var ctas = document.getElementById('invite-ctas');
        if (res.error) {
          ctas.innerHTML = '<p class="form-note error">' + escapeHtml(res.error.message) + '</p>';
          return;
        }
        ctas.innerHTML =
          '<p class="section-sub">You’re now friends — open the Hound app to see them on your Friends tab.</p>';
      })
      .catch(function (e) {
        document.getElementById('invite-ctas').innerHTML =
          '<p class="form-note error">' + escapeHtml((e && e.message) || 'Could not add that — try again.') + '</p>';
      });
  }
})();
