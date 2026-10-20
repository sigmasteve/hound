(function () {
  'use strict';

  // /get: the iPhone beta (TestFlight) and the Android APK.

  var ua = navigator.userAgent || '';
  var isAndroid = /android/i.test(ua);

  // Android visitors see Android first; everyone else sees iPhone first.
  if (isAndroid) {
    var platforms = document.getElementById('platforms');
    platforms.insertBefore(document.getElementById('android'), document.getElementById('iphone'));
  }

  // The TestFlight button's link is written into download.html. If Admin →
  // Find people has a different one (beta_download_links,
  // 0080_friend_discovery.sql, the same place the friend invite page f.js
  // reads it), use that instead.
  var cfg = window.HOUND_CONFIG || {};
  if (!window.supabase || !cfg.supabaseUrl || !cfg.supabasePublishableKey) return;
  var client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey);
  client.rpc('beta_download_links')
    .then(function (res) {
      var url = res.data && res.data[0] && res.data[0].ios_url;
      if (res.error || !url || !/^https:\/\//i.test(url)) return;
      document.querySelector('#ios-cta a').href = url;
    })
    .catch(function () {});
})();
