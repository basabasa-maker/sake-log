(function () {
  var cv = document.getElementById('petals');
  if (!cv || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var cx = cv.getContext('2d'), W = 0, H = 0, ps = [], dpr = Math.min(window.devicePixelRatio || 1, 2), run = true;

  function size() {
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function mk(top) {
    return { x: Math.random() * W, y: top ? -10 : Math.random() * H, s: 4 + Math.random() * 4, vy: 10 + Math.random() * 14,
      sw: 10 + Math.random() * 18, ph: Math.random() * 6.28, r: Math.random() * 6.28, vr: (Math.random() - .5) * 1.2, a: .35 + Math.random() * .35 };
  }
  size();
  for (var i = 0; i < 14; i++) ps.push(mk(false));
  window.addEventListener('resize', size);
  document.addEventListener('visibilitychange', function () { run = !document.hidden; if (run) { last = 0; requestAnimationFrame(tick); } });

  var last = 0;
  function tick(t) {
    if (!run) return;
    var dt = last ? Math.min((t - last) / 1000, .1) : 0;
    last = t;
    cx.clearRect(0, 0, W, H);
    ps.forEach(function (p, i) {
      p.y += p.vy * dt; p.ph += dt * .8; p.r += p.vr * dt;
      var x = p.x + Math.sin(p.ph) * p.sw;
      if (p.y > H + 10) ps[i] = mk(true);
      cx.save(); cx.translate(x, p.y); cx.rotate(p.r); cx.globalAlpha = p.a; cx.fillStyle = '#d9bcc3';
      cx.beginPath(); cx.ellipse(0, 0, p.s, p.s * .6, 0, 0, 6.2832); cx.fill(); cx.restore();
    });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
