var V = 'sake-log-v2';
var FILES = ['./', 'index.html', 'css/app.css?v=1', 'js/config.js?v=1', 'js/aroma.js?v=1', 'js/data.js?v=1', 'js/api.js?v=1', 'js/bg.js?v=1', 'js/app.js?v=1',
  'vendor/fuse.min.js', 'vendor/browser-image-compression.js', 'data/sakenowa.json', 'icons/icon-180.png', 'manifest.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then(function (hit) {
    var net = fetch(e.request).then(function (r) { if (r.ok) { var cp = r.clone(); caches.open(V).then(function (c) { c.put(e.request, cp); }); } return r; }).catch(function () { return hit; });
    return hit || net;
  }));
});
