(function () {
  'use strict';

  // /c/<code>: a community challenge's invite (K-04, 0152), or a club's
  // (0185: club codes are 6 characters, challenge codes 7). Shows what
  // it is, opens Hound right on it (hound://c/<code>), and for someone
  // without Hound yet, how to get it and the code to enter.

  var cfg = window.HOUND_CONFIG || {};
  var isConfigured =
    !!cfg.supabaseUrl &&
    !!cfg.supabasePublishableKey &&
    cfg.supabaseUrl.indexOf('YOUR_') !== 0 &&
    cfg.supabasePublishableKey.indexOf('YOUR_') !== 0;

  var client = isConfigured ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey) : null;
  var card = document.getElementById('invite-card');

  var KINDS = {
    steps: 'Step Race', streak: 'Daily Streak', distance: 'Group Distance Target', bingo: 'Bingo',
    seventyfive: '75 Day Challenge', journey: 'Journey', checklist: 'Accountability', houndopoly: 'Hound’opoly'
  };

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  function render(html) {
    card.innerHTML = html;
  }

  // vercel.json rewrites /c/<code> to this page and keeps the URL.
  function codeFromPath() {
    var parts = window.location.pathname.split('/').filter(Boolean);
    return (parts[parts.length - 1] || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  }

  function pretty(code) {
    return code.length > 3 ? code.slice(0, 3) + '-' + code.slice(3) : code;
  }

  if (!isConfigured) {
    render('<p class="section-sub">This site isn’t connected to a Hound project yet — see site/README.md.</p>');
    return;
  }

  var code = codeFromPath();
  if (code.length === 6) {
    showClub();
    return;
  }
  if (code.length !== 7) {
    render('<h2 class="section-title">This challenge link doesn’t look right</h2>');
    return;
  }

  function notFound() {
    render(
      '<h2 class="section-title">This challenge isn’t taking new players</h2>' +
      '<p class="section-sub">The code may have been mistyped, switched off, or the challenge has ended. ' +
      'If someone sent it to you, ask them for a new one.</p>'
    );
  }

  // community_code_public is callable signed out on purpose (0152): just
  // the name, kind, start and how many are in, and only for a code that
  // works.
  client.rpc('community_code_public', { p_code: code })
    .then(function (res) {
      var row = res.data && res.data[0];
      if (res.error || !row) {
        notFound();
        return;
      }
      show(row);
    })
    .catch(notFound);

  function show(row) {
    var kind = KINDS[row.kind] || 'Challenge';
    var starts = new Date(row.starts_at);
    var startsWord = starts > new Date()
      ? 'starts ' + starts.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : 'running now';
    var joined = row.participant_count === 1 ? '1 person is in' : row.participant_count + ' people are in';
    render(
      '<p class="section-sub" style="margin:0;text-transform:uppercase;letter-spacing:.06em;font-size:12px">' +
        escapeHtml(kind) + ' · ' + escapeHtml(startsWord) + '</p>' +
      '<h2 class="section-title">' + escapeHtml(row.name) + '</h2>' +
      '<p class="section-sub">' + escapeHtml(joined) + '. Join with Hound.</p>' +
      '<p><a class="btn btn-primary btn-block" id="open-app" href="hound://c/' + encodeURIComponent(code) + '">Open in Hound</a></p>' +
      '<div class="notes">' +
        '<p class="section-sub" style="margin:0 0 8px">No Hound yet? Get it, then go to <b>Challenges</b> → <b>Have a code?</b> and enter:</p>' +
        '<div class="linkbox"><span style="flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:18px;letter-spacing:0.08em;user-select:all">' +
          escapeHtml(pretty(code)) + '</span><button class="copy-btn" id="copy-code">Copy</button></div>' +
        '<p><a class="btn btn-secondary btn-block" href="/get">Get Hound</a></p>' +
      '</div>'
    );
    document.getElementById('copy-code').addEventListener('click', function () {
      var btn = this;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(pretty(code)).then(function () {
          btn.textContent = 'Copied!';
          setTimeout(function () { btn.textContent = 'Copy'; }, 2000);
        }).catch(function () {});
      }
    });
  }
  // A club's invite: its name, sport, city and members, signed out
  // (club_code_public, 0185).
  function showClub() {
    // Inside: the page returns before reaching anything set below it.
    var SPORTS = { running: 'Running', cycling: 'Cycling', walking: 'Walking', hiking: 'Hiking', swimming: 'Swimming', mixed: 'Mixed' };
    function clubNotFound() {
      render(
        '<h2 class="section-title">This club link doesn’t work</h2>' +
        '<p class="section-sub">The code may have been mistyped or changed. Ask whoever sent it for a new one.</p>'
      );
    }
    client.rpc('club_code_public', { p_code: code })
      .then(function (res) {
        var row = res.data && res.data[0];
        if (res.error || !row) {
          clubNotFound();
          return;
        }
        var what = (SPORTS[row.sport] || 'Club') + (row.city ? ' · ' + row.city : '');
        var members = row.members === 1 ? '1 member' : row.members + ' members';
        render(
          '<p class="section-sub" style="margin:0;text-transform:uppercase;letter-spacing:.06em;font-size:12px">' +
            escapeHtml(what) + '</p>' +
          '<h2 class="section-title">' + escapeHtml(row.name) + '</h2>' +
          '<p class="section-sub">' + escapeHtml(members) + '. Join the club on Hound to see its challenges.</p>' +
          '<p><a class="btn btn-primary btn-block" href="hound://c/' + encodeURIComponent(code) + '">Open in Hound</a></p>' +
          '<div class="notes">' +
            '<p class="section-sub" style="margin:0 0 8px">No Hound yet? Get it, then go to <b>Clubs</b> → <b>Have a club code?</b> and enter:</p>' +
            '<div class="linkbox"><span style="flex:1;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:18px;letter-spacing:0.08em;user-select:all">' +
              escapeHtml(pretty(code)) + '</span></div>' +
            '<p><a class="btn btn-secondary btn-block" href="/get">Get Hound</a></p>' +
          '</div>'
        );
      })
      .catch(clubNotFound);
  }
})();
