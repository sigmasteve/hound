(function () {
  'use strict';

  var cfg = window.HOUND_CONFIG || {};
  var isConfigured =
    !!cfg.supabaseUrl &&
    !!cfg.supabasePublishableKey &&
    cfg.supabaseUrl.indexOf('YOUR_') !== 0 &&
    cfg.supabasePublishableKey.indexOf('YOUR_') !== 0;

  var client = isConfigured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey) : null;

  function $(id) {
    return document.getElementById(id);
  }

  function setNote(message, kind) {
    var el = $('rp-note');
    el.textContent = message || '';
    el.className = 'form-note' + (kind ? ' ' + kind : '');
  }

  function showInvalid(message) {
    $('reset-sub').textContent = message;
  }

  function showForm() {
    $('reset-sub').textContent = 'Choose a new password for your account.';
    $('form-reset').style.display = '';
  }

  if (!isConfigured) {
    showInvalid("This site isn't connected to a Hound project yet — see site/README.md.");
    return;
  }

  // Supabase's recovery link puts a one-time session in the URL and fires
  // a PASSWORD_RECOVERY event once supabase-js's default detectSessionInUrl
  // has picked it up — that's the one moment this page can trust "the
  // person at this browser is the one who clicked the email link," so the
  // form only appears after that fires, not just because *some* session
  // exists (a browser already logged into Hound would otherwise sail
  // straight through as if it were the reset, without ever proving they
  // own this email).
  var recovered = false;
  client.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') {
      recovered = true;
      showForm();
    }
  });

  // A broken, expired, or already-used link never fires PASSWORD_RECOVERY —
  // give up on "verifying" after a few seconds instead of leaving that
  // message up forever with no explanation.
  setTimeout(function () {
    if (!recovered) {
      showInvalid('This reset link looks invalid or has expired — request a new one from the app.');
    }
  }, 4000);

  $('form-reset').addEventListener('submit', function (e) {
    e.preventDefault();
    var password = $('rp-password').value;
    var confirm = $('rp-confirm').value;

    if (password.length < 6) {
      setNote('Password needs to be at least 6 characters.', 'error');
      return;
    }
    if (password !== confirm) {
      setNote('Passwords don’t match.', 'error');
      return;
    }

    setNote('', null);
    var btn = $('rp-submit');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    client.auth
      .updateUser({ password: password })
      .then(function (res) {
        if (res.error) throw new Error(res.error.message);
        $('reset-card').innerHTML =
          '<h2 class="section-title">Password updated</h2>' +
          '<p class="section-sub">You can log in with your new password now — open the Hound app and log in as usual.</p>';
      })
      .catch(function (e) {
        setNote(e.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Set new password';
      });
  });
})();
