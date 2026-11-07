var V = 'sake-log-v13';
var FILES = ['./', 'index.html', 'css/app.css?v=10', 'js/config.js?v=1', 'js/aroma.js?v=1', 'js/data.js?v=2', 'js/api.js?v=6', 'js/bg.js?v=2', 'js/viewport.js?v=4', 'js/record-cache.js?v=5', 'js/scores.js?v=1', 'js/swipe.js?v=2', 'js/app.js?v=10',
  'vendor/fuse.min.js', 'vendor/browser-image-compression.js', 'data/sakenowa.json', 'img/bg.jpg', 'icons/icon-180.png', 'manifest.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('sake-log-') === 0 && k !== V; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  var cached = caches.open(V).then(function (c) { return c.match(e.request); });
  var net = fetch(e.request).then(function (r) {
    if (!r.ok) return r;
    var copy = r.clone();
    return caches.open(V).then(function (c) { return c.put(e.request, copy); }).then(function () { return r; });
  });
  if (e.request.mode === 'navigate') {
    e.respondWith(net.catch(function () { return cached.then(function (hit) { return hit || Response.error(); }); }));
  } else {
    var refreshed = net.catch(function () { return null; });
    e.waitUntil(refreshed.then(function () {}));
    e.respondWith(cached.then(function (hit) { return hit || refreshed.then(function (r) { return r || Response.error(); }); }));
  }
});
