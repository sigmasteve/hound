(function () {
  'use strict';

  // Opening Hound from an invite page (/c/<code>, /f/<code>), including
  // from inside another app's browser. Messenger, Facebook, Instagram and
  // the like open links in their own browser, which ignores Hound's app
  // links and won't follow a hound:// button, so the page got stuck.
  //   Android: an intent:// link opens Hound even from those browsers,
  //            and the download page when it isn't installed.
  //   iPhone:  in-app browsers never open other apps. The page offers
  //            "Open in Safari" (x-safari-https://, iOS 17 and later),
  //            where Open in Hound works, with the steps to do it by hand.

  var ua = navigator.userAgent || '';
  var isAndroid = /android/i.test(ua);
  var isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // Which app's browser this is, if any.
  function inAppName() {
    if (/FBAN\/Messenger|MessengerForiOS|Orca-Android|MessengerLite/i.test(ua)) return 'Messenger';
    if (/Instagram/i.test(ua)) return 'Instagram';
    if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua)) return 'Facebook';
    if (/Snapchat/i.test(ua)) return 'Snapchat';
    if (/TikTok|musical_ly|BytedanceWebview/i.test(ua)) return 'TikTok';
    if (/LinkedInApp/i.test(ua)) return 'LinkedIn';
    if (/\bLine\//i.test(ua)) return 'LINE';
    if (/Twitter/i.test(ua)) return 'X';
    return null;
  }

  var inApp = inAppName();

  // The Open in Hound link for a path like "c/Z5CKD7".
  function appHref(path) {
    if (isAndroid) {
      return 'intent://' + path + '#Intent;scheme=hound;package=app.hound.mobile;S.browser_fallback_url=' +
        encodeURIComponent(location.origin + '/get') + ';end';
    }
    return 'hound://' + path;
  }

  // Shown above Open in Hound inside an iPhone app's browser: open the
  // page in Safari, or the steps to.
  function iosInAppHtml() {
    if (!inApp || !isIOS) return '';
    var safari = 'x-safari-' + location.href.replace(/"/g, '%22');
    return (
      '<div class="inapp">' +
        '<p class="section-sub" style="margin:0 0 10px"><b>' + inApp + ' can’t open apps.</b> Open this page in Safari, then tap Open in Hound there.</p>' +
        '<p style="margin:0 0 10px"><a class="btn btn-primary btn-block" href="' + safari + '">Open in Safari</a></p>' +
        '<p class="section-sub" style="margin:0 0 10px">Nothing happened? Tap <b>•••</b> at the top right, then <b>Open in Safari</b> (or <b>Open in external browser</b>).</p>' +
        '<div class="linkbox"><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px">' +
          location.host + location.pathname + '</span><button class="copy-btn" id="copy-link">Copy link</button></div>' +
      '</div>'
    );
  }

  // Wires the Copy link button, if it's on the page.
  function wireCopyLink() {
    var btn = document.getElementById('copy-link');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(location.href).then(function () {
          btn.textContent = 'Copied!';
          setTimeout(function () { btn.textContent = 'Copy link'; }, 2000);
        }).catch(function () {});
      }
    });
  }

  window.HoundOpen = {
    inApp: inApp,
    isIOS: isIOS,
    isAndroid: isAndroid,
    appHref: appHref,
    iosInAppHtml: iosInAppHtml,
    wireCopyLink: wireCopyLink,
    // Inside an iPhone app's browser, Open in Hound can't work: it's
    // shown as a second choice, after Open in Safari.
    stuck: !!inApp && isIOS,
  };
})();
