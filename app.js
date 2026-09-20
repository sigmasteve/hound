(function () {
  'use strict';

  var TINT_A = 'var(--color-accent-800)';
  var TINT_N = '#3f424d';
  var AMBER = '#e0a94f';
  var GREEN = '#7fd39b';

  var state = {
    screen: 'home',
    metric: 'steps',
    step: 1,
    draftType: 'hunt',
    draftName: 'The Hunt: Jordan vs Marcus',
    headStart: 2,
    invited: ['Marcus R.', 'Dana K.'],
    alerts: [true, true, false],
  };

  var NAV = [
    ['home', 'Today', 'ph ph-house'],
    ['challenges', 'Challenges', 'ph ph-flag-checkered'],
    ['metrics', 'Data', 'ph ph-chart-line-up'],
    ['friends', 'Friends', 'ph ph-users-three'],
    ['connect', 'Connect', 'ph ph-plugs'],
  ];

  var CHALLENGE_TYPES = [
    ['hunt', 'Chase', 'One runner gets a head start. The other has to catch them on logged miles before time runs out.', 'ph-fill ph-paw-print', 'var(--color-accent-800)', 'var(--color-accent-100)'],
    ['steps', 'Step Race', 'Most steps over the window. Everyone against everyone.', 'ph ph-footprints', '#3f424d', '#e9e9ed'],
    ['streak', 'Daily Streak', 'Hit a daily goal every day. One miss and you are out.', 'ph ph-flame', '#3f424d', '#e9e9ed'],
    ['distance', 'Distance Pool', 'Add every mile the group covers toward one shared target.', 'ph ph-path', '#3f424d', '#e9e9ed'],
  ];

  var FRIEND_DATA = [
    { name: 'Marcus R.', initials: 'MR', platform: 'Apple Health', srcIcon: 'ph-fill ph-apple-logo', tint: TINT_N, sync: 'Synced 22m ago', syncColor: GREEN, sub: 'Your hound · 4 challenges together' },
    { name: 'Dana K.', initials: 'DK', platform: 'Health Connect', srcIcon: 'ph ph-android-logo', tint: TINT_A, sync: 'Synced 1h ago', syncColor: GREEN, sub: 'Joined in January' },
    { name: 'Priya S.', initials: 'PS', platform: 'Apple Health', srcIcon: 'ph-fill ph-apple-logo', tint: TINT_N, sync: 'Synced 8m ago', syncColor: GREEN, sub: 'Sent you an invite' },
    { name: 'Theo A.', initials: 'TA', platform: 'Health Connect', srcIcon: 'ph ph-android-logo', tint: TINT_A, sync: 'Stale · 2 days', syncColor: AMBER, sub: 'Pixel 8 · reconnect needed' },
    { name: 'Sam O.', initials: 'SO', platform: 'Apple Health', srcIcon: 'ph-fill ph-apple-logo', tint: TINT_N, sync: 'Synced 34m ago', syncColor: GREEN, sub: 'Longest streak: 41 days' },
  ];

  var RACE_BOARD = [
    { rank: 1, name: 'Priya S.', initials: 'PS', tint: TINT_N, src: 'Apple', srcIcon: 'ph-fill ph-apple-logo', steps: '64,102', pct: '100%', bar: 'var(--color-accent-400)', valStyle: '' },
    { rank: 2, name: 'You', initials: 'JL', tint: TINT_A, src: 'Apple', srcIcon: 'ph-fill ph-apple-logo', steps: '58,910', pct: '92%', bar: 'var(--color-accent)', valStyle: 'color:var(--color-accent-200)' },
    { rank: 3, name: 'Dana K.', initials: 'DK', tint: TINT_A, src: 'Google', srcIcon: 'ph ph-android-logo', steps: '52,447', pct: '82%', bar: 'var(--color-accent-600)', valStyle: '' },
    { rank: 4, name: 'Theo A.', initials: 'TA', tint: TINT_A, src: 'Google', srcIcon: 'ph ph-android-logo', steps: '41,208', pct: '64%', bar: AMBER, valStyle: 'color:' + AMBER },
  ];

  var TALLY = [
    { label: 'Marcus · evening run', meta: 'Yesterday 6:40pm · Health Connect', dist: '6.1 mi', icon: 'ph ph-person-simple-run', tint: TINT_N },
    { label: 'You · lunch walk', meta: 'Yesterday 12:20pm · Apple Health', dist: '2.4 mi', icon: 'ph ph-sneaker-move', tint: TINT_A },
    { label: 'Marcus · treadmill run', meta: 'Sunday 7:10am · not counted, no GPS', dist: '—', icon: 'ph ph-prohibit', tint: '#3a2f1c' },
    { label: 'You · trail run', meta: 'Sunday 8:02am · Apple Health', dist: '7.8 mi', icon: 'ph ph-person-simple-run', tint: TINT_A },
    { label: 'Marcus · dog walk', meta: 'Saturday 6:15pm · Health Connect', dist: '3.2 mi', icon: 'ph ph-dog', tint: TINT_N },
  ];

  var CHALLENGES = [
    {
      name: 'The Chase: Jordan vs Marcus', kind: 'Chase', tagClass: 'tag tag-accent',
      sub: 'Day 9 of 21 · GPS distance from runs and walks', stat: '7.4 mi', statLabel: 'your lead',
      icon: 'ph-fill ph-paw-print', tint: 'var(--color-accent-800)', iconColor: 'var(--color-accent-100)',
      people: [{ initials: 'JL', tint: TINT_A }, { initials: 'MR', tint: TINT_N }],
      target: 'hunt',
    },
    {
      name: 'March Step Race', kind: 'Step Race', tagClass: 'tag tag-neutral',
      sub: '4 days left · 5 friends across iPhone and Android', stat: '2nd', statLabel: 'of 5 · 58,910 steps',
      icon: 'ph ph-footprints', tint: '#3f424d', iconColor: '#e9e9ed',
      people: [{ initials: 'PS', tint: TINT_N }, { initials: 'JL', tint: TINT_A }, { initials: 'DK', tint: TINT_A }, { initials: 'TA', tint: TINT_N }],
      target: 'challenges',
    },
    {
      name: '10k A Day', kind: 'Daily Streak', tagClass: 'tag tag-neutral',
      sub: 'Alive · 3 of 6 still in', stat: '17 days', statLabel: 'current streak',
      icon: 'ph ph-flame', tint: '#3f424d', iconColor: AMBER,
      people: [{ initials: 'JL', tint: TINT_A }, { initials: 'SO', tint: TINT_N }, { initials: 'DK', tint: TINT_A }],
      target: 'challenges',
    },
  ];

  var WORKOUTS = [
    { name: 'Trail run', when: 'Sun 8:02am', src: 'Apple Health', dist: '7.8 mi', hr: '148' },
    { name: 'Lunch walk', when: 'Mon 12:20pm', src: 'Apple Health', dist: '2.4 mi', hr: '96' },
    { name: 'Cycling', when: 'Sat 9:15am', src: 'Strava → Health Connect', dist: '14.2 mi', hr: '132' },
    { name: 'Strength', when: 'Fri 6:30pm', src: 'Apple Watch', dist: '—', hr: '118' },
    { name: 'Evening walk', when: 'Thu 7:45pm', src: 'Apple Health', dist: '1.9 mi', hr: '92' },
  ];

  var SOURCES = [
    { name: 'Apple Health', icon: 'ph-fill ph-apple-logo', tint: TINT_N, status: 'Synced 4 minutes ago', statusColor: GREEN, scope: 'Steps, workouts, HR, weight', action: 'Manage', btnClass: 'btn btn-secondary' },
    { name: 'Health Connect', icon: 'ph ph-android-logo', tint: TINT_A, status: 'Last sync 2 days ago — background access paused', statusColor: AMBER, scope: 'Steps, workouts, distance', action: 'Reconnect', btnClass: 'btn btn-primary' },
    { name: 'Withings Scale', icon: 'ph ph-scales', tint: TINT_N, status: 'Via Apple Health · Sunday', statusColor: GREEN, scope: 'Weight only', action: 'Manage', btnClass: 'btn btn-secondary' },
  ];

  var ALERT_DEFS = [
    { label: 'Someone closes within 2 miles of me', note: 'Hunt challenges' },
    { label: 'A friend’s data goes stale mid-challenge', note: 'All challenges' },
    { label: 'Daily standings at 8pm', note: 'Step races' },
  ];

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function navStyle(on) {
    return 'display:flex;align-items:center;gap:6px;padding:7px 12px;border:0;border-radius:8px;cursor:pointer;font:inherit;font-size:13px;white-space:nowrap;font-family:var(--font-heading);font-weight:500;'
      + (on
        ? 'background:color-mix(in srgb, var(--color-accent) 16%, transparent);color:var(--color-accent-200);box-shadow:inset 0 0 0 1px var(--color-accent)'
        : 'background:transparent;color:color-mix(in srgb, #e9e9ed 68%, transparent)');
  }

  function metricInfo() {
    var m = state.metric;
    if (m === 'hr') return {
      value: '58 bpm', sub: 'resting, 7-day average',
      apple: 'Apple Watch · 96%', google: 'Health Connect · 4%',
      note: 'Continuous during workouts',
      line: [62, 61, 59, 60, 58, 57, 58],
    };
    if (m === 'weight') return {
      value: '178.4 lb', sub: 'down 1.8 lb this month',
      apple: 'Withings → Apple Health · 100%', google: 'Health Connect · none',
      note: 'Manual entries allowed',
      line: [181, 180.6, 180.1, 179.4, 179.2, 178.6, 178.4],
    };
    return {
      value: '8,432 steps', sub: 'today · 58,910 this week',
      apple: 'iPhone + Watch · 92%', google: 'Health Connect · 8%',
      note: 'De-duplicated across devices',
      line: [],
    };
  }

  function svgPath(vals, close) {
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = (max - min) || 1;
    var pts = vals.map(function (v, i) {
      return [(i / (vals.length - 1)) * 640, 168 - ((v - min) / span) * 140];
    });
    var d = 'M ' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
    for (var i = 1; i < pts.length; i++) {
      var px = pts[i - 1][0], py = pts[i - 1][1], x = pts[i][0], y = pts[i][1], cx = (px + x) / 2;
      d += ' C ' + cx.toFixed(1) + ' ' + py.toFixed(1) + ', ' + cx.toFixed(1) + ' ' + y.toFixed(1) + ', ' + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return close ? d + ' L 640 180 L 0 180 Z' : d;
  }

  // ── Actions ──────────────────────────────────────────────────────────
  var Actions = {
    go: function (screen) { setState({ screen: screen }); },
    goSteps: function () { setState({ screen: 'metrics', metric: 'steps' }); },
    goHr: function () { setState({ screen: 'metrics', metric: 'hr' }); },
    goWeight: function () { setState({ screen: 'metrics', metric: 'weight' }); },
    pickMetric: function (id) { setState({ metric: id }); },
    pickType: function (id) { setState({ draftType: id }); },
    toggleFriend: function (name) {
      var invited = state.invited.indexOf(name) >= 0
        ? state.invited.filter(function (n) { return n !== name; })
        : state.invited.concat(name);
      setState({ invited: invited });
    },
    setDraftName: function (value) { setState({ draftName: value }); },
    setHeadStart: function (value) { setState({ headStart: Number(value) }); },
    back: function () { setState({ step: Math.max(1, state.step - 1) }); },
    next: function () {
      if (state.step === 3) setState({ screen: 'hunt', step: 1 });
      else setState({ step: state.step + 1 });
    },
    toggleAlert: function (idx) {
      var alerts = state.alerts.slice();
      alerts[idx] = !alerts[idx];
      setState({ alerts: alerts });
    },
    noop: function () {},
  };

  function setState(patch) {
    Object.assign(state, patch);
    render();
  }

  // ── Screen renderers ────────────────────────────────────────────────

  function renderHeader() {
    var navHtml = NAV.map(function (item) {
      var id = item[0], label = item[1], icon = item[2];
      var on = state.screen === id || (id === 'challenges' && (state.screen === 'hunt' || state.screen === 'create'));
      return '<button type="button" data-act="go" data-arg="' + id + '" style="' + navStyle(on) + '"><i class="' + icon + '" style="font-size:15px"></i>' + label + '</button>';
    }).join('');

    return (
      '<header style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:14px clamp(16px,4vw,40px);position:sticky;top:0;z-index:20;background:color-mix(in srgb, #161826 88%, transparent);backdrop-filter:blur(10px)">' +
        '<div style="display:flex;align-items:center;gap:9px;margin-right:auto">' +
          '<span style="display:grid;place-items:center;width:28px;height:28px;border-radius:9px;border:1px solid var(--color-accent);color:var(--color-accent);box-shadow:0 0 18px color-mix(in srgb, var(--color-accent) 30%, transparent)"><i class="ph-fill ph-paw-print" style="font-size:16px"></i></span>' +
          '<span style="font-family:var(--font-heading);font-weight:600;font-size:17px;letter-spacing:0.02em">Hound</span>' +
        '</div>' +
        '<nav class="hound-scroll" style="display:flex;gap:4px;overflow-x:auto;max-width:100%;padding:3px;border:1px solid var(--color-divider);border-radius:10px">' + navHtml + '</nav>' +
        '<button type="button" data-act="go" data-arg="settings" style="display:flex;align-items:center;gap:8px;padding:4px 10px 4px 4px;background:transparent;border:1px solid var(--color-divider);border-radius:999px;color:var(--color-text);cursor:pointer;font:inherit;font-size:13px">' +
          '<span style="display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--color-accent-800);color:var(--color-accent-100);font-size:11px;font-weight:600">JL</span>Jordan' +
        '</button>' +
      '</header>'
    );
  }

  function renderHome() {
    var raceRows = RACE_BOARD.map(function (row) {
      return (
        '<div style="display:flex;align-items:center;gap:10px;padding:6px 0">' +
          '<span class="text-muted" style="width:16px;font-size:12px;font-variant-numeric:tabular-nums">' + row.rank + '</span>' +
          '<span style="display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:' + row.tint + ';font-size:10px;font-weight:600">' + row.initials + '</span>' +
          '<span style="font-size:13.5px">' + row.name + '</span>' +
          '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:5px;background:var(--color-neutral-800);font-size:10px;color:var(--color-neutral-200)"><i class="' + row.srcIcon + '" style="font-size:11px"></i>' + row.src + '</span>' +
          '<span style="flex:1;height:3px;border-radius:2px;background:var(--color-neutral-900);overflow:hidden"><span style="display:block;height:100%;width:' + row.pct + ';background:' + row.bar + '"></span></span>' +
          '<span style="font-size:12.5px;font-variant-numeric:tabular-nums;' + row.valStyle + '">' + row.steps + '</span>' +
        '</div>'
      );
    }).join('');

    return (
      '<section style="display:flex;flex-direction:column;gap:22px">' +
        '<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap;padding-top:10px">' +
          '<div>' +
            '<p style="margin:0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-accent)">Tuesday · week 3 of the chase</p>' +
            '<h2 style="margin:6px 0 0;font-size:clamp(26px,4vw,34px)">Marcus is 7.4 mi behind you.</h2>' +
          '</div>' +
          '<button type="button" data-act="go" data-arg="hunt" class="btn btn-primary" style="font-size:14px;padding:9px 14px"><i class="ph ph-crosshair"></i>Open the chase</button>' +
        '</div>' +

        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
          '<span style="display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:999px;background:var(--color-surface);box-shadow:var(--shadow-sm);font-size:12px"><i class="ph-fill ph-apple-logo" style="font-size:14px"></i>Apple Health<span style="width:6px;height:6px;border-radius:50%;background:#7fd39b"></span><span class="text-muted">4 min ago</span></span>' +
          '<span style="display:inline-flex;align-items:center;gap:7px;padding:5px 11px;border-radius:999px;background:var(--color-surface);box-shadow:var(--shadow-sm);font-size:12px"><i class="ph ph-android-logo" style="font-size:14px"></i>Health Connect<span style="width:6px;height:6px;border-radius:50%;background:#e0a94f"></span><span class="text-muted">2 days ago</span></span>' +
          '<button type="button" data-act="go" data-arg="settings" class="btn btn-ghost" style="font-size:12px"><i class="ph ph-arrows-clockwise"></i>Sync now</button>' +
        '</div>' +

        '<div style="display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:8px;background:linear-gradient(90deg, #3a2f1c, #232532 70%);box-shadow:var(--shadow-sm)">' +
          '<i class="ph-fill ph-warning" style="font-size:18px;color:#e0a94f;margin-top:2px"></i>' +
          '<div style="flex:1;min-width:200px">' +
            '<p style="margin:0;font-size:14px;font-family:var(--font-heading);font-weight:500">Theo\'s Pixel hasn\'t reported since Sunday</p>' +
            '<p style="margin:2px 0 0;font-size:13px;opacity:.78">His step race total is frozen at 41,208. Scores stay provisional until Health Connect catches up.</p>' +
          '</div>' +
          '<button type="button" data-act="go" data-arg="friends" class="btn btn-secondary" style="font-size:12px;white-space:nowrap">Nudge Theo</button>' +
        '</div>' +

        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:12px">' +
          '<button type="button" data-act="goSteps" style="text-align:left;cursor:pointer;font:inherit;color:inherit;display:flex;flex-direction:column;gap:10px;padding:14px;border:0;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm)">' +
            '<span style="display:flex;align-items:center;gap:7px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-accent)"><i class="ph ph-footprints" style="font-size:14px"></i>Steps</span>' +
            '<span style="font-family:var(--font-heading);font-size:32px;line-height:1">8,432</span>' +
            '<span style="height:4px;border-radius:2px;background:var(--color-neutral-800);overflow:hidden"><span style="display:block;height:100%;width:84%;background:var(--color-accent);box-shadow:0 0 10px var(--color-accent)"></span></span>' +
            '<span class="text-muted" style="font-size:12px">84% of 10,000 · Apple Health</span>' +
          '</button>' +
          '<button type="button" data-act="goSteps" style="text-align:left;cursor:pointer;font:inherit;color:inherit;display:flex;flex-direction:column;gap:10px;padding:14px;border:0;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm)">' +
            '<span style="display:flex;align-items:center;gap:7px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-accent)"><i class="ph ph-path" style="font-size:14px"></i>Distance</span>' +
            '<span style="font-family:var(--font-heading);font-size:32px;line-height:1">3.8 <span style="font-size:15px;opacity:.6">mi</span></span>' +
            '<span style="height:4px;border-radius:2px;background:var(--color-neutral-800);overflow:hidden"><span style="display:block;height:100%;width:63%;background:var(--color-accent)"></span></span>' +
            '<span class="text-muted" style="font-size:12px">1 walk, 1 run logged</span>' +
          '</button>' +
          '<button type="button" data-act="goHr" style="text-align:left;cursor:pointer;font:inherit;color:inherit;display:flex;flex-direction:column;gap:10px;padding:14px;border:0;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm)">' +
            '<span style="display:flex;align-items:center;gap:7px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-accent)"><i class="ph ph-heartbeat" style="font-size:14px"></i>Resting HR</span>' +
            '<span style="font-family:var(--font-heading);font-size:32px;line-height:1">58 <span style="font-size:15px;opacity:.6">bpm</span></span>' +
            '<span style="height:4px;border-radius:2px;background:var(--color-neutral-800);overflow:hidden"><span style="display:block;height:100%;width:42%;background:var(--color-accent-600)"></span></span>' +
            '<span class="text-muted" style="font-size:12px">Down 3 bpm over 30 days</span>' +
          '</button>' +
          '<button type="button" data-act="goWeight" style="text-align:left;cursor:pointer;font:inherit;color:inherit;display:flex;flex-direction:column;gap:10px;padding:14px;border:0;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm)">' +
            '<span style="display:flex;align-items:center;gap:7px;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-accent)"><i class="ph ph-scales" style="font-size:14px"></i>Weight</span>' +
            '<span style="font-family:var(--font-heading);font-size:32px;line-height:1">178.4 <span style="font-size:15px;opacity:.6">lb</span></span>' +
            '<span style="height:4px;border-radius:2px;background:var(--color-neutral-800);overflow:hidden"><span style="display:block;height:100%;width:28%;background:var(--color-accent-600)"></span></span>' +
            '<span class="text-muted" style="font-size:12px">Last entry Sunday · Withings</span>' +
          '</button>' +
        '</div>' +

        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">' +
          '<div style="display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:8px;background:linear-gradient(150deg, #262a60 0%, #232532 72%);box-shadow:var(--shadow-sm)">' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<i class="ph-fill ph-paw-print" style="font-size:15px;color:var(--color-accent-300)"></i>' +
              '<span style="font-family:var(--font-heading);font-weight:500;font-size:16px">The Hunt · Jordan vs Marcus</span>' +
              '<span class="tag tag-outline" style="margin-left:auto">day 9 / 21</span>' +
            '</div>' +
            '<div style="position:relative;height:44px;border-radius:8px;background:repeating-linear-gradient(90deg, transparent 0 26px, color-mix(in srgb, var(--color-text) 9%, transparent) 26px 28px)">' +
              '<span style="position:absolute;top:50%;left:0;right:0;height:1px;background:linear-gradient(to right, transparent, var(--color-divider) 20px, var(--color-divider) calc(100% - 20px), transparent)"></span>' +
              '<span style="position:absolute;top:50%;transform:translate(-50%,-50%);left:67%;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#3f424d;box-shadow:0 0 0 1px var(--color-neutral-600);animation:hound-pulse 2.4s ease-in-out infinite"><i class="ph-fill ph-dog" style="font-size:16px"></i></span>' +
              '<span style="position:absolute;top:50%;transform:translate(-50%,-50%);left:82%;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--color-accent-800);box-shadow:0 0 0 1px var(--color-accent), 0 0 20px color-mix(in srgb, var(--color-accent) 45%, transparent)"><i class="ph-fill ph-sneaker-move" style="font-size:16px;color:var(--color-accent-100)"></i></span>' +
            '</div>' +
            '<div style="display:flex;gap:18px;flex-wrap:wrap;align-items:baseline">' +
              '<span style="font-family:var(--font-heading);font-size:26px;line-height:1">7.4 mi<span style="font-size:13px;opacity:.65"> lead</span></span>' +
              '<span class="text-muted" style="font-size:12.5px">Marcus logged 6.1 mi yesterday. Shrinking fast.</span>' +
            '</div>' +
            '<button type="button" data-act="go" data-arg="hunt" class="btn btn-primary" style="align-self:flex-start;font-size:13px">See the tally</button>' +
          '</div>' +

          '<div style="display:flex;flex-direction:column;gap:10px;padding:16px;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm)">' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<i class="ph ph-trophy" style="font-size:15px;color:var(--color-accent)"></i>' +
              '<span style="font-family:var(--font-heading);font-weight:500;font-size:16px">March Step Race</span>' +
              '<span class="text-muted" style="margin-left:auto;font-size:12px">5 friends · 4 days left</span>' +
            '</div>' +
            raceRows +
            '<button type="button" data-act="go" data-arg="challenges" class="btn btn-ghost" style="align-self:flex-start;font-size:12.5px">Full leaderboard</button>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function renderHunt() {
    var tallyRows = TALLY.map(function (t) {
      return (
        '<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid color-mix(in srgb, var(--color-text) 7%, transparent)">' +
          '<span style="display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:' + t.tint + '"><i class="' + t.icon + '" style="font-size:14px"></i></span>' +
          '<span style="flex:1;min-width:0"><span style="display:block;font-size:13.5px">' + t.label + '</span><span class="text-muted" style="display:block;font-size:11.5px">' + t.meta + '</span></span>' +
          '<span style="font-family:var(--font-heading);font-size:14px;font-variant-numeric:tabular-nums">' + t.dist + '</span>' +
        '</div>'
      );
    }).join('');

    return (
      '<section style="display:flex;flex-direction:column;gap:20px;padding-top:12px">' +
        '<button type="button" data-act="go" data-arg="challenges" class="btn btn-ghost" style="align-self:flex-start;font-size:12.5px"><i class="ph ph-arrow-left"></i>All challenges</button>' +

        '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap">' +
          '<div>' +
            '<p style="margin:0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-accent)">Chase · 21 days</p>' +
            '<h2 style="margin:6px 0 0;font-size:clamp(24px,3.6vw,32px)">Marcus is chasing you</h2>' +
          '</div>' +
          '<div style="display:flex;gap:8px">' +
            '<button type="button" class="btn btn-secondary" style="font-size:13px"><i class="ph ph-chat-circle"></i>Trash talk</button>' +
            '<button type="button" class="btn btn-primary" style="font-size:13px"><i class="ph ph-plus"></i>Log a workout</button>' +
          '</div>' +
        '</div>' +

        '<div style="padding:clamp(16px,3vw,26px);border-radius:14px;background:linear-gradient(160deg, #262a60 0%, #1e2138 55%, #232532 100%);box-shadow:var(--shadow-md)">' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:20px">' +
            '<div><span style="font-family:var(--font-heading);font-size:clamp(30px,5vw,44px);line-height:1">7.4 mi</span><span style="font-size:14px;opacity:.7;margin-left:8px">of open road between you</span></div>' +
            '<span class="text-muted" style="font-size:12.5px">Head start: 2 days · Ends Sat 28 Mar, 11:59pm</span>' +
          '</div>' +

          '<div style="position:relative;height:96px;margin-bottom:8px">' +
            '<span style="position:absolute;left:0;right:0;top:52px;height:12px;border-radius:6px;background:repeating-linear-gradient(90deg, color-mix(in srgb, var(--color-text) 10%, transparent) 0 14px, transparent 14px 28px);animation:hound-dash 1.8s linear infinite"></span>' +
            '<span style="position:absolute;right:0;top:20px;bottom:8px;width:2px;background:linear-gradient(var(--color-accent-300), transparent)"></span>' +
            '<span style="position:absolute;right:0;top:0;font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-accent-300)">Finish 50 mi</span>' +
            '<span style="position:absolute;top:58px;transform:translateX(-50%);left:67%;display:flex;flex-direction:column;align-items:center;gap:5px"><span style="display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#3f424d;box-shadow:0 0 0 1px var(--color-neutral-500);animation:hound-pulse 2.4s ease-in-out infinite"><i class="ph-fill ph-dog" style="font-size:20px"></i></span><span style="font-size:11px;white-space:nowrap">Marcus · 33.8 mi</span></span>' +
            '<span style="position:absolute;top:2px;transform:translateX(-50%);left:82%;display:flex;flex-direction:column;align-items:center;gap:5px"><span style="font-size:11px;white-space:nowrap;color:var(--color-accent-200)">You · 41.2 mi</span><span style="display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:var(--color-accent-800);box-shadow:0 0 0 1px var(--color-accent), 0 0 26px color-mix(in srgb, var(--color-accent) 50%, transparent)"><i class="ph-fill ph-sneaker-move" style="font-size:20px;color:var(--color-accent-100)"></i></span></span>' +
          '</div>' +

          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:22px">' +
            '<div><p style="margin:0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:.6">Your pace</p><p style="margin:3px 0 0;font-family:var(--font-heading);font-size:19px">4.6 mi / day</p></div>' +
            '<div><p style="margin:0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:.6">His pace</p><p style="margin:3px 0 0;font-family:var(--font-heading);font-size:19px;color:#e0a94f">5.4 mi / day</p></div>' +
            '<div><p style="margin:0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:.6">Caught by</p><p style="margin:3px 0 0;font-family:var(--font-heading);font-size:19px">Fri 27 Mar</p></div>' +
            '<div><p style="margin:0;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;opacity:.6">Counts toward</p><p style="margin:3px 0 0;font-family:var(--font-heading);font-size:19px">Runs &amp; walks</p></div>' +
          '</div>' +
        '</div>' +

        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:12px">' +
          '<div style="display:flex;flex-direction:column;gap:4px;padding:16px;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm)">' +
            '<h4 style="margin:0 0 8px">The tally</h4>' + tallyRows +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:14px;padding:16px;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm)">' +
            '<h4 style="margin:0">Where the numbers come from</h4>' +
            '<div style="display:flex;gap:12px;align-items:flex-start">' +
              '<span style="display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--color-accent-800);color:var(--color-accent-100);font-size:12px;font-weight:600">JL</span>' +
              '<div style="flex:1"><p style="margin:0;font-size:14px">You <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;margin-left:4px;border-radius:5px;background:var(--color-neutral-800);font-size:10px;color:var(--color-neutral-200)"><i class="ph-fill ph-apple-logo" style="font-size:11px"></i>Apple Health · iPhone 15</span></p><p class="text-muted" style="margin:3px 0 0;font-size:12px">GPS distance from Apple Workouts. Synced 4 minutes ago.</p></div>' +
            '</div>' +
            '<div style="display:flex;gap:12px;align-items:flex-start">' +
              '<span style="display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#3f424d;font-size:12px;font-weight:600">MR</span>' +
              '<div style="flex:1"><p style="margin:0;font-size:14px">Marcus <span style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;margin-left:4px;border-radius:5px;background:var(--color-neutral-800);font-size:10px;color:var(--color-neutral-200)"><i class="ph ph-android-logo" style="font-size:11px"></i>Health Connect · Pixel 8</span></p><p class="text-muted" style="margin:3px 0 0;font-size:12px">GPS distance from Google Fit sessions. Synced 22 minutes ago.</p></div>' +
            '</div>' +
            '<div style="padding:11px 13px;border-radius:8px;background:color-mix(in srgb, var(--color-accent) 10%, transparent)"><p style="margin:0;font-size:12.5px;line-height:1.5;color:var(--color-accent-200)"><i class="ph ph-shield-check" style="font-size:13px;margin-right:5px"></i>Both sides are scored on GPS distance only, so a treadmill or a phone left on a desk can\'t pad the tally.</p></div>' +
          '</div>' +
        '</div>' +
      '</section>'
    );
  }

  function renderChallenges() {
    var rows = CHALLENGES.map(function (c) {
      var people = c.people.map(function (p) {
        return '<span style="display:grid;place-items:center;width:26px;height:26px;margin-left:-6px;border-radius:50%;border:1.5px solid var(--color-surface);background:' + p.tint + ';font-size:9.5px;font-weight:600">' + p.initials + '</span>';
      }).join('');
      return (
        '<button type="button" data-act="go" data-arg="' + c.target + '" style="text-align:left;cursor:pointer;font:inherit;color:inherit;display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:16px;border:0;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm)">' +
          '<span style="display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:' + c.tint + ';flex:none"><i class="' + c.icon + '" style="font-size:21px;color:' + c.iconColor + '"></i></span>' +
          '<span style="flex:1;min-width:180px"><span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span style="font-family:var(--font-heading);font-weight:500;font-size:17px">' + c.name + '</span><span class="' + c.tagClass + '">' + c.kind + '</span></span><span class="text-muted" style="display:block;font-size:12.5px;margin-top:3px">' + c.sub + '</span></span>' +
          '<span style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;min-width:120px"><span style="font-family:var(--font-heading);font-size:19px">' + c.stat + '</span><span class="text-muted" style="font-size:11.5px">' + c.statLabel + '</span></span>' +
          '<span style="display:flex;align-items:center;gap:-6px">' + people + '</span>' +
          '<i class="ph ph-caret-right" style="font-size:16px;opacity:.5"></i>' +
        '</button>'
      );
    }).join('');

    return (
      '<section style="display:flex;flex-direction:column;gap:18px;padding-top:12px">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap">' +
          '<h2 style="margin:0;font-size:clamp(24px,3.6vw,32px)">Challenges</h2>' +
          '<button type="button" data-act="go" data-arg="create" class="btn btn-primary" style="font-size:13px"><i class="ph ph-plus-circle"></i>New challenge</button>' +
        '</div>' +

        '<div style="display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:8px;background:linear-gradient(90deg, #2b2741, #232532 70%);box-shadow:var(--shadow-sm)">' +
          '<i class="ph-fill ph-envelope-open" style="font-size:18px;color:var(--color-accent-300)"></i>' +
          '<div style="flex:1;min-width:180px"><p style="margin:0;font-size:14px;font-family:var(--font-heading);font-weight:500">Priya invited you to "Sunrise Streak"</p><p class="text-muted" style="margin:2px 0 0;font-size:12.5px">30 minutes of movement before 9am · 14 days · starts Monday</p></div>' +
          '<button type="button" class="btn btn-secondary" style="font-size:12px">Decline</button>' +
          '<button type="button" class="btn btn-primary" style="font-size:12px">Join</button>' +
        '</div>' +

        rows +

        '<h4 style="margin:12px 0 0;opacity:.7">Finished</h4>' +
        '<div style="display:flex;gap:14px;align-items:center;padding:14px 16px;border-radius:8px;background:color-mix(in srgb, var(--color-surface) 60%, transparent)">' +
          '<i class="ph-fill ph-medal" style="font-size:20px;color:var(--color-neutral-500)"></i>' +
          '<span style="flex:1;font-size:14px">February Step Race</span>' +
          '<span class="text-muted" style="font-size:12.5px">You placed 2nd of 6 · 287,410 steps</span>' +
        '</div>' +
      '</section>'
    );
  }

  function renderCreate() {
    var stepsBar = [1, 2, 3].map(function (n) {
      return '<span style="flex:1;height:3px;border-radius:2px;background:' + (n <= state.step ? 'var(--color-accent)' : 'var(--color-neutral-800)') + '"></span>';
    }).join('');

    var body = '';
    if (state.step === 1) {
      var types = CHALLENGE_TYPES.map(function (t) {
        var id = t[0], name = t[1], desc = t[2], icon = t[3], tint = t[4], iconColor = t[5];
        var picked = state.draftType === id;
        var ring = picked ? 'inset 0 0 0 1px var(--color-accent)' : 'var(--shadow-sm)';
        var check = picked ? 'ph-fill ph-check-circle' : 'ph ph-circle';
        var checkColor = picked ? 'var(--color-accent)' : 'var(--color-neutral-700)';
        return (
          '<button type="button" data-act="pickType" data-arg="' + id + '" style="text-align:left;cursor:pointer;font:inherit;color:inherit;display:flex;gap:14px;align-items:flex-start;padding:15px;border-radius:8px;background:var(--color-surface);border:0;box-shadow:' + ring + '">' +
            '<span style="display:grid;place-items:center;width:38px;height:38px;border-radius:11px;background:' + tint + ';flex:none"><i class="' + icon + '" style="font-size:19px;color:' + iconColor + '"></i></span>' +
            '<span style="flex:1"><span style="display:block;font-family:var(--font-heading);font-weight:500;font-size:16px">' + name + '</span><span class="text-muted" style="display:block;font-size:13px;margin-top:2px">' + desc + '</span></span>' +
            '<i class="' + check + '" style="font-size:18px;color:' + checkColor + '"></i>' +
          '</button>'
        );
      }).join('');
      body = '<div style="display:flex;flex-direction:column;gap:14px"><h2 style="margin:0;font-size:clamp(24px,3.6vw,30px)">Pick the game</h2>' + types + '</div>';
    } else if (state.step === 2) {
      var huntBlock = '';
      var headStartLabel = state.headStart === 1 ? '1 day' : state.headStart + ' days';
      if (state.draftType === 'hunt') {
        huntBlock = (
          '<div style="display:flex;flex-direction:column;gap:14px;padding:16px;border-radius:8px;background:linear-gradient(150deg, #262a60, #232532 75%)">' +
            '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap"><span style="font-family:var(--font-heading);font-weight:500;font-size:15px">Head start for the hunted</span><span style="font-family:var(--font-heading);font-size:20px;color:var(--color-accent-200)">' + headStartLabel + '</span></div>' +
            '<input id="hound-headstart" type="range" min="1" max="3" step="1" value="' + state.headStart + '" data-act="setHeadStart" style="width:100%;accent-color:var(--color-accent)">' +
            '<p class="text-muted" style="margin:0;font-size:12.5px">The hunted logs alone for ' + headStartLabel + '. Then the hunter starts tallying and has to close the gap before the clock runs out.</p>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px">' +
              '<div class="field" style="margin:0"><label>Fox</label><div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;background:color-mix(in srgb, #161826 55%, transparent);font-size:13.5px"><span style="display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--color-accent-800);font-size:9.5px;font-weight:600">JL</span>You</div></div>' +
              '<div class="field" style="margin:0"><label>Hound</label><div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;background:color-mix(in srgb, #161826 55%, transparent);font-size:13.5px"><span style="display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#3f424d;font-size:9.5px;font-weight:600">MR</span>Marcus</div></div>' +
            '</div>' +
          '</div>'
        );
      }
      body = (
        '<div style="display:flex;flex-direction:column;gap:16px">' +
          '<h2 style="margin:0;font-size:clamp(24px,3.6vw,30px)">Set the rules</h2>' +
          '<div class="field"><label for="cname">Challenge name</label><input id="cname" class="input" type="text" value="' + escapeHtml(state.draftName) + '" data-act="setDraftName" placeholder="The Hunt: Jordan vs Marcus"></div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">' +
            '<div class="field"><label for="cstart">Starts</label><input id="cstart" class="input" type="date" value="2026-09-14"></div>' +
            '<div class="field"><label for="clen">Runs for</label><div class="seg" style="width:100%">' +
              '<label class="seg-opt" style="flex:1;justify-content:center"><input type="radio" name="clen"><span>7 days</span></label>' +
              '<label class="seg-opt" style="flex:1;justify-content:center"><input type="radio" name="clen" checked><span>21 days</span></label>' +
              '<label class="seg-opt" style="flex:1;justify-content:center"><input type="radio" name="clen"><span>30 days</span></label>' +
            '</div></div>' +
          '</div>' +
          huntBlock +
          '<div class="field"><label>What counts</label><div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<label class="radio" style="padding:8px 12px;border:1px solid var(--color-divider);border-radius:8px"><input type="radio" name="counts" checked><span class="dot"></span>GPS distance from runs &amp; walks</label>' +
            '<label class="radio" style="padding:8px 12px;border:1px solid var(--color-divider);border-radius:8px"><input type="radio" name="counts"><span class="dot"></span>Any logged workout</label>' +
          '</div></div>' +
          '<div style="display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border-radius:8px;background:color-mix(in srgb, var(--color-accent) 9%, transparent)"><i class="ph ph-devices" style="font-size:17px;color:var(--color-accent-300);margin-top:2px"></i><p style="margin:0;font-size:12.5px;line-height:1.5;color:var(--color-accent-200)">Marcus is on Android. Hound reads his Health Connect sessions and scores both of you on GPS distance so the platforms match. Anyone whose data goes stale is flagged rather than dropped.</p></div>' +
        '</div>'
      );
    } else {
      var picks = FRIEND_DATA.map(function (f) {
        var picked = state.invited.indexOf(f.name) >= 0;
        var ring = picked ? 'inset 0 0 0 1px var(--color-accent)' : 'var(--shadow-sm)';
        var check = picked ? 'ph-fill ph-check-circle' : 'ph ph-circle';
        var checkColor = picked ? 'var(--color-accent)' : 'var(--color-neutral-700)';
        return (
          '<button type="button" data-act="toggleFriend" data-arg="' + escapeHtml(f.name) + '" style="text-align:left;cursor:pointer;font:inherit;color:inherit;display:flex;gap:12px;align-items:center;padding:11px 14px;border-radius:8px;border:0;background:var(--color-surface);box-shadow:' + ring + '">' +
            '<span style="display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:' + f.tint + ';font-size:11px;font-weight:600">' + f.initials + '</span>' +
            '<span style="flex:1;font-size:14px">' + f.name + '</span>' +
            '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:5px;background:var(--color-neutral-800);font-size:10px;color:var(--color-neutral-200)"><i class="' + f.srcIcon + '" style="font-size:11px"></i>' + f.platform + '</span>' +
            '<i class="' + check + '" style="font-size:18px;color:' + checkColor + '"></i>' +
          '</button>'
        );
      }).join('');
      body = (
        '<div style="display:flex;flex-direction:column;gap:14px">' +
          '<h2 style="margin:0;font-size:clamp(24px,3.6vw,30px)">Bring friends</h2>' + picks +
          '<div style="display:flex;gap:8px;align-items:center;padding:13px 14px;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm);flex-wrap:wrap"><i class="ph ph-link" style="font-size:16px;color:var(--color-accent)"></i><span style="flex:1;min-width:160px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;opacity:.75">hound.app/j/chase-4kq9</span><button type="button" class="btn btn-secondary" style="font-size:12px">Copy invite link</button></div>' +
          '<p class="text-muted" style="margin:0;font-size:12.5px">Friends on iPhone connect Apple Health, friends on Android connect Health Connect. Same link either way.</p>' +
        '</div>'
      );
    }

    var backVis = state.step === 1 ? 'hidden' : 'visible';
    var nextLabel = state.step === 3 ? 'Start the challenge' : 'Continue';

    return (
      '<section style="display:flex;flex-direction:column;gap:20px;padding-top:12px;max-width:720px">' +
        '<button type="button" data-act="go" data-arg="challenges" class="btn btn-ghost" style="align-self:flex-start;font-size:12.5px"><i class="ph ph-x"></i>Cancel</button>' +
        '<div style="display:flex;gap:6px;align-items:center">' + stepsBar + '</div>' +
        '<p style="margin:0;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--color-accent)">Step ' + state.step + ' of 3</p>' +
        body +
        '<div style="display:flex;justify-content:space-between;gap:10px;padding-top:6px">' +
          '<button type="button" data-act="back" class="btn btn-secondary" style="font-size:13px;visibility:' + backVis + '"><i class="ph ph-arrow-left"></i>Back</button>' +
          '<button type="button" data-act="next" class="btn btn-primary" style="font-size:13px">' + nextLabel + '<i class="ph ph-arrow-right"></i></button>' +
        '</div>' +
      '</section>'
    );
  }

  function renderMetrics() {
    var mi = metricInfo();
    var tabs = [['steps', 'Steps & distance'], ['hr', 'Heart rate'], ['weight', 'Weight']].map(function (t) {
      var id = t[0], label = t[1];
      var on = state.metric === id;
      var style = on ? 'color:var(--color-accent);box-shadow:inset 0 0 0 1px var(--color-accent)' : '';
      return '<label class="seg-opt" style="' + style + '"><input type="radio" name="metric" data-act="pickMetric" data-arg="' + id + '"' + (on ? ' checked' : '') + '><span>' + label + '</span></label>';
    }).join('');

    var chart;
    if (state.metric === 'steps') {
      var bars = [
        ['Wed', 62], ['Thu', 88], ['Fri', 41], ['Sat', 74], ['Sun', 96], ['Mon', 35], ['Today', 56],
      ];
      chart = '<div style="display:flex;align-items:flex-end;gap:clamp(6px,2vw,18px);height:180px">' + bars.map(function (b, i) {
        var isToday = i === bars.length - 1;
        var grad = isToday ? 'linear-gradient(var(--color-accent-400), var(--color-accent-700))' : 'linear-gradient(var(--color-accent-500), var(--color-accent-800))';
        var extra = isToday ? ';box-shadow:0 0 0 1px var(--color-accent)' : '';
        var labelStyle = isToday ? 'font-size:11px;color:var(--color-accent-200)' : 'font-size:11px';
        var labelClass = isToday ? '' : 'text-muted';
        return '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:7px;height:100%"><span style="width:100%;max-width:46px;height:' + b[1] + '%;border-radius:6px 6px 2px 2px;background:' + grad + extra + '"></span><span class="' + labelClass + '" style="' + labelStyle + '">' + b[0] + '</span></div>';
      }).join('') + '</div>';
    } else {
      chart = (
        '<div style="position:relative;height:180px">' +
          '<svg viewBox="0 0 640 180" preserveAspectRatio="none" style="width:100%;height:100%;display:block">' +
            '<defs><linearGradient id="hdFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#968ae0" stop-opacity="0.35"></stop><stop offset="1" stop-color="#968ae0" stop-opacity="0"></stop></linearGradient></defs>' +
            '<path d="' + svgPath(mi.line, true) + '" fill="url(#hdFade)"></path>' +
            '<path d="' + svgPath(mi.line, false) + '" fill="none" stroke="#b5abfc" stroke-width="2.5" stroke-linecap="round"></path>' +
          '</svg>' +
        '</div>'
      );
    }

    var workoutRows = WORKOUTS.map(function (w) {
      return '<tr><td>' + w.name + '</td><td class="text-muted">' + w.when + '</td><td><span class="tag tag-neutral">' + w.src + '</span></td><td style="text-align:right;font-variant-numeric:tabular-nums">' + w.dist + '</td><td style="text-align:right;font-variant-numeric:tabular-nums">' + w.hr + '</td></tr>';
    }).join('');

    return (
      '<section style="display:flex;flex-direction:column;gap:18px;padding-top:12px">' +
        '<h2 style="margin:0;font-size:clamp(24px,3.6vw,32px)">Your data</h2>' +
        '<div class="seg">' + tabs + '</div>' +
        '<div style="display:flex;flex-direction:column;gap:18px;padding:clamp(14px,3vw,22px);border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm)">' +
          '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap"><div><span style="font-family:var(--font-heading);font-size:clamp(26px,4vw,36px);line-height:1">' + mi.value + '</span><span class="text-muted" style="font-size:13px;margin-left:8px">' + mi.sub + '</span></div><span class="text-muted" style="font-size:12px">Last 7 days</span></div>' +
          chart +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<span class="tag tag-neutral"><i class="ph-fill ph-apple-logo" style="font-size:11px;margin-right:5px"></i>' + mi.apple + '</span>' +
            '<span class="tag tag-neutral"><i class="ph ph-android-logo" style="font-size:11px;margin-right:5px"></i>' + mi.google + '</span>' +
            '<span class="tag tag-outline">' + mi.note + '</span>' +
          '</div>' +
        '</div>' +
        '<div style="padding:clamp(12px,2.5vw,18px);border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm);overflow-x:auto">' +
          '<table class="table"><thead><tr><th>Workout</th><th>When</th><th>Source</th><th style="text-align:right">Distance</th><th style="text-align:right">Avg HR</th></tr></thead><tbody>' + workoutRows + '</tbody></table>' +
        '</div>' +
      '</section>'
    );
  }

  function renderFriends() {
    var rows = FRIEND_DATA.map(function (f) {
      return (
        '<div style="display:flex;gap:12px;align-items:center;padding:13px 15px;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm);flex-wrap:wrap">' +
          '<span style="display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:' + f.tint + ';font-size:12px;font-weight:600">' + f.initials + '</span>' +
          '<span style="flex:1;min-width:150px"><span style="display:block;font-size:14.5px">' + f.name + '</span><span class="text-muted" style="display:block;font-size:12px">' + f.sub + '</span></span>' +
          '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:6px;background:var(--color-neutral-800);font-size:10.5px;color:var(--color-neutral-200)"><i class="' + f.srcIcon + '" style="font-size:12px"></i>' + f.platform + '</span>' +
          '<span style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:' + f.syncColor + '"><span style="width:6px;height:6px;border-radius:50%;background:' + f.syncColor + '"></span>' + f.sync + '</span>' +
          '<button type="button" class="btn btn-secondary" style="font-size:12px">Challenge</button>' +
        '</div>'
      );
    }).join('');

    return (
      '<section style="display:flex;flex-direction:column;gap:16px;padding-top:12px;max-width:820px">' +
        '<h2 style="margin:0;font-size:clamp(24px,3.6vw,32px)">Friends</h2>' +
        '<div style="display:flex;gap:8px;align-items:center;padding:13px 14px;border-radius:8px;background:linear-gradient(90deg, #2b2741, #232532 70%);box-shadow:var(--shadow-sm);flex-wrap:wrap"><i class="ph ph-user-plus" style="font-size:17px;color:var(--color-accent-300)"></i><span style="flex:1;min-width:170px;font-size:13.5px">Send one link. It works on iPhone and Android.</span><span style="font-family:ui-monospace,Menlo,monospace;font-size:12.5px;opacity:.7">hound.app/u/jordan</span><button type="button" class="btn btn-primary" style="font-size:12px">Copy</button></div>' +
        rows +
        '<h4 style="margin:10px 0 0;opacity:.7">Pending</h4>' +
        '<div style="display:flex;gap:12px;align-items:center;padding:13px 15px;border-radius:8px;background:color-mix(in srgb, var(--color-surface) 60%, transparent);flex-wrap:wrap"><span style="display:grid;place-items:center;width:34px;height:34px;border-radius:50%;border:1px dashed var(--color-neutral-600);color:var(--color-neutral-500)"><i class="ph ph-hourglass" style="font-size:15px"></i></span><span style="flex:1;min-width:150px;font-size:14px">kate.n@gmail.com</span><span class="text-muted" style="font-size:12px">Invited 3 days ago</span><button type="button" class="btn btn-ghost" style="font-size:12px">Resend</button></div>' +
      '</section>'
    );
  }

  function renderSettings() {
    var sourceRows = SOURCES.map(function (s) {
      return (
        '<div style="display:flex;gap:12px;align-items:center;padding:11px 0;flex-wrap:wrap;border-bottom:1px solid color-mix(in srgb, var(--color-text) 7%, transparent)">' +
          '<span style="display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:' + s.tint + '"><i class="' + s.icon + '" style="font-size:18px"></i></span>' +
          '<span style="flex:1;min-width:160px"><span style="display:block;font-size:14.5px">' + s.name + '</span><span style="display:block;font-size:12px;color:' + s.statusColor + '">' + s.status + '</span></span>' +
          '<span class="text-muted" style="font-size:12px">' + s.scope + '</span>' +
          '<button type="button" data-act="noop" class="' + s.btnClass + '" style="font-size:12px">' + s.action + '</button>' +
        '</div>'
      );
    }).join('');

    var alertRows = ALERT_DEFS.map(function (a, i) {
      return (
        '<label style="display:flex;gap:12px;align-items:center;cursor:pointer">' +
          '<input type="checkbox" data-act="toggleAlert" data-arg="' + i + '"' + (state.alerts[i] ? ' checked' : '') + ' style="width:16px;height:16px;accent-color:var(--color-accent)">' +
          '<span style="flex:1;font-size:14px">' + a.label + '</span>' +
          '<span class="text-muted" style="font-size:12px">' + a.note + '</span>' +
        '</label>'
      );
    }).join('');

    return (
      '<section style="display:flex;flex-direction:column;gap:18px;padding-top:12px;max-width:760px">' +
        '<h2 style="margin:0;font-size:clamp(24px,3.6vw,32px)">Data &amp; account</h2>' +
        '<div style="display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm)">' +
          '<h4 style="margin:0">Connected sources</h4>' + sourceRows +
          '<p class="text-muted" style="margin:4px 0 0;font-size:12.5px">Hound reads steps, workouts, distance, heart rate and weight. It never writes back to either platform.</p>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:14px;padding:16px;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm)">' +
          '<h4 style="margin:0">Conflicts</h4>' +
          '<p class="text-muted" style="margin:0;font-size:13px">When two sources report the same day, Hound keeps one. Pick which wins.</p>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<label class="radio" style="padding:8px 12px;border:1px solid var(--color-divider);border-radius:8px"><input type="radio" name="conflict" checked><span class="dot"></span>Highest-fidelity device</label>' +
            '<label class="radio" style="padding:8px 12px;border:1px solid var(--color-divider);border-radius:8px"><input type="radio" name="conflict"><span class="dot"></span>Apple Health first</label>' +
            '<label class="radio" style="padding:8px 12px;border:1px solid var(--color-divider);border-radius:8px"><input type="radio" name="conflict"><span class="dot"></span>Ask me each time</label>' +
          '</div>' +
          '<div class="field" style="margin:0"><label>Units</label><div class="seg"><label class="seg-opt"><input type="radio" name="units" checked><span>Miles / lb</span></label><label class="seg-opt"><input type="radio" name="units"><span>Km / kg</span></label></div></div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm)">' +
          '<h4 style="margin:0">Alerts</h4>' + alertRows +
        '</div>' +
      '</section>'
    );
  }

  function renderConnect() {
    return (
      '<section style="display:flex;flex-direction:column;gap:20px;padding-top:24px;max-width:620px;margin:0 auto;text-align:center;align-items:center">' +
        '<span style="display:grid;place-items:center;width:52px;height:52px;border-radius:16px;border:1px solid var(--color-accent);color:var(--color-accent);box-shadow:0 0 40px color-mix(in srgb, var(--color-accent) 30%, transparent)"><i class="ph-fill ph-paw-print" style="font-size:26px"></i></span>' +
        '<h2 style="margin:0;font-size:clamp(26px,4.4vw,36px)">Hound needs your health data</h2>' +
        '<p style="margin:0;font-size:15px;opacity:.78;max-width:460px;text-wrap:pretty">Connect the platform your phone already uses. Your friends connect theirs. Hound lines the numbers up so a Pixel and an iPhone can race fairly.</p>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;width:100%;text-align:left">' +
          '<div style="display:flex;flex-direction:column;gap:10px;padding:18px;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm)"><i class="ph-fill ph-apple-logo" style="font-size:24px"></i><span style="font-family:var(--font-heading);font-weight:500;font-size:16px">Apple Health</span><span class="text-muted" style="font-size:12.5px;flex:1">iPhone, Apple Watch, Withings</span><button type="button" data-act="go" data-arg="home" class="btn btn-primary btn-block" style="font-size:13px">Connect</button></div>' +
          '<div style="display:flex;flex-direction:column;gap:10px;padding:18px;border-radius:8px;background:var(--color-surface);box-shadow:var(--shadow-sm)"><i class="ph ph-android-logo" style="font-size:24px"></i><span style="font-family:var(--font-heading);font-weight:500;font-size:16px">Health Connect</span><span class="text-muted" style="font-size:12.5px;flex:1">Pixel, Samsung Health, Fitbit, Strava</span><button type="button" data-act="go" data-arg="home" class="btn btn-primary btn-block" style="font-size:13px">Connect</button></div>' +
        '</div>' +
        '<div style="width:100%;text-align:left;padding:14px 16px;border-radius:8px;background:color-mix(in srgb, var(--color-accent) 9%, transparent)"><p style="margin:0 0 6px;font-size:12.5px;color:var(--color-accent-200);font-family:var(--font-heading);font-weight:500">Read-only, five metrics</p><p style="margin:0;font-size:12.5px;line-height:1.6;color:var(--color-accent-200)">Steps · Workouts · Distance · Heart rate · Weight. Nothing else is requested, nothing is written back, and you can revoke it from your phone\'s settings at any time.</p></div>' +
        '<button type="button" data-act="go" data-arg="home" class="btn btn-ghost" style="font-size:12.5px">Skip for now</button>' +
      '</section>'
    );
  }

  function renderMain() {
    switch (state.screen) {
      case 'hunt': return renderHunt();
      case 'challenges': return renderChallenges();
      case 'create': return renderCreate();
      case 'metrics': return renderMetrics();
      case 'friends': return renderFriends();
      case 'settings': return renderSettings();
      case 'connect': return renderConnect();
      default: return renderHome();
    }
  }

  // ── Root render + event delegation ─────────────────────────────────

  var root = document.getElementById('app');

  function render() {
    var active = document.activeElement;
    var focusId = active && active.id;
    var selStart = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
    var selEnd = active && typeof active.selectionEnd === 'number' ? active.selectionEnd : null;

    root.innerHTML =
      '<div style="min-height:100vh;background:radial-gradient(1200px 520px at 12% -10%, #1d2036 0%, var(--color-bg) 60%);color:var(--color-text);font-family:var(--font-body);padding-bottom:40px">' +
        renderHeader() +
        '<main style="max-width:1120px;margin:0 auto;padding:8px clamp(16px,4vw,40px) 0">' + renderMain() + '</main>' +
      '</div>';

    if (focusId) {
      var el = document.getElementById(focusId);
      if (el) {
        el.focus();
        if (selStart !== null && el.setSelectionRange) {
          try { el.setSelectionRange(selStart, selEnd); } catch (e) { /* not a text input */ }
        }
      }
    }
  }

  function dispatch(actName, arg) {
    var fn = Actions[actName];
    if (typeof fn === 'function') fn(arg);
  }

  root.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.tagName === 'INPUT') return; // inputs handle their own events below
    dispatch(el.getAttribute('data-act'), el.getAttribute('data-arg'));
  });

  root.addEventListener('input', function (e) {
    var el = e.target.closest('input[data-act]');
    if (!el) return;
    if (el.type === 'text') dispatch(el.getAttribute('data-act'), el.value);
    else if (el.type === 'range') dispatch(el.getAttribute('data-act'), el.value);
  });

  root.addEventListener('change', function (e) {
    var el = e.target.closest('input[data-act]');
    if (!el) return;
    if (el.type === 'radio') dispatch(el.getAttribute('data-act'), el.getAttribute('data-arg'));
    else if (el.type === 'checkbox') dispatch(el.getAttribute('data-act'), el.getAttribute('data-arg'));
  });

  render();
})();
