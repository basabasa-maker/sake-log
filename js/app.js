(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  var PARAMS = [['aroma', '香り強さ'], ['attack', 'アタック'], ['sweet', '甘味'], ['acid', '酸味'], ['bitter', '苦味'], ['umami', 'うま味'], ['body', 'ボディ'], ['finish', '余韻']];
  var GRADES = ['純米大吟醸', '大吟醸', '純米吟醸', '吟醸', '特別純米', '純米', '特別本醸造', '本醸造', '普通酒', '不明'];
  var COLORS = ['無色透明', '淡い黄緑', '淡い黄色', '黄金色', '山吹色', '琥珀色'];
  var CLARITY = ['澄んだ', 'やや霞んだ', '霞んだ'];
  var VISC = ['さらっと', 'やや粘性あり', '粘性あり'];
  var SSI4 = ['薫酒', '爽酒', '醇酒', '熟酒'];

  var D = newDraft();
  var view = 'reg';
  var records = [];
  var listRequest = 0;
  var savePending = false;
  var openCat = null;

  function newDraft() {
    return { started: false, row: null, recordId: '', sourceSheetId: '', sourceVersion: '', date: today(), place: '', memo: '', brand: '', brewery: '', area: '', grade: '', method: '', rice: '', polish: '',
      brandId: null, scores: {}, gen: {}, fixed: {}, aroma: { sel: [], ai: [], custom: [] }, ssi4: '', color: '', clarity: '', viscosity: '', rating: '',
      photos: { bottle: null, label: null }, thumb: '', bottleUrl: '', labelUrl: '', chart: null, scale: 10 };
  }

  /* ---------- 画面切り替え ---------- */
  function show(v) {
    view = v;
    ['reg', 'res', 'list'].forEach(function (k) { $('#v-' + k).hidden = k !== v; });
    $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
    $('#main').scrollTop = 0;
    if (v === 'list') loadList();
    if (v === 'res') renderResult();
  }
  $$('#tabs button').forEach(function (b) { b.onclick = function () { show(b.dataset.v); }; });

  function busy(msg) { if (msg) { $('#busy-msg').textContent = msg; $('#busy').hidden = false; } else { $('#busy').hidden = true; } }
  function modal(title, html) { $('#modal-title').textContent = title; $('#modal-content').innerHTML = html; $('#modal').hidden = false; }
  $('#modal-close').onclick = function () { $('#modal').hidden = true; };

  /* ---------- 料金表示 ---------- */
  function yen(n) { return '¥' + (n < 100 ? Math.round(n * 10) / 10 : Math.round(n)).toLocaleString('ja-JP'); }
  API.onCost(function (t) { $('#cost-total').textContent = yen(t); });
  function loadCost() { if (API.configured()) API.call('cost').catch(function () { $('#cost-total').textContent = '—'; }); }

  /* ---------- 写真 ---------- */
  function readAsDataURL(file) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(file); });
  }
  function processPhoto(slot, file) {
    var opt = { maxSizeMB: 0.45, maxWidthOrHeight: 1280, useWebWorker: false, fileType: 'image/jpeg', initialQuality: 0.8 };
    return imageCompression(file, opt).then(function (f) {
      return Promise.all([readAsDataURL(f), slot === 'bottle' ? imageCompression(file, { maxSizeMB: 0.02, maxWidthOrHeight: 220, useWebWorker: false, fileType: 'image/jpeg' }).then(readAsDataURL) : null]);
    }).then(function (r) {
      D.photos[slot] = { url: r[0], b64: r[0].split(',')[1] };
      if (slot === 'bottle') D.thumb = r[1];
      var box = $('.slot[data-slot="' + slot + '"] .box');
      box.classList.add('has'); $('img', box).src = r[0];
    });
  }
  $$('.slot').forEach(function (s) {
    $$('input[type=file]', s).forEach(function (inp) {
      inp.onchange = function () {
        var f = inp.files && inp.files[0]; inp.value = '';
        if (!f) return;
        busy('写真を縮小中…');
        processPhoto(s.dataset.slot, f).catch(function () { showRegErr('写真を取り込めませんでした'); }).then(function () { busy(); });
      };
    });
  });
  function showRegErr(m) { var e = $('#reg-err'); e.textContent = m; e.hidden = !m; }

  /* ---------- 読み取り ---------- */
  $('#btn-read').onclick = function () {
    showRegErr('');
    if (!D.photos.label && !D.photos.bottle) { showRegErr('ラベルか瓶の写真を入れてください'); return; }
    if (!API.configured()) { showRegErr('設定でGASのURLと合言葉を入れてください'); return; }
    var photos = {};
    if (D.photos.label) photos.label = D.photos.label.b64;
    if (D.photos.bottle) photos.bottle = D.photos.bottle.b64;
    var keep = { photos: D.photos, thumb: D.thumb, memo: D.memo, date: D.date, place: D.place };
    var nd = newDraft(); Object.assign(nd, keep); D = nd; D.started = true;
    busy('ラベルを読み取り中…');
    SN.load().then(function () { return API.call('read', { photos: photos }); }).then(function (r) {
      var f = r.fields || {};
      D.brand = f.brand || ''; D.brewery = f.brewery || ''; D.area = f.prefecture || ''; D.grade = f.grade || ''; D.method = f.method || ''; D.rice = f.rice || ''; D.polish = f.polish || '';
      var c = SN.search(D.brand, D.brewery, 6);
      var best = c[0];
      if (best && best.score < 0.3) applyBrand(best, false);
      busy('味を推定中…');
      return estimate().then(function () { return c; });
    }).then(function (c) {
      busy(); show('res');
      if (!D.brandId) pickBrand(c);
    }).catch(function (e) {
      busy(); showRegErr('読み取れませんでした: ' + e.message);
    });
  };
  $('#btn-manual').onclick = function () {
    var keep = { photos: D.photos, thumb: D.thumb, memo: D.memo }; D = newDraft(); Object.assign(D, keep); D.started = true;
    SN.load(); show('res');
  };

  function estimate() {
    var chart = D.brandId ? SN.chart10(D.brandId) : null;
    return API.call('estimate', { info: { brand: D.brand, brewery: D.brewery, grade: D.grade, method: D.method, rice: D.rice, polish: D.polish, chart: chart } }).then(function (r) {
      D.scores = Object.assign({}, r.scores); D.gen = Object.assign({}, r.scores); D.fixed = {};
      D.aroma.ai = r.aroma || []; if (!D.ssi4 && r.ssi4) D.ssi4 = r.ssi4;
    });
  }

  /* ---------- 銘柄の一致 ---------- */
  function applyBrand(b, overwrite) {
    D.brandId = b.id; D.chart = SN.chart10(b.id);
    if (overwrite || !D.brewery) D.brewery = b.brewery || D.brewery;
    if (overwrite || !D.area) D.area = b.area || D.area;
  }
  function pickBrand(list) {
    var html = '<input id="pq" type="search" placeholder="銘柄名で探す" style="width:100%;margin-bottom:10px;background:#1a1f2b;border:.5px solid #3a4258;border-radius:10px;padding:9px 12px;color:#e9e6dc"><div id="pl"></div><button class="cand" data-none="1" type="button">該当なし（AI推定のみ）</button>';
    modal('銘柄を選ぶ', html);
    var draw = function (l) {
      $('#pl').innerHTML = l.map(function (b, i) { return '<button class="cand" data-i="' + i + '" type="button">' + esc(b.name) + '<small>' + esc(b.brewery) + (b.area ? ' ／ ' + esc(b.area) : '') + (b.hasChart ? '' : ' ／ チャートなし') + '</small></button>'; }).join('') || '<div class="note">候補がありません</div>';
      $$('#pl .cand').forEach(function (el) { el.onclick = function () { applyBrand(l[+el.dataset.i], true); $('#modal').hidden = true; renderResult(); }; });
    };
    draw(list || SN.search(D.brand, D.brewery, 6));
    $('#pq').oninput = function () { draw(SN.search(this.value, '', 8)); };
    $('[data-none]').onclick = function () { D.brandId = null; D.chart = null; $('#modal').hidden = true; renderResult(); };
  }
  $('#btn-pick').onclick = function () { SN.load().then(function () { pickBrand(); }); };
  $('#btn-reest').onclick = function () {
    busy('味を推定中…');
    estimate().then(function () { busy(); renderResult(); }).catch(function (e) { busy(); $('#save-msg').textContent = '推定できませんでした: ' + e.message; });
  };

  /* ---------- 結果画面 ---------- */
  function renderResult() {
    if (!D.started) { $('#r-name').textContent = '写真を読み取るか、一覧から選んでください'; return; }
    renderHead(); renderBasic(); renderRadar(); renderParams(); renderLooks(); renderAroma();
    $$('.memo').forEach(function (m) { m.value = D.memo; });
  }
  function renderHead() {
    $('#r-name').textContent = D.brand || '（銘柄名なし）';
    $('#r-sub').textContent = [D.brewery, D.area, D.grade].filter(Boolean).join(' ／ ');
    var m = D.brandId ? 'さけのわ: ' + (SN.brands.filter(function (b) { return b.id === D.brandId; })[0] || {}).name + '（一致）' : 'さけのわに該当なし（AI推定のみ）';
    $('#r-match').textContent = m;
    var th = $('.head .thumb'), src = (D.photos.bottle && D.photos.bottle.url) || D.thumb || '';
    th.classList.toggle('has', !!src); $('img', th).src = src;
    $('#r-photos').innerHTML = [['瓶の写真を開く', D.bottleUrl], ['ラベル写真を開く', D.labelUrl]].filter(function (p) {
      return /^https?:\/\//i.test(p[1] || '');
    }).map(function (p) { return '<a href="' + esc(p[1]) + '" target="_blank" rel="noopener noreferrer">' + p[0] + '</a>'; }).join(' ／ ');
  }
  var BASIC = [['date', '日付', 'date'], ['brand', '銘柄名'], ['brewery', '蔵元'], ['area', '産地'], ['grade', '特定名称'], ['method', '製法'], ['rice', '使用米'], ['polish', '精米歩合'], ['place', '飲んだ場所']];
  function renderBasic() {
    $('#basic-form').innerHTML = BASIC.map(function (f) {
      return '<label>' + f[1] + '<input data-k="' + f[0] + '" type="' + (f[2] || 'text') + '" value="' + esc(D[f[0]]) + '"' + (f[0] === 'grade' ? ' list="grades"' : '') + '></label>';
    }).join('') + '<datalist id="grades">' + GRADES.map(function (g) { return '<option value="' + g + '">'; }).join('') + '</datalist>';
    $$('#basic-form input').forEach(function (i) { i.oninput = function () { D[i.dataset.k] = i.value; renderHead(); }; });
  }
  function renderRadar() {
    var el = $('#r-radar');
    if (!D.chart) { el.innerHTML = '<div class="note">さけのわにこの銘柄のチャートがありません。</div>'; return; }
    var cx = 125, cy = 105, R = 70, out = '';
    var pt = function (i, r) { var a = -Math.PI / 2 + i * Math.PI / 3; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
    [0.33, 0.66, 1].forEach(function (k) { out += '<polygon points="' + SN.AXES.map(function (_, i) { return pt(i, R * k).map(Math.round).join(','); }).join(' ') + '" fill="none" stroke="#3a4258" stroke-width="0.5"/>'; });
    out += '<polygon points="' + D.chart.map(function (v, i) { return pt(i, R * v / 10).map(Math.round).join(','); }).join(' ') + '" fill="rgba(201,169,106,.3)" stroke="#c9a96a" stroke-width="1.5"/>';
    SN.AXES.forEach(function (t, i) { var p = pt(i, R + 22); out += '<text x="' + Math.round(p[0]) + '" y="' + Math.round(p[1] + 4) + '" text-anchor="middle" font-size="12" fill="#a7a596">' + t + ' ' + D.chart[i] + '</text>'; });
    el.innerHTML = '<svg viewBox="0 0 250 210" style="width:100%;max-width:300px;display:block;margin:0 auto" role="img" aria-label="フレーバーチャート">' + out + '</svg>';
  }
  function renderParams() {
    var el = $('#r-params'); el.innerHTML = '';
    PARAMS.forEach(function (p) {
      var k = p[0], v = D.scores[k], has = v != null, g = D.gen[k];
      var d = document.createElement('div');
      d.innerHTML = '<div class="prow"><span class="n">' + p[1] + '</span><div class="rng"><input type="range" min="1" max="10" step="1" value="' + (has ? v : 5) + '" aria-label="' + p[1] + '">' +
        (g != null ? '<i class="mk" style="left:calc(9px + (100% - 18px) * ' + ((g - 1) / 9) + ' - 1px)"></i>' : '') +
        '</div><span class="v">' + (has ? v : '—') + '</span><span class="tag"></span></div>';
      var r = $('input', d), vv = $('.v', d), t = $('.tag', d);
      var tag = function () { var s = D.fixed[k] ? '確定' : (D.scores[k] != null ? '推定' : '未'); t.textContent = s; t.className = 'tag' + (s === '確定' ? ' fix' : ''); };
      tag();
      r.oninput = function () { D.scores[k] = +r.value; vv.textContent = r.value; D.fixed[k] = D.gen[k] == null ? true : +r.value !== D.gen[k]; tag(); };
      el.appendChild(d);
    });
  }
  function sel(id, key, opts) {
    var list = opts.slice(); if (D[key] && list.indexOf(D[key]) < 0) list.push(D[key]);
    return '<label>' + id + '<select data-k="' + key + '"><option value="">—</option>' + list.map(function (o) { return '<option' + (D[key] === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></label>';
  }
  function renderLooks() {
    var n = (D.rating || '').length;
    $('#r-looks').innerHTML = sel('色調', 'color', COLORS) + sel('透明度', 'clarity', CLARITY) + sel('粘性', 'viscosity', VISC) + sel('SSI4タイプ', 'ssi4', SSI4) +
      '<label>総合評価<div class="rate">' + [1, 2, 3, 4, 5].map(function (i) { return '<button type="button" data-r="' + i + '" class="' + (i <= n ? 'on' : '') + '">★</button>'; }).join('') + '</div></label>';
    $$('#r-looks select').forEach(function (s) { s.onchange = function () { D[s.dataset.k] = s.value; }; });
    $$('#r-looks .rate button').forEach(function (b) { b.onclick = function () { var i = +b.dataset.r; D.rating = i === n ? '' : '★★★★★'.slice(0, i); renderLooks(); }; });
  }

  /* ---------- 香り（二段階） ---------- */
  function catItems(c) { return AROMA[c].concat(D.aroma.custom.filter(function (x) { return x.c === c; }).map(function (x) { return x.n; })); }
  function cnt(c) { return catItems(c).filter(function (x) { return D.aroma.sel.indexOf(x) >= 0; }).length; }
  function renderAroma() {
    var A = D.aroma, cand = A.ai.filter(function (x) { return A.sel.indexOf(x) < 0; });
    $('#a-sum').innerHTML = '確定: ' + (A.sel.length ? esc(A.sel.join('、')) : 'なし') + (cand.length ? '<br><span class="ai">AI候補: ' + esc(cand.join('、')) + '</span>' : '');
    var cats = $('#a-cats'); cats.innerHTML = '';
    Object.keys(AROMA).forEach(function (c) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'cat' + (openCat === c ? ' on' : '');
      b.innerHTML = esc(c) + (cnt(c) ? '<em>' + cnt(c) + '</em>' : '');
      b.onclick = function () { openCat = openCat === c ? null : c; renderAroma(); };
      cats.appendChild(b);
    });
    var ch = $('#a-chips');
    if (!openCat) { ch.hidden = true; return; }
    ch.hidden = false; ch.innerHTML = '';
    catItems(openCat).forEach(function (x) {
      var b = document.createElement('button'); b.type = 'button';
      b.className = 'chip' + (A.sel.indexOf(x) >= 0 ? ' sel' : (A.ai.indexOf(x) >= 0 ? ' ai' : '')); b.textContent = x;
      b.onclick = function () { var i = A.sel.indexOf(x); if (i >= 0) A.sel.splice(i, 1); else A.sel.push(x); renderAroma(); };
      ch.appendChild(b);
    });
    var inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = '自由入力して追加'; inp.enterKeyHint = 'done';
    inp.onkeydown = function (e) {
      if (e.key !== 'Enter') return; e.preventDefault();
      var v = inp.value.trim(); if (!v) return;
      if (catItems(openCat).indexOf(v) < 0) A.custom.push({ n: v, c: openCat });
      if (A.sel.indexOf(v) < 0) A.sel.push(v);
      renderAroma();
    };
    ch.appendChild(inp);
  }

  /* ---------- メモ（登録と結果で共通） ---------- */
  $$('.memo').forEach(function (m) { m.oninput = function () { D.memo = m.value; $$('.memo').forEach(function (o) { if (o !== m) o.value = D.memo; }); }; });

  /* ---------- 保存 ---------- */
  $('#btn-save').onclick = function () {
    if (savePending) return;
    if (!D.brand) { $('#save-msg').textContent = '銘柄名を入れてください'; return; }
    if (!API.configured()) { $('#save-msg').textContent = '設定でGASのURLと合言葉を入れてください'; return; }
    var A = D.aroma, types = Object.keys(AROMA).filter(function (c) { return cnt(c) > 0; });
    var rec = { row: D.row, recordId: D.recordId, sourceSheetId: D.sourceSheetId, sourceVersion: D.sourceVersion, date: D.date, brand: D.brand, brewery: D.brewery, area: D.area, grade: D.grade, method: D.method, rice: D.rice, polish: D.polish, place: D.place,
      color: D.color, clarity: D.clarity, viscosity: D.viscosity, ssi4: D.ssi4, rating: D.rating, memo: D.memo, brandId: D.brandId || '',
      scores: D.scores, fixed: Object.keys(D.fixed).filter(function (k) { return D.fixed[k]; }), estimates: D.gen,
      aromaType: types.join('、'), aromaDetail: A.sel.join('、'), scale: 10 };
    var photos = {};
    if (D.photos.bottle) { photos.bottle = D.photos.bottle.b64; rec.thumb = D.thumb; }
    if (D.photos.label) photos.label = D.photos.label.b64;
    var draft = D;
    savePending = true;
    busy('保存中…'); $('#save-msg').textContent = '';
    API.call('save', { record: rec, photos: photos }).then(function (r) {
      draft.row = r.row; draft.recordId = r.recordId; savePending = false; busy();
      draft.sourceSheetId = r.sourceSheetId || ''; draft.sourceVersion = r.sourceVersion || '';
      if (D === draft) $('#save-msg').textContent = '保存しました';
    }).catch(function (e) { savePending = false; busy(); if (D === draft) $('#save-msg').textContent = '保存できませんでした: ' + e.message; });
  };

  /* ---------- 一覧 ---------- */
  var OLD = { 1: 2, 2: 5, 3: 8 }, OLDF = { '短い': 3, 'やや短い': 4, '中程度': 5, 'やや長い': 6, '長い': 9 };
  function fromServer(r) {
    var d = newDraft(); d.started = true;
    ['row', 'recordId', 'sourceSheetId', 'sourceVersion', 'date', 'place', 'memo', 'brand', 'brewery', 'area', 'grade', 'method', 'rice', 'polish', 'ssi4', 'color', 'clarity', 'viscosity', 'rating', 'thumb', 'bottleUrl', 'labelUrl'].forEach(function (k) { if (r[k] != null) d[k] = r[k]; });
    d.brandId = r.brandId ? +r.brandId : null; d.scale = r.scale || 3;
    var old = +d.scale !== 10, sc = r.scores || {};
    PARAMS.forEach(function (p) {
      var v = sc[p[0]]; if (v === '' || v == null) return;
      if (old) v = p[0] === 'finish' && typeof v === 'string' ? OLDF[v] : OLD[+v];
      if (v != null && !isNaN(v)) { d.scores[p[0]] = +v; d.fixed[p[0]] = true; }
    });
    d.gen = r.estimates || {};
    (r.fixed || []).forEach(function (k) { d.fixed[k] = true; });
    var det = (r.aromaDetail || '').split(/[、,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    d.aroma.sel = det; det.forEach(function (x) { if (AROMA_ALL.indexOf(x) < 0) d.aroma.custom.push({ n: x, c: 'ミネラル・他' }); });
    return d;
  }
  function loadList() {
    var request = ++listRequest;
    // Old sl_list caches have no trustworthy source identity. Leave them untouched.
    if (!API.configured()) { $('#l-count').textContent = '設定でGASのURLと合言葉を入れてください'; return; }
    $('#l-count').textContent = '記録を取得中…';
    API.call('list').then(function (r) { if (request !== listRequest) return; records = r.records || []; drawList(); })
      .catch(function (e) { if (request === listRequest) $('#l-count').textContent = '一覧を取得できませんでした: ' + e.message; });
  }
  function drawList() {
    var q = SN.norm($('#q').value), items = records.slice().sort(function (a, b) { return String(b.date).localeCompare(String(a.date)) || b.row - a.row; })
      .filter(function (r) { return !q || SN.norm(r.brand + r.brewery).indexOf(q) >= 0; });
    $('#l-count').textContent = '記録 ' + items.length + '件';
    $('#l-items').innerHTML = items.map(function (r) {
      return '<button class="li" type="button" data-row="' + r.row + '"><div class="thumb' + (r.thumb ? ' has' : '') + '"><span>瓶</span><img alt="" src="' + esc(r.thumb || '') + '"></div><div class="tx"><b>' + esc(r.brand) + '</b><span>' +
        esc([r.date, r.area, r.rating].filter(Boolean).join(' ／ ')) + '</span></div></button>';
    }).join('');
    $$('#l-items .li').forEach(function (b) {
      b.onclick = function () {
        var r = records.filter(function (x) { return String(x.row) === b.dataset.row; })[0];
        SN.load().then(function () {
          D = fromServer(r);
          if (D.brandId) { var br = SN.brands.filter(function (x) { return x.id === D.brandId; })[0]; if (br) D.chart = SN.chart10(br.id); }
          show('res');
        });
      };
    });
  }
  $('#q').oninput = drawList;

  /* ---------- 設定 ---------- */
  $('#btn-set').onclick = function () {
    modal('設定', '<div class="form"><label>GASのURL<input id="s-url" type="url" value="' + esc(localStorage.getItem(CONFIG.URL_KEY) || CONFIG.GAS_URL) + '"></label>' +
      '<label>合言葉<input id="s-tok" type="password" value="' + esc(localStorage.getItem(CONFIG.TOKEN_KEY) || '') + '" autocomplete="off"></label>' +
      '<button id="s-save" class="main" type="button" style="margin-top:4px">保存</button>' +
      '<div class="note">さけのわデータ更新日: ' + esc(SN.updated || '読み込み前') + '</div></div>');
    $('#s-save').onclick = function () {
      localStorage.setItem(CONFIG.URL_KEY, $('#s-url').value.trim()); localStorage.setItem(CONFIG.TOKEN_KEY, $('#s-tok').value.trim());
      listRequest++; records = []; drawList();
      $('#modal').hidden = true; loadCost();
      if (view === 'list') loadList();
    };
  };

  /* ---------- iPhone対策: 入力後のずれを戻す ---------- */
  document.addEventListener('focusout', function () { setTimeout(function () { window.scrollTo(0, 0); document.body.scrollTop = 0; document.documentElement.scrollTop = 0; }, 80); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { loadCost(); if (view === 'list') loadList(); } });

  /* ---------- 起動 ---------- */
  if ('serviceWorker' in navigator && !API.mock) navigator.serviceWorker.register('sw.js').catch(function () {});
  SN.load();
  loadCost();
  show('reg');
})();
