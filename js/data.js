(function () {
  var SN = { ready: false, updated: '', brands: [], breweries: {}, areas: {}, charts: {}, fuse: null, sorted: [[], [], [], [], [], []] };

  function kata2hira(s) { return s.replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); }); }
  var STRIP = /(純米大吟醸|純米吟醸|特別純米|特別本醸造|大吟醸|本醸造|純米|吟醸|生貯蔵酒|生原酒|生酒|原酒|生酛|山廃|無濾過|直汲み|おりがらみ|にごり|しぼりたて|ひやおろし)/g;
  function norm(s) {
    return kata2hira((s || '').normalize('NFKC').toLowerCase()).replace(STRIP, '').replace(/[\s・･\-ー―　.()（）\[\]「」『』【】]/g, '');
  }
  function normB(s) {
    return norm(s).replace(/(株式会社|合名会社|合資会社|有限会社|酒造店|酒造場|酒造|酒店|醸造|蔵元|蔵)/g, '');
  }

  SN.norm = norm;

  SN.load = function () {
    if (SN.ready) return Promise.resolve(SN);
    return fetch('data/sakenowa.json').then(function (r) { return r.json(); }).then(function (d) {
      SN.updated = d.updated;
      d.areas.forEach(function (a) { SN.areas[a[0]] = a[1]; });
      d.breweries.forEach(function (b) { SN.breweries[b[0]] = { id: b[0], name: b[1], area: SN.areas[b[2]] || '', n: normB(b[1]) }; });
      SN.brands = d.brands.map(function (b) {
        var br = SN.breweries[b[2]];
        return { id: b[0], name: b[1], n: norm(b[1]), brewery: br ? br.name : '', bn: br ? br.n : '', area: br ? br.area : '' };
      });
      SN.charts = d.charts;
      Object.keys(SN.charts).forEach(function (id) { SN.charts[id].forEach(function (v, i) { SN.sorted[i].push(v); }); });
      SN.sorted.forEach(function (a) { a.sort(function (x, y) { return x - y; }); });
      SN.fuse = new Fuse(SN.brands.filter(function (b) { return b.n; }), { keys: ['n'], includeScore: true, threshold: 0.4, ignoreLocation: true });
      SN.ready = true;
      return SN;
    });
  };

  SN.search = function (name, brewery, limit) {
    var q = norm(name), qb = normB(brewery);
    if (!q && !qb) return [];
    var map = {};
    function put(b, score) {
      var s = score;
      if (qb && b.bn && (b.bn.indexOf(qb) >= 0 || qb.indexOf(b.bn) >= 0)) s -= 0.2;
      if (!(b.id in map) || map[b.id].score > s) map[b.id] = { id: b.id, name: b.name, brewery: b.brewery, area: b.area, score: s, hasChart: !!SN.charts[b.id] };
    }
    if (q) {
      SN.brands.forEach(function (b) {
        if (b.n.length >= 2 && q.indexOf(b.n) >= 0) put(b, 0.05 + (1 - b.n.length / q.length) * 0.25);
      });
      SN.fuse.search(q, { limit: 12 }).forEach(function (r) { put(r.item, r.score); });
    } else {
      SN.brands.forEach(function (b) { if (b.bn && (b.bn.indexOf(qb) >= 0 || qb.indexOf(b.bn) >= 0)) put(b, 0.3); });
    }
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return a.score - b.score; }).slice(0, limit || 6);
  };

  SN.chart10 = function (id) {
    var c = SN.charts[id];
    if (!c) return null;
    return c.map(function (v, i) {
      var arr = SN.sorted[i], lo = 0;
      while (lo < arr.length && arr[lo] < v) lo++;
      return Math.max(1, Math.min(10, 1 + Math.round((lo / Math.max(1, arr.length - 1)) * 9)));
    });
  };
  SN.AXES = ['華やか', '芳醇', '重厚', '穏やか', 'ドライ', '軽快'];

  window.SN = SN;
})();
