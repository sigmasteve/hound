(function () {
  'use strict';

  var cfg = window.HOUND_CONFIG || {};
  var isConfigured =
    !!cfg.supabaseUrl &&
    !!cfg.supabasePublishableKey &&
    cfg.supabaseUrl.indexOf('YOUR_') !== 0 &&
    cfg.supabasePublishableKey.indexOf('YOUR_') !== 0;

  var client = isConfigured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey) : null;

  // ---------- small DOM helpers ----------

  function $(id) {
    return document.getElementById(id);
  }

  function setNote(id, message, kind) {
    var el = $(id);
    el.textContent = message || '';
    el.className = 'form-note' + (kind ? ' ' + kind : '');
  }

  function setBusy(buttonId, busy, busyLabel, idleLabel) {
    var btn = $(buttonId);
    btn.disabled = busy;
    btn.textContent = busy ? busyLabel : idleLabel;
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s || '';
    return div.innerHTML;
  }

  // ---------- tab switching (called from index.html's inline onclick) ----------

  window.setAuthTab = function (tab) {
    var signupOn = tab !== 'login';
    $('form-signup').style.display = signupOn ? '' : 'none';
    $('form-login').style.display = signupOn ? 'none' : '';
    $('tab-signup').classList.toggle('on', signupOn);
    $('tab-login').classList.toggle('on', !signupOn);
  };

  // ---------- copy-link button (tester section) ----------

  window.copyLink = function (btn) {
    var link = btn.previousElementSibling.textContent;
    function done() {
      var original = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () {
        btn.textContent = original;
      }, 1500);
    }
    try {
      navigator.clipboard.writeText(link).then(done).catch(function () {});
    } catch (e) {
      // No Clipboard API (very old browser, or non-HTTPS) — the link is
      // still right there to select and copy by hand.
    }
  };

  // ---------- not configured yet: disable everything, say why ----------

  if (!isConfigured) {
    var notConfiguredMsg = "This site isn't connected to a Hound project yet — see site/README.md.";
    setNote('su-note', notConfiguredMsg, 'error');
    setNote('li-note', notConfiguredMsg, 'error');
    ['su-submit', 'li-submit', 'btn-google', 'btn-facebook'].forEach(function (id) {
      $(id).disabled = true;
    });
    return;
  }

  // ---------- signed-in state ----------

  // `profiles` is populated by a DB trigger on signup, same as the mobile
  // app's own userFromSession (src/auth/supabaseAuth.ts) — this is the
  // same lookup, just without the AuthUser shape the app's own screens
  // need, since this page only ever shows one simple confirmation.
  async function profileFor(userId, fallbackEmail) {
    var res = await client.from('profiles').select('name, email').eq('id', userId).single();
    if (res.data) return res.data;
    var name = (fallbackEmail || '').split('@')[0] || 'Hound user';
    return { name: name, email: fallbackEmail || '' };
  }

  function showSignedIn(name, email) {
    var card = $('auth');
    card.innerHTML =
      '<h2 class="section-title">You’re in, ' +
      escapeHtml(name) +
      '</h2>' +
      '<p class="section-sub" id="signed-in-note">' +
      escapeHtml(email) +
      ' is ready to go — open the Hound app once it’s installed and log in with the same email.</p>' +
      '<a class="btn btn-secondary" href="#tester">See how to become a tester ↓</a>';
    redeemPendingFriendCode();
  }

  // Someone who followed a friend-code link (f.html's own "Sign up or
  // log in to accept" button, since that page has no session yet to
  // redeem the code itself) lands here with ?f=<code> — redeem it the
  // moment sign-up/log-in actually succeeds instead of asking them to
  // go back to that link a second time. Guarded so getSession() and the
  // SIGNED_IN event, which both call showSignedIn, can't redeem it twice.
  var friendCodeHandled = false;
  function redeemPendingFriendCode() {
    if (friendCodeHandled) return;
    var code = new URLSearchParams(window.location.search).get('f');
    if (!code) return;
    friendCodeHandled = true;
    client.rpc('add_friend_by_code', { code: code }).then(function (res) {
      var note = $('signed-in-note');
      if (!note) return;
      note.insertAdjacentHTML(
        'afterend',
        res.error
          ? '<p class="form-note error">' + escapeHtml(res.error.message) + '</p>'
          : '<p class="section-sub">You’re now friends — open the app to see them on your Friends tab.</p>',
      );
    });
  }

  // A page reload after an earlier visit's session is still around (or
  // landing back here right after an OAuth redirect, before the
  // SIGNED_IN event below even fires) should show the same confirmation,
  // not a blank login form asking someone to sign in twice.
  client.auth.getSession().then(function (res) {
    var session = res.data && res.data.session;
    if (session) {
      profileFor(session.user.id, session.user.email).then(function (profile) {
        showSignedIn(profile.name, profile.email);
      });
    }
  });

  client.auth.onAuthStateChange(function (event, session) {
    if (event === 'SIGNED_IN' && session) {
      profileFor(session.user.id, session.user.email).then(function (profile) {
        showSignedIn(profile.name, profile.email);
      });
    }
    // A password-reset email's link lands here by default (Supabase's
    // Site URL), not on reset-password.html directly, unless
    // resetPasswordForEmail's own redirectTo is set *and* allow-listed
    // in the Supabase dashboard — this is the fallback for whichever of
    // those hasn't happened yet, or for a reset email already sent
    // before reset-password.html existed. Hands the same URL hash
    // (still carrying the one-time recovery tokens) straight over
    // instead of showing "You're in" and silently treating a password
    // reset as an ordinary sign-in.
    if (event === 'PASSWORD_RECOVERY') {
      window.location.replace('/reset-password.html' + window.location.hash);
    }
  });

  // ---------- OAuth ----------

  // Google here goes through the same generic web OAuth redirect
  // Facebook/Apple already use on mobile (src/auth/supabaseAuth.ts's
  // signInWithWebOAuth) — the real native Google Sign-In SDK the mobile
  // app uses instead doesn't exist on a plain webpage, and doesn't need
  // to: Supabase's own redirect flow is the standard way to do this on
  // the web, and it's simpler here than the mobile app's manual
  // in-app-browser token extraction, since a full page redirect plus
  // supabase-js's own detectSessionInUrl handles it automatically.
  function startOAuth(provider, noteId) {
    client.auth
      .signInWithOAuth({ provider: provider, options: { redirectTo: window.location.href } })
      .then(function (res) {
        if (res.error) setNote(noteId, res.error.message, 'error');
        // No further handling needed on success — signInWithOAuth already
        // navigates the browser away to the provider's own consent page.
      });
  }

  $('btn-google').addEventListener('click', function () {
    startOAuth('google', 'su-note');
  });
  $('btn-facebook').addEventListener('click', function () {
    startOAuth('facebook', 'su-note');
  });

  // ---------- email sign up ----------

  $('form-signup').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('su-name').value.trim();
    var email = $('su-email').value.trim();
    var password = $('su-password').value;
    var confirm = $('su-confirm').value;

    if (!name || !email || !password) {
      setNote('su-note', 'Fill in every field to continue.', 'error');
      return;
    }
    if (password.length < 6) {
      setNote('su-note', 'Password needs to be at least 6 characters.', 'error');
      return;
    }
    if (password !== confirm) {
      setNote('su-note', 'Passwords don’t match.', 'error');
      return;
    }

    setNote('su-note', '', null);
    setBusy('su-submit', true, 'Creating account…', 'Create account');
    client.auth
      .signUp({ email: email, password: password, options: { data: { name: name } } })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        if (!res.data.session) {
          // Email confirmation is on for this project — there's no session
          // yet, matching signUpWithEmail's own behavior on mobile.
          setNote('su-note', 'Check your email to confirm your account, then log in.', 'success');
          return;
        }
        return profileFor(res.data.session.user.id, email).then(function (profile) {
          showSignedIn(profile.name, profile.email);
        });
      })
      .catch(function (e) {
        setNote('su-note', e.message, 'error');
      })
      .finally(function () {
        setBusy('su-submit', false, 'Creating account…', 'Create account');
      });
  });

  // ---------- email log in ----------

  $('form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('li-email').value.trim();
    var password = $('li-password').value;

    if (!email || !password) {
      setNote('li-note', 'Enter your email and password.', 'error');
      return;
    }

    setNote('li-note', '', null);
    setBusy('li-submit', true, 'Logging in…', 'Log in');
    client.auth
      .signInWithPassword({ email: email, password: password })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        return profileFor(res.data.session.user.id, email).then(function (profile) {
          showSignedIn(profile.name, profile.email);
        });
      })
      .catch(function (e) {
        setNote('li-note', e.message, 'error');
      })
      .finally(function () {
        setBusy('li-submit', false, 'Logging in…', 'Log in');
      });
  });
})();
