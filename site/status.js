// The status file (status.json): when Hound's server is down for
// maintenance, a notice across the top of the home page. The app reads
// the same file when it can't reach the server (mobile/src/maintenance).
(function () {
  fetch('/status.json?t=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (s) {
      if (!s || s.maintenance !== true) return;
      var until = s.until ? new Date(s.until) : null;
      var back = until && !isNaN(until.getTime()) && until.getTime() > Date.now()
        ? ' Back by about ' + until.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ', usually sooner.'
        : ' Back soon.';
      var bar = document.createElement('div');
      bar.setAttribute('role', 'status');
      bar.style.cssText = 'background:#3a2f17;color:#f6e7c4;border-bottom:1px solid #e0a94f;padding:12px 16px;text-align:center;font:500 15px/1.4 Inter,system-ui,sans-serif';
      var b = document.createElement('b');
      b.textContent = 'Hound is getting a tune-up. ';
      bar.appendChild(b);
      bar.appendChild(document.createTextNode((s.message ? s.message + ' ' : '') + back.trim() + ' Your steps still count.'));
      document.body.insertBefore(bar, document.body.firstChild);
    })
    .catch(function () {});
})();
