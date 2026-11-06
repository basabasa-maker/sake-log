(function () {
  var root = document.documentElement, vv = window.visualViewport, scheduled = false;
  function sync() {
    scheduled = false;
    var height = vv ? vv.height : window.innerHeight, width = vv ? vv.width : window.innerWidth;
    if (!(height > 0 && width > 0)) return;
    root.style.setProperty('--app-height', height + 'px');
    root.style.setProperty('--app-width', width + 'px');
    root.style.setProperty('--app-top', (vv ? Math.max(0, vv.offsetTop) : 0) + 'px');
    root.style.setProperty('--app-left', (vv ? Math.max(0, vv.offsetLeft) : 0) + 'px');
  }
  function queue() { if (!scheduled) { scheduled = true; requestAnimationFrame(sync); } }
  sync();
  window.addEventListener('resize', queue);
  window.addEventListener('orientationchange', queue);
  window.addEventListener('pageshow', queue);
  if (vv) { vv.addEventListener('resize', queue); vv.addEventListener('scroll', queue); }
  document.addEventListener('focusin', queue);
  document.addEventListener('focusout', queue);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) queue(); });
})();
