(function () {
  'use strict';

  // /get: Hound on the App Store, and the Android beta.

  var ua = navigator.userAgent || '';
  var isAndroid = /android/i.test(ua);

  // Android visitors see Android first; everyone else sees iPhone first.
  if (isAndroid) {
    var platforms = document.getElementById('platforms');
    platforms.insertBefore(document.getElementById('android'), document.getElementById('iphone'));
  }

  // The App Store link is written into download.html and nothing changes
  // it. (It used to be swapped for Admin → Find people's iPhone link,
  // which still held the TestFlight beta on launch day.)
})();
