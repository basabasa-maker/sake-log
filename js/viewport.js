(function () {
  // The resting app follows CSS's dynamic viewport. visualViewport is only a
  // temporary keyboard constraint; its stale post-keyboard offsets never move
  // or permanently shorten the whole application.
  var root = document.documentElement, vv = window.visualViewport;
  var scheduled = false, recovery = null;
  function editing() {
    var e = document.activeElement;
    if (!e || (e.getClientRects && !e.getClientRects().length)) return false;
    if (e.isContentEditable || e.tagName === 'TEXTAREA') return true;
    return e.tagName === 'INPUT' && ['button','submit','reset','checkbox','radio','range','file','color','hidden'].indexOf(e.type) < 0;
  }
  function recoverRoot() {
    recovery = null;
    if (editing() || document.hidden || (vv && vv.scale > 1.01)) return;
    var scrolling = document.scrollingElement;
    if (window.scrollY || window.scrollX || (scrolling && (scrolling.scrollTop || scrolling.scrollLeft))) {
      // Only the document's accidental keyboard pan is reset. #main owns the
      // record scroll and must retain its position.
      var main = document.querySelector('#main'), y = main && main.scrollTop;
      window.scrollTo(0, 0);
      if (main && main.scrollTop !== y) main.scrollTop = y;
    }
  }
  function sync() {
    scheduled = false;
    if (window.innerHeight > 0) root.style.setProperty('--layout-height', window.innerHeight + 'px');
    if (editing() && vv && vv.height > 0 && vv.height < window.innerHeight - 80 && !(vv.scale > 1.01)) {
      root.style.setProperty('--keyboard-height', vv.height + 'px');
    } else {
      root.style.removeProperty('--keyboard-height');
    }
    if (recovery !== null) clearTimeout(recovery);
    recovery = editing() ? null : setTimeout(recoverRoot, 220);
  }
  function queue() { if (!scheduled) { scheduled = true; requestAnimationFrame(sync); } }
  sync();
  ['resize','orientationchange','pageshow'].forEach(function (n) { window.addEventListener(n, queue); });
  if (vv) { vv.addEventListener('resize', queue); vv.addEventListener('scroll', queue); }
  document.addEventListener('focusin', queue);
  document.addEventListener('focusout', queue);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) queue(); });
  // Explicitly opened, geometry-only diagnostics. No storage or network reads.
  function measureLayout() {
    var probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;top:0;left:0;width:0;height:100dvh;padding:var(--safe-top) var(--safe-right) var(--safe-bottom) var(--safe-left);visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
    var style = getComputedStyle(probe), dvh = probe.getBoundingClientRect().height;
    var safe = { top: style.paddingTop, right: style.paddingRight, bottom: style.paddingBottom, left: style.paddingLeft };
    probe.remove();
    function rect(selector) {
      var el = document.querySelector(selector); if (!el) return null;
      var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, height: Math.round(r.height * 10) / 10, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom };
    }
    var assets = [];
    Array.prototype.forEach.call(document.querySelectorAll('script[src],link[rel="stylesheet"]'), function (el) {
      var match = (el.getAttribute('src') || el.getAttribute('href') || '').match(/^(?:js|css)\/([a-z.-]+)\?v=(\d+)$/);
      if (match) assets.push(match[1] + ':' + match[2]);
    });
    return { mode: window.navigator && window.navigator.standalone || window.matchMedia && window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
      window: { width: window.innerWidth, height: window.innerHeight }, dvh: dvh,
      visual: vv ? { width: vv.width, height: vv.height, offsetTop: vv.offsetTop, offsetLeft: vv.offsetLeft, scale: vv.scale } : null,
      scrollY: window.scrollY, body: rect('body'), header: rect('#hdr'), logo: rect('#hdr .logo'), tabs: rect('#tabs'), safe: safe, assets: assets };
  }
  function diagnosticText() {
    var d = measureLayout();
    return ['mode: ' + d.mode, 'window: ' + d.window.width + 'x' + d.window.height + ' / dvh: ' + d.dvh,
      'visual: ' + JSON.stringify(d.visual), 'scrollY: ' + d.scrollY,
      'body: ' + JSON.stringify(d.body), 'header: ' + JSON.stringify(d.header), 'logo: ' + JSON.stringify(d.logo),
      'tabs: ' + JSON.stringify(d.tabs), 'safe: ' + JSON.stringify(d.safe), 'assets: ' + d.assets.join(', ')].join('\n');
  }
  window.LayoutMetrics = { snapshot: measureLayout, text: diagnosticText };
})();
