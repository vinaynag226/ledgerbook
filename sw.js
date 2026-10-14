/* LedgerBook service worker — whole app works offline after the first open. */
var CACHE = 'ledgerbook-2.0.6';
var FILES = [
  './', 'index.html', 'app.css', 'core.js', 'app.js', 'firebase.bundle.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  'fonts/sans-400.woff2', 'fonts/sans-500.woff2', 'fonts/sans-600.woff2', 'fonts/sans-700.woff2',
  'fonts/mono-400.woff2', 'fonts/mono-500.woff2', 'fonts/mono-600.woff2'
];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    // Only remove old LedgerBook caches. Other apps on the same github.io address keep theirs.
    return Promise.all(keys.filter(function (k) { return k.indexOf('ledgerbook-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// App code (pages, scripts, styles): fresh from the network first, so updates show on the next open.
// Falls back to the saved copy when offline or if the network takes more than 3 seconds.
// Fonts and icons: saved copy first (they never change between versions).
function fromCache(req) { return caches.open(CACHE).then(function (c) { return c.match(req, { ignoreSearch: true }); }); }
function save(req, res) { if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); } return res; }
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // Firebase traffic goes straight to the network
  var stat = /\.(woff2|png)$/.test(url.pathname);
  if (stat) {
    e.respondWith(fromCache(req).then(function (hit) { return hit || fetch(req).then(function (res) { return save(req, res); }); }));
    return;
  }
  // If another app on the same address cleared our saved copy, quietly restore every file
  if (req.mode === 'navigate') e.waitUntil(caches.open(CACHE).then(function (c) { return c.keys().then(function (k) { if (k.length < FILES.length) return c.addAll(FILES).catch(function () { }); }); }));
  e.respondWith(new Promise(function (resolve) {
    var done = false;
    function finish(r) { if (!done && r) { done = true; resolve(r); } }
    var timer = setTimeout(function () { fromCache(req).then(finish); }, 3000);
    fetch(req, { cache: 'no-cache' }).then(function (res) { clearTimeout(timer); save(req, res); finish(res); })
      .catch(function () { clearTimeout(timer); fromCache(req).then(function (hit) { finish(hit || Response.error()); }); });
  }));
});
