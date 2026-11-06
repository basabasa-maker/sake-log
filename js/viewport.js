(function () {
  // CSS owns the resting viewport; JavaScript never chooses its maximum height. visualViewport is only a
  // temporary keyboard constraint; its stale post-keyboard offsets never move
  // or permanently shorten the whole application.
  var root = document.documentElement, vv = window.visualViewport;
  var scheduled = false, settling = [], generation = 0, suspended = false;
  // Let CSS own the resting shell. Neither root.clientHeight nor innerHeight
  // can identify which side of a disagreement is stale after iOS rotation.
  // The independent dvh probe is used only to bound a temporary keyboard size.
  var heightProbe = null;
  if (typeof CSS !== 'undefined' && CSS.supports('height', '100dvh') && document.body) {
    heightProbe = document.createElement('div');
    heightProbe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100dvh;visibility:hidden;pointer-events:none';
    if (heightProbe.setAttribute) heightProbe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(heightProbe);
  }
  function referenceHeight() {
    var height = heightProbe ? Number(heightProbe.getBoundingClientRect().height) : 0;
    return isFinite(height) && height > 0 ? height : 0;
  }
  function visualWidthMatches() {
    if (!heightProbe || !vv) return false;
    var width = Number(heightProbe.getBoundingClientRect().width);
    return !(width > 0 && vv.width > 0 && Math.abs(vv.width - width) > Math.max(2, width * .02));
  }
  function editing() {
    var e = document.activeElement;
    if (!e || (e.getClientRects && !e.getClientRects().length)) return false;
    if (e.isContentEditable || e.tagName === 'TEXTAREA') return true;
    return e.tagName === 'INPUT' && ['button','submit','reset','checkbox','radio','range','file','color','hidden'].indexOf(e.type) < 0;
  }
  function recoverRoot() {
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
    if (document.hidden || suspended) return;
    var height = referenceHeight();
    // Also discard remnants of an earlier experimental/loaded height policy.
    root.style.removeProperty('--layout-height');
    root.style.removeProperty('--resting-height');
    if (height > 0 && editing() && vv && visualWidthMatches() && vv.height > 0 && vv.height < height - Math.max(80, height * .15) && !(vv.scale > 1.01)) {
      root.style.setProperty('--keyboard-height', Math.min(vv.height, height) + 'px');
    } else root.style.removeProperty('--keyboard-height');
  }
  function queue() { if (!scheduled) { scheduled = true; requestAnimationFrame(sync); } }
  function refresh() {
    var current = ++generation;
    settling.forEach(clearTimeout); settling = [];
    if (document.hidden || suspended) return;
    queue();
    // Bounded remeasurement catches iOS animation/lifecycle changes that do not
    // deliver a final resize. sync never schedules further timers itself.
    [80, 220, 500].forEach(function (delay) { settling.push(setTimeout(function () { if (current !== generation || document.hidden || suspended) return; sync(); recoverRoot(); }, delay)); });
  }
  window.AppViewport = { refresh: refresh };
  sync(); refresh();
  ['resize','orientationchange'].forEach(function (n) { window.addEventListener(n, refresh); });
  window.addEventListener('pagehide', function () { suspended = true; generation++; settling.forEach(clearTimeout); settling = []; });
  window.addEventListener('pageshow', function () { suspended = false; refresh(); });
  if (vv) { vv.addEventListener('resize', refresh); vv.addEventListener('scroll', refresh); }
  document.addEventListener('focusin', refresh);
  document.addEventListener('focusout', refresh);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { generation++; settling.forEach(clearTimeout); settling = []; }
    else { suspended = false; refresh(); }
  });
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
      return { top: Math.round(r.top * 10) / 10, bottom: Math.round(r.bottom * 10) / 10, height: Math.round(r.height * 10) / 10, computedHeight: cs.height, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom };
    }
    var assets = [];
    Array.prototype.forEach.call(document.querySelectorAll('script[src],link[rel="stylesheet"]'), function (el) {
      var match = (el.getAttribute('src') || el.getAttribute('href') || '').match(/^(?:js|css)\/([a-z.-]+)\?v=(\d+)$/);
      if (match) assets.push(match[1] + ':' + match[2]);
    });
    return { mode: window.navigator && window.navigator.standalone || window.matchMedia && window.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser',
      window: { width: window.innerWidth, height: window.innerHeight }, dvh: dvh,
      visual: vv ? { width: vv.width, height: vv.height, offsetTop: vv.offsetTop, offsetLeft: vv.offsetLeft, scale: vv.scale } : null,
      scrollY: window.scrollY, layout: { rootHeight: root.clientHeight || 0, referenceHeight: referenceHeight(), editableActive: editing(), dvhSupported: typeof CSS !== 'undefined' && CSS.supports('height','100dvh'), resting: root.style.getPropertyValue ? root.style.getPropertyValue('--resting-height') : '', keyboard: root.style.getPropertyValue ? root.style.getPropertyValue('--keyboard-height') : '', fallback: root.style.getPropertyValue ? root.style.getPropertyValue('--layout-height') : '' }, main: rect('#main'), body: rect('body'), header: rect('#hdr'), logo: rect('#hdr .logo'), tabs: rect('#tabs'), safe: safe, assets: assets };
  }
  function diagnosticText() {
    var d = measureLayout();
    return ['mode: ' + d.mode, 'window: ' + d.window.width + 'x' + d.window.height + ' / dvh: ' + d.dvh,
      'visual: ' + JSON.stringify(d.visual), 'scrollY: ' + d.scrollY,
      'layout: ' + JSON.stringify(d.layout), 'main: ' + JSON.stringify(d.main), 'body: ' + JSON.stringify(d.body), 'header: ' + JSON.stringify(d.header), 'logo: ' + JSON.stringify(d.logo),
      'tabs: ' + JSON.stringify(d.tabs), 'safe: ' + JSON.stringify(d.safe), 'assets: ' + d.assets.join(', ')].join('\n');
  }
  window.LayoutMetrics = { snapshot: measureLayout, text: diagnosticText };
})();
