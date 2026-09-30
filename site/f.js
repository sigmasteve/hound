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

  // Hound is in beta, so most people opening this link don't have the
  // app yet: step 1 gets it (the TestFlight public link / Android
  // download from Admin → Find people, via beta_download_links in
  // 0080_friend_discovery.sql), step 2 is the code to enter once it's
  // installed. A link can't survive the install, which is why the code
  // is spelled out here to copy.
  function showInvite(inviterName) {
    var name = escapeHtml(inviterName);
    var safeCode = escapeHtml(code);
    render(
      '<h2 class="section-title">' + name + ' invited you to Hound</h2>' +
      '<p class="section-sub">Hound is in beta — two quick steps and you\'re connected.</p>' +
      '<ol class="steps">' +
        '<li class="step"><div class="step-num">1</div><div>' +
          '<div class="step-title"><h3>Get the app</h3></div>' +
          '<div id="download-ctas"><p class="sub">Loading download links…</p></div>' +
          '<p class="sub">Already have Hound? Skip to step 2.</p>' +
        '</div></li>' +
        '<li class="step"><div class="step-num">2</div><div>' +
          '<div class="step-title"><h3>Add ' + name + '</h3></div>' +
          '<p>Open Hound, go to <b>Friends</b> → <b>Enter a code</b> (or the “Got an invite code?” card on Today), and enter:</p>' +
          '<div class="linkbox"><span id="invite-code" style="flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:16px;letter-spacing:0.04em;user-select:all">' + safeCode + '</span>' +
            '<button class="copy-btn" id="copy-code">Copy</button></div>' +
        '</div></li>' +
      '</ol>' +
      '<div class="notes"><p class="section-sub" style="margin:0 0 8px">Or, if you have a Hound account, accept here:</p>' +
      '<div class="ctas" id="invite-ctas"><p class="section-sub">Checking your account…</p></div></div>',
    );

    document.getElementById('copy-code').addEventListener('click', function () {
      var btn = this;
      var done = function () { btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = 'Copy'; }, 2000); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done).catch(function () {});
      }
    });

    showDownloads();

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
        '<a class="btn btn-secondary" href="/index.html?f=' + encodeURIComponent(code) +
        '#auth">Sign up or log in to accept</a>';
    }

    client.auth.getSession()
      .then(function (res) {
        var session = res.data && res.data.session;
        if (session) {
          var ctas = document.getElementById('invite-ctas');
          ctas.innerHTML =
            '<button class="btn btn-primary" id="accept-btn">Add ' + name + ' as a friend</button>';
          document.getElementById('accept-btn').addEventListener('click', acceptInvite);
        } else {
          showSignedOutCta();
        }
      })
      // No session info at all beats hanging on "Checking your
      // account…" forever — same fallback as not being signed in, since
      // signing in/up is the safe default action either way.
      .catch(showSignedOutCta);

    function showDownloads() {
      var box = document.getElementById('download-ctas');
      var ua = navigator.userAgent || '';
      var isAndroid = /android/i.test(ua);
      var isApple = /iphone|ipad|ipod|macintosh/i.test(ua);
      client.rpc('beta_download_links')
        .then(function (res) {
          var row = res.data && res.data[0];
          // Only ever an https link, with quotes encoded, since it goes
          // into an href below.
          var safeUrl = function (u) {
            return u && /^https:\/\//i.test(u) ? u.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E') : null;
          };
          var ios = safeUrl(row && row.ios_url);
          var android = safeUrl(row && row.android_url);
          if (res.error || (!ios && !android)) {
            box.innerHTML = '<p>Ask ' + name + ' to send you the beta invite for your phone.</p>';
            return;
          }
          // The button for the visitor's own phone first, and primary.
          var buttons = [];
          if (ios) buttons.push({ href: ios, label: 'iPhone: get it on TestFlight', mine: isApple });
          if (android) buttons.push({ href: android, label: 'Android: download the app', mine: isAndroid });
          buttons.sort(function (a, b) { return (b.mine ? 1 : 0) - (a.mine ? 1 : 0); });
          box.innerHTML = buttons.map(function (b, i) {
            var cls = (b.mine || (i === 0 && !buttons.some(function (x) { return x.mine; }))) ? 'btn btn-primary btn-block' : 'btn btn-secondary btn-block';
            return '<p><a class="' + cls + '" href="' + b.href + '" target="_blank" rel="noopener">' + escapeHtml(b.label) + '</a></p>';
          }).join('') +
          (ios ? '<p class="sub">On iPhone, TestFlight (Apple\'s free beta app) installs first, then Hound.</p>' : '');
        })
        .catch(function () {
          box.innerHTML = '<p>Ask ' + name + ' to send you the beta invite for your phone.</p>';
        });
    }
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
