(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function refreshViewport() { if (window.AppViewport) window.AppViewport.refresh(); }
  function hideModal() { $('#modal').hidden = true; refreshViewport(); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  var PARAMS = [['aroma', '香り強さ'], ['attack', 'アタック'], ['sweet', '甘味'], ['acid', '酸味'], ['bitter', '苦味'], ['umami', 'うま味'], ['body', 'ボディ'], ['finish', '余韻']];
  var GRADES = ['純米大吟醸', '大吟醸', '純米吟醸', '吟醸', '特別純米', '純米', '特別本醸造', '本醸造', '普通酒', '不明'];
  var COLORS = ['無色透明', '淡い黄緑', '淡い黄色', '黄金色', '山吹色', '琥珀色'];
  var CLARITY = ['澄んだ', 'やや霞んだ', '霞んだ'];
  var VISC = ['さらっと', 'やや粘性あり', '粘性あり'];
  var SSI4 = ['薫酒', '爽酒', '醇酒', '熟酒'];

  var newEntry = newDraft(), D = newEntry, resultEntry = newEntry;
  var editingDrafts = Object.create(null), navigationVersion = 0;
  var view = 'reg';
  var detailReturn = null, listRestoration = null, listReturnNotice = '';
  var staleDetailDrafts = new WeakSet(), retainedDraftSequence = 0;
  var records = [];
  var stateSupported = false, stateEnabled = false, stateTask = null, statePending = false, stateStale = false, trashView = false, archiveView = false, oldestFirst = false, lastUndo = null, stateMessage = '', lastStateNotice = '';
  var listRequest = 0, listLoading = false;
  var savePending = false;
  var modalVersion = 0;
  var listError = '';
  var listLoaded = false, scoreProtocolKnown = false;
  var openCat = null;
  var connectionVersion = 0, snapshotSource = '', listFresh = false, lastSync = 0, mustSync = false;
  var cache = typeof RecordCache !== 'undefined' ? RecordCache.create() : null;
  var CACHE_KEY = 'sl_record_cache_scope_v1', cacheEpoch = 0, cacheWork = Promise.resolve();
  var syncNote = '', cacheNotice = '', lastCostCheck = 0;
  var cacheSettings = readCacheSettings();
  function stored(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function endpoint() { return stored(CONFIG.URL_KEY) || CONFIG.GAS_URL; }
  function online() { return navigator.onLine !== false; }
  function readCacheSettings() {
    try { var value = JSON.parse(stored(CACHE_KEY) || 'null');
      if (value && value.endpoint === endpoint() && typeof value.generation === 'string') return value;
    } catch (e) {}
    return { endpoint: endpoint(), generation: '', sourceSheetId: '', enabled: false };
  }
  function cacheEnabled() { return !!(cache && cacheSettings.enabled === true && cacheSettings.generation); }
  function scopeCopy() { return Object.assign({}, cacheSettings); }
  function rememberScope() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cacheSettings)); return true; }
    catch (e) { cacheSettings.enabled = false; cacheNotice = '端末保存の設定を保持できません。通信表示を続けます'; return false; }
  }
  function clearCache(scope) {
    cacheEpoch++;
    if (!cache || !scope.generation || !scope.sourceSheetId) return Promise.resolve();
    cacheWork = cacheWork.catch(function () {}).then(function () { return cache.clear(scope); });
    return cacheWork;
  }
  function persistList(response) {
    if (!cacheEnabled() || !response.sourceSheetId) return;
    cacheSettings.sourceSheetId = response.sourceSheetId;
    if (!rememberScope()) return;
    var epoch = cacheEpoch, scope = scopeCopy();
    cacheWork = cacheWork.catch(function () {}).then(function () {
      if (epoch !== cacheEpoch || !cacheEnabled()) return;
      return cache.write(scope, response);
    }).then(function () { if (epoch === cacheEpoch && scoreProtocolKnown) cacheNotice = ''; }).catch(function (error) {
      if (epoch === cacheEpoch) { cacheNotice = '端末保存できませんでした: ' + error.message; if (view === 'list') drawList(); }
    });
  }
  function acceptList(response) {
    stateSupported = response.recordStateFormat === 'state-v3'; stateEnabled = response.recordStateEnabled === true; stateStale = false;
    scoreProtocolKnown = response.records.every(function (r) { return r.scoreFormat === 'preserve-v1'; });
    cacheNotice = scoreProtocolKnown ? '' : '旧形式の評価情報です。更新されたGASへ再同期してください';
    if (lastUndo && !response.records.some(function (r) { return sameProof(r, lastUndo); })) lastUndo = null;
    records = response.records; snapshotSource = response.sourceSheetId || ''; listLoaded = true; listFresh = true; lastSync = Date.now(); mustSync = false; listError = '';
    if (response.stateNotice) stateMessage = response.stateNotice;
    else if (stateMessage === lastStateNotice) stateMessage = '';
    lastStateNotice = response.stateNotice || '';
    syncNote = '最終同期 ' + new Date(lastSync).toLocaleString('ja-JP'); persistList(response);
  }
  function changedConnection() {
    detailReturn = null; listRestoration = null; listReturnNotice = '';
    stateTask = null; statePending = false; stateStale = false; stateSupported = false; stateEnabled = false; lastUndo = null; stateMessage = ''; lastStateNotice = ''; trashView = false; archiveView = false;
    connectionVersion++; navigationVersion++; listRequest++; listLoading=false; cacheEpoch++; records = []; listLoaded = false; scoreProtocolKnown = false; listFresh = false; lastSync = 0; snapshotSource = ''; syncNote = '';
    lastCostCheck = 0; $('#cost-total').textContent = '—';
    if (API.invalidate) API.invalidate();
  }


  function newDraft() {
    return { connectionVersion: connectionVersion || 0, started: false, row: null, recordId: '', sourceSheetId: '', sourceVersion: '', date: today(), place: '', memo: '', brand: '', brewery: '', area: '', grade: '', method: '', rice: '', polish: '',
      brandId: null, scores: {}, scoreInfo: {}, scoreEdits: {}, scoreFormat: '', revisionFormat:'', revisionVersion:'none', baseVersion:'', revisionEligible:false, revisionReason:'', revisionConflict:false, recordKey:'', stateVersion:'none', gen: {}, fixed: {}, aroma: { sel: [], ai: [], custom: [] }, ssi4: '', color: '', clarity: '', viscosity: '', rating: '',
      saveMessage: '', photos: { bottle: null, label: null }, thumb: '', bottleUrl: '', labelUrl: '', scale: 10 };
  }

  /* ---------- 画面切り替え ---------- */
  function editKey(r) { return JSON.stringify([connectionVersion, r.sourceSheetId, r.row, r.recordId, r.sourceVersion]); }
  function rememberEditDraft(key,draft) {
    var previous=editingDrafts[key];if(previous&&previous!==draft)editingDrafts[key+'|retained-'+(++retainedDraftSequence)]=previous;
    editingDrafts[key]=draft;
  }
  function sameDraftIdentity(a,b) {
    if(a.connectionVersion!==connectionVersion||a.sourceSheetId!==b.sourceSheetId)return false;
    if(a.recordKey&&b.recordKey)return a.recordKey===b.recordKey;
    var fixedA=!!a.recordId&&!/^r\d+$/.test(a.recordId),fixedB=!!b.recordId&&!/^r\d+$/.test(b.recordId);
    if(fixedA||fixedB)return fixedA&&fixedB&&a.recordId===b.recordId;
    // Legacy row identities are reusable only for the exact original snapshot.
    // Never follow an IDless record across a row, source, or proof change.
    return !a.recordKey&&!b.recordKey&&a.row!=null&&a.row===b.row&&a.recordId===b.recordId&&!!a.sourceVersion&&sameProof(a,b);
  }
  function canReturnToList() { return !!(detailReturn && detailReturn.connection === connectionVersion && detailReturn.draft === D && D.row != null); }
  function updateDetailBack() {
    var available = view === 'res' && canReturnToList();
    $('#detail-back').hidden = !available; $('#detail-back-note').hidden = !available;
    $('#detail-back').disabled = savePending || statePending || !!stateTask || !$('#busy').hidden;
    if(staleDetailDrafts.has(D)){$('#btn-save').disabled=savePending||!D.pendingSave;$('#btn-save').textContent=D.pendingSave?'保存結果を確認':'保存';}else $('#btn-save').textContent='保存';
  }
  function rememberList(r, button, draft) {
    var main = $('#main'), box = main.getBoundingClientRect && main.getBoundingClientRect(), rect = button.getBoundingClientRect && button.getBoundingClientRect();
    return { connection:connectionVersion, draft:draft, query:$('#q').value, archive:archiveView, trash:trashView, oldest:oldestFirst,
      top:main.scrollTop || 0, offset:box && rect ? rect.top-box.top : null,
      key:r.recordKey || '', id:r.recordId || '', source:r.sourceSheetId || '', row:r.row, version:r.sourceVersion };
  }
  function returnIdentity(r, p) {
    if (r.sourceSheetId !== p.source) return false;
    if (p.key) return r.recordKey === p.key;
    if (p.id && !/^r\d+$/.test(p.id)) return r.recordId === p.id;
    return r.row === p.row && r.recordId === p.id && r.sourceVersion === p.version;
  }
  function restoreListPosition() {
    var p = listRestoration;
    function apply() {
      if (!p || p !== listRestoration || p.navigation !== navigationVersion || view !== 'list' || p.connection !== connectionVersion) return;
      var main = $('#main'), matches = records.filter(function (r) { return returnIdentity(r,p); }), button = null;
      if (matches.length === 1) button = $$('#l-items .li').filter(function (b) { return String(b.dataset.row) === String(matches[0].row); })[0];
      var target = p.top, box = main.getBoundingClientRect && main.getBoundingClientRect(), rect = button && button.getBoundingClientRect && button.getBoundingClientRect();
      if (box && rect && p.offset !== null) target = (main.scrollTop || 0) + rect.top-box.top-p.offset;
      var maximum = Number.isFinite(main.scrollHeight) && Number.isFinite(main.clientHeight) ? Math.max(0,main.scrollHeight-main.clientHeight) : Math.max(0,target);
      main.scrollTop = Math.max(0,Math.min(maximum,target));
      var focus = button || $('#l-count'); if (focus.focus) focus.focus({preventScroll:true});
      if (!button) { $('#l-return-note').hidden=false; $('#l-return-note').textContent=listReturnNotice+' 元の記録は現在の一覧にありません。検索条件と表示状態は保持しています。'; }
    }
    apply(); if (window.requestAnimationFrame) window.requestAnimationFrame(apply);
  }
  function cancelListRestoration() { listRestoration = null; }
  if ($('#main').addEventListener) ['pointerdown','touchstart','wheel','keydown'].forEach(function (name) { $('#main').addEventListener(name,function(){if(view==='list')cancelListRestoration();},{passive:true}); });
  $('#detail-back').onclick = function () {
    if (!canReturnToList() || savePending || statePending || stateTask || !$('#busy').hidden || !$('#modal').hidden) return;
    var origin=detailReturn, uncertain=!!D.pendingSave;
    $('#q').value=origin.query;archiveView=origin.archive;trashView=origin.trash;oldestFirst=origin.oldest;
    origin.notice=uncertain?'保存結果が未確定です。編集内容を保持しています。同じ記録を開いて結果を確認してください。':'';
    show('list',true,null,origin);
    if (!uncertain && !listFresh && !listLoading && online()) loadList();
  };
  function renderRegistration() {
    $('#reg-memo').value = newEntry.memo;
    $$('.slot').forEach(function (slot) {
      var photo = newEntry.photos[slot.dataset.slot], box = $('.box', slot), image = $('img', box);
      box.classList.toggle('has', !!photo);
      if (photo) image.src = photo.url; else image.removeAttribute('src');
    });
  }
  function show(v, loadedList, target, returning) {
    navigationVersion++;
    listRestoration=null;listReturnNotice='';
    if(returning){listRestoration=Object.assign({},returning,{navigation:navigationVersion});listReturnNotice=returning.notice;}
    if (v === 'reg') { D = newEntry; resultEntry = newEntry; renderRegistration(); }
    else if (v === 'res') { D = target || resultEntry; resultEntry = D; $('#save-msg').textContent = D.saveMessage || ''; }
    view = v;
    if(v!=='res')detailReturn=null;
    ['reg', 'res', 'list'].forEach(function (k) { $('#v-' + k).hidden = k !== v; });
    $$('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
    $('#main').scrollTop = 0;
    if (v === 'list') { if (loadedList) drawList(); else loadList(); }
    if (v === 'res') renderResult();
    updateDetailBack();
    refreshViewport();
  }
  $$('#tabs button').forEach(function (b) { b.onclick = function () { show(b.dataset.v); }; });

  function busy(msg) { if (msg) { $('#busy-msg').textContent = msg; $('#busy').hidden = false; } else { $('#busy').hidden = true; } updateDetailBack(); }
  function modal(title, html) { modalVersion++; $('#modal-title').textContent = title; $('#modal-content').innerHTML = html; $('#modal').hidden = false; refreshViewport(); }
  $('#modal-close').onclick = function () { modalVersion++; hideModal(); };

  /* ---------- 料金表示 ---------- */
  function yen(n) { return '¥' + (n < 100 ? Math.round(n * 10) / 10 : Math.round(n)).toLocaleString('ja-JP'); }
  API.onCost(function (t) { $('#cost-total').textContent = yen(t); });
  function loadCost() { if (!online() || Date.now() - lastCostCheck < 300000) return; if (API.configured()) { lastCostCheck = Date.now(); API.call('cost').catch(function () { $('#cost-total').textContent = '—'; }); } }

  /* ---------- 写真 ---------- */
  function readAsDataURL(file) {
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsDataURL(file); });
  }
  function processPhoto(slot, file) {
    var draft = newEntry;
    var opt = { maxSizeMB: 0.45, maxWidthOrHeight: 1280, useWebWorker: false, fileType: 'image/jpeg', initialQuality: 0.8 };
    return imageCompression(file, opt).then(function (f) {
      return Promise.all([readAsDataURL(f), imageCompression(file, { maxSizeMB: 0.02, maxWidthOrHeight: 220, useWebWorker: false, fileType: 'image/jpeg' }).then(readAsDataURL)]);
    }).then(function (r) {
      draft.photos[slot] = { url: r[0], b64: r[0].split(',')[1] };
      if (slot === 'bottle' || !draft.photos.bottle) draft.thumb = r[1];
      if (draft === newEntry && view === 'reg') renderRegistration();
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
    D = newEntry; resultEntry = newEntry;
    showRegErr('');
    if (!online()) { showRegErr('オフラインでは写真の読み取りはできません。変更は予約していません'); return; }
    if (!D.photos.label && !D.photos.bottle) { showRegErr('ラベルか瓶の写真を入れてください'); return; }
    if (!API.configured()) { showRegErr('設定でGASのURLと合言葉を入れてください'); return; }
    var photos = {};
    if (D.photos.label) photos.label = D.photos.label.b64;
    if (D.photos.bottle) photos.bottle = D.photos.bottle.b64;
    var keep = { photos: D.photos, thumb: D.thumb, memo: D.memo, date: D.date, place: D.place };
    var nd = newDraft(); Object.assign(nd, keep); newEntry = nd; D = nd; resultEntry = nd; D.started = true;
    var target = nd, generation = navigationVersion, connection = connectionVersion;
    function current() { if (target !== newEntry || generation !== navigationVersion || connection !== connectionVersion) throw new Error('画面または接続先が変わったため読み取りを中止しました'); }
    busy('ラベルを読み取り中…');
    SN.load().then(function () { current(); return API.call('read', { photos: photos }); }).then(function (r) {
      current();
      var f = r.fields || {};
      D.brand = f.brand || ''; D.brewery = f.brewery || ''; D.area = f.prefecture || ''; D.grade = f.grade || ''; D.method = f.method || ''; D.rice = f.rice || ''; D.polish = f.polish || '';
      var c = SN.search(D.brand, D.brewery, 6);
      var best = c[0];
      if (best && best.score < 0.3) applyBrand(best, false);
      busy('味を推定中…');
      return estimate().then(function () { return c; });
    }).then(function (c) {
      current(); busy(); show('res', false, target);
      if (!target.brandId) pickBrand(c);
    }).catch(function (e) {
      busy(); showRegErr('読み取れませんでした: ' + e.message);
    });
  };
  $('#btn-manual').onclick = function () {
    if (newEntry.connectionVersion !== connectionVersion) {
      modal('接続先が変わりました', '<p>書きかけの新規下書きを、新しい接続先で使いますか？ 内容は保持します。</p><button id="draft-rebind" class="main" type="button">この下書きを新しい接続先で使う</button>');
      $('#draft-rebind').onclick = function () { newEntry.connectionVersion = connectionVersion; hideModal(); D = newEntry; newEntry.started = true; show('res', false, newEntry); };
      return;
    }
    D = newEntry; D.started = true;
    SN.load(); show('res', false, newEntry);
  };

  function estimate() {
    if (!online()) return Promise.reject(new Error('オフラインではAIの推定はできません'));
    var target = D;
    return API.call('estimate', { info: { brand: target.brand, brewery: target.brewery, grade: target.grade, method: target.method, rice: target.rice, polish: target.polish } }).then(function (r) {
      var estimated = Scores.cleanAI(r.scores);
      Object.keys(estimated).forEach(function (k) {
        target.scores[k] = estimated[k]; target.gen[k] = estimated[k]; delete target.fixed[k];
        target.scoreInfo[k] = Scores.describe(estimated[k], 10, { scale: 10, origin: 'ai' });
        target.scoreEdits[k] = { value: estimated[k], origin: 'ai' };
      });
      target.aroma.ai = r.aroma || []; if (!target.ssi4 && r.ssi4) target.ssi4 = r.ssi4;
    });
  }

  /* ---------- 銘柄の一致 ---------- */
  function applyBrand(b, overwrite) {
    D.brandId = b.id;
    if (overwrite || !D.brewery) D.brewery = b.brewery || D.brewery;
    if (overwrite || !D.area) D.area = b.area || D.area;
  }
  function pickBrand(list) {
    var html = '<input id="pq" type="search" placeholder="銘柄名で探す" style="width:100%;margin-bottom:10px;background:#1a1f2b;border:.5px solid #3a4258;border-radius:10px;padding:9px 12px;color:#e9e6dc"><div id="pl"></div><button class="cand" data-none="1" type="button">該当なし（AI推定のみ）</button>';
    modal('銘柄を選ぶ', html);
    var draw = function (l) {
      $('#pl').innerHTML = l.map(function (b, i) { return '<button class="cand" data-i="' + i + '" type="button">' + esc(b.name) + '<small>' + esc(b.brewery) + (b.area ? ' ／ ' + esc(b.area) : '') + '</small></button>'; }).join('') || '<div class="note">候補がありません</div>';
      $$('#pl .cand').forEach(function (el) { el.onclick = function () { applyBrand(l[+el.dataset.i], true); hideModal(); renderResult(); }; });
    };
    draw(list || SN.search(D.brand, D.brewery, 6));
    $('#pq').oninput = function () { draw(SN.search(this.value, '', 8)); };
    $('[data-none]').onclick = function () { D.brandId = null; hideModal(); renderResult(); };
  }
  $('#btn-pick').onclick = function () { var draft = D, generation = navigationVersion; SN.load().then(function () { if (D === draft && generation === navigationVersion && view === 'res') pickBrand(); }); };
  $('#btn-reest').onclick = function () {
    busy('味を推定中…');
    estimate().then(function () { busy(); renderResult(); }).catch(function (e) { busy(); $('#save-msg').textContent = '推定できませんでした: ' + e.message; });
  };

  /* ---------- 結果画面 ---------- */
  function renderResult() {
    updateDetailBack();
    $('#detail-archive').hidden = !D.row || !!D.deletedAt; $('#detail-delete').hidden = !D.row || !!D.deletedAt;
    $('#detail-archive').textContent = D.archived ? 'メモに戻す' : 'アーカイブ';
    $('#detail-archive').disabled = savePending || !!stateTask || !online(); $('#detail-delete').disabled = savePending || !!stateTask || !online();
    $('#btn-save').disabled = !D.started || savePending; $('#btn-reest').disabled = !D.started; $('#btn-pick').disabled = !D.started;
    if(staleDetailDrafts.has(D)){
      $('#btn-save').disabled=savePending||!D.pendingSave;$('#btn-reest').disabled=true;$('#btn-pick').disabled=true;$('#detail-archive').disabled=true;$('#detail-delete').disabled=true;
      $('#detail-back-note').textContent=D.pendingSave?'保存結果が未確定です。新たな保存は行わず結果だけを確認できます。以前の編集内容は保持しています。':'以前の編集を保持しています。記録の版が変わったため保存できません。一覧へ戻り、最新の記録を選んでください。';
    }else $('#detail-back-note').textContent='保存前の編集は、この起動中は保持します。';
    if (!D.started) {
      $('#r-name').textContent = '写真を読み取るか、一覧から選んでください';
      ['#r-sub','#r-match','#r-context','#r-photos','#basic-form','#r-params','#r-looks','#a-sum','#a-cats','#a-chips','#save-msg'].forEach(function (id) { $(id).innerHTML = ''; $(id).textContent = ''; });
      var thumb = $('.head .thumb'); thumb.classList.toggle('has', false); $('img', thumb).removeAttribute('src');
      $('#result-memo').value = D.memo; return;
    }
    renderHead(); renderBasic(); renderParams(); renderLooks(); renderAroma();
    $('#result-memo').value = D.memo;
  }
  function renderHead() {
    $('#r-name').textContent = D.brand || '（銘柄名なし）';
    $('#r-context').textContent = D.row == null ? '新しい記録' : D.revisionReason || '保存済みの記録を編集中 / 改訂履歴へ保存し、原本タブは変更しません';
    if(staleDetailDrafts.has(D))$('#r-context').textContent='以前の一時編集（版が異なるため保存不可・内容と取得時の情報は保持）';
    $('#r-sub').textContent = [D.brewery, D.area, D.grade].filter(Boolean).join(' ／ ');
    var matched = D.brandId ? SN.brands.filter(function (b) { return b.id === D.brandId; })[0] : null;
    var m = matched ? '銘柄照合: ' + matched.name + '（名称の一致）' : D.brandId ? '銘柄照合: 保存済みのIDあり' : '銘柄照合: 該当なし';
    $('#r-match').textContent = m;
    var th = $('.head .thumb'), src = (D.photos.bottle && D.photos.bottle.url) || photoThumb(D);
    th.classList.toggle('has', !!src); $('img', th).src = src;
    $('img', th).onerror = function () { th.classList.toggle('has', false); };
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
  function renderParams() {
    var el = $('#r-params'); el.innerHTML = '';
    PARAMS.forEach(function (p) {
      var k = p[0], info = D.scoreInfo[k] || Scores.describe(D.scores[k], 10), v = info.number;
      var g = Scores.ten(D.gen[k]), original = info.kind === 'original';
      var d = document.createElement('div'); d.className = 'score-item';
      d.innerHTML = '<div class="prow' + (v === null ? ' score-kind' : '') + '"><span class="n">' + p[1] + '</span><div class="rng"' + (original ? ' hidden' : '') + '><input type="range" min="1" max="10" step="1" value="' + (v !== null ? v : 5) + '" aria-label="' + p[1] + '（10段階で変更）">' +
        (g !== null ? '<i class="mk" style="left:calc(var(--range-thumb-size) / 2 + (100% - var(--range-thumb-size)) * ' + ((g - 1) / 9) + ' - 1px)"></i>' : '') +
        '</div><span class="v' + (v === null ? ' value-kind' : '') + '">' + (v !== null ? v : original ? '原文' : '未記録') + '</span></div>' +
        (original ? '<div class="score-original">' + esc(String(info.raw)) + '</div><button class="link score-edit" type="button">10段階で入力する</button>' : '') +
        '<div class="score-origin">' + esc(info.label) + '</div>';
      var range = $('input', d), number = $('.v', d), origin = $('.score-origin', d);
      if (original) $('.score-edit', d).onclick = function () { $('.rng', d).hidden = false; this.hidden = true; };
      range.oninput = function () {
        var value = Scores.ten(range.value); if (value === null) return;
        D.scores[k] = value; D.scoreEdits[k] = { value: value, origin: 'user' }; D.fixed[k] = true;
        D.scoreInfo[k] = Scores.describe(value, 10, { scale: 10, origin: 'user' });
        number.textContent = value; number.className = 'v'; origin.textContent = '入力値（10段階）・この項目のみ変更';
        var old = $('.score-original', d); if (old) old.hidden = true;
      };
      el.appendChild(d);
    });
    var note = document.createElement('div'); note.className = 'note';
    note.textContent = '旧評価は原文または旧1〜3からの換算で表示します。10段階へ勝手に書き換えず、変更した項目だけ保存します。'; el.appendChild(note);
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
  $('#reg-memo').oninput = function () { newEntry.memo = this.value; };
  $('#result-memo').oninput = function () { D.memo = this.value; if (D === newEntry) $('#reg-memo').value = D.memo; };

  /* ---------- 保存 ---------- */
  $('#btn-save').onclick = saveCurrentDraft;
  function saveCurrentDraft() {
    if (savePending) return;
    if(staleDetailDrafts.has(D)&&!D.pendingSave){$('#save-msg').textContent='記録の版が変わっています。この一時編集を最新の版へ自動保存しません。一覧から最新の記録を開いてください';return;}
    if (stateTask) { $('#save-msg').textContent = '一覧操作の結果が未確定です。一覧で結果を確認してください'; return; }
    if (D.deletedAt) { $('#save-msg').textContent = 'ごみ箱の記録です。一覧で復元してから保存してください'; return; }
    if (!online()) { $('#save-msg').textContent = 'オフラインでは保存できません。変更は予約していません'; return; }
    if (D.connectionVersion !== connectionVersion || (D.row && D.sourceSheetId && snapshotSource && D.sourceSheetId !== snapshotSource)) { $('#save-msg').textContent = '接続先が変わりました。一覧から記録を選び直してください'; return; }
    if (!D.brand) { $('#save-msg').textContent = '銘柄名を入れてください'; return; }
    if (!API.configured()) { $('#save-msg').textContent = '設定でGASのURLと合言葉を入れてください'; return; }
    if (D.row != null && D.scoreFormat !== 'preserve-v1') { $('#save-msg').textContent = '評価を保持するGAS更新または一覧の同期が必要です。既存記録は保存せず、同期後に開き直してください'; return; }
    if (D.revisionConflict || (D.row != null && (D.revisionFormat !== 'revision-v1' || D.revisionReason || D.revisionConflict || !D.recordKey || !D.baseVersion))) { $('#save-msg').textContent = D.revisionReason || '改訂保存の取得情報がありません。一覧を同期してください'; return; }
    var A = D.aroma, types = Object.keys(AROMA).filter(function (c) { return cnt(c) > 0; });
    var rec = { revisionMode:'revision-v1', revisionVersion:D.revisionVersion, baseVersion:D.baseVersion, recordKey:D.recordKey, stateVersion:D.stateVersion, row: D.row, recordId: D.recordId, sourceSheetId: D.sourceSheetId, sourceVersion: D.sourceVersion, date: D.date, brand: D.brand, brewery: D.brewery, area: D.area, grade: D.grade, method: D.method, rice: D.rice, polish: D.polish, place: D.place,
      color: D.color, clarity: D.clarity, viscosity: D.viscosity, ssi4: D.ssi4, rating: D.rating, memo: D.memo, brandId: D.brandId || '',
      scoreMode: 'preserve-v1', scoreEdits: D.scoreEdits, fixed: Object.keys(D.fixed).filter(function (k) { return D.fixed[k]; }), estimates: D.gen,
      aromaType: types.join('、'), aromaDetail: A.sel.join('、'), scale: 10 };
    var photos = {};
    if (D.photos.bottle) photos.bottle = D.photos.bottle.b64;
    if (D.photos.label) photos.label = D.photos.label.b64;
    if (D.photos.bottle || D.photos.label) rec.thumb = D.thumb;
    // Keep one non-secret operation ID and an immutable payload across uncertain retries.
    // It is never an authentication token and is not persisted in localStorage/IndexedDB.
    var fingerprint = JSON.stringify({ record: rec, photos: photos });
    if (D.pendingSave && D.pendingSave.fingerprint !== fingerprint) {
      $('#save-msg').textContent = '前の保存結果が未確定です。下書きは保持しています。前の内容に戻すか、一覧と管理者の確認後に再開してください'; return;
    }
    if (!D.pendingSave) D.pendingSave = { fingerprint: fingerprint, id: 'op-' + Date.now().toString(36) + '-' + (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 30) };
    rec = JSON.parse(JSON.stringify(rec)); photos = JSON.parse(JSON.stringify(photos));
    rec.saveOperationId = D.pendingSave.id;
    var draft = D, submittedPhotos = { bottle: D.photos.bottle, label: D.photos.label }, submittedEdits = JSON.stringify(rec.scoreEdits);
    savePending = true;
    invalidateListRead();
    clearCache(scopeCopy()).catch(function () { cacheNotice = '以前の端末保存を消去できません。一覧を同期してください'; });
    busy('保存中…'); draft.saveMessage = ''; $('#save-msg').textContent = '';
    var saveAction=draft.pendingSave.sent && rec.row!=null ? 'revisionStatus' : 'save';draft.pendingSave.sent=true;
    return API.call(saveAction, { recordStateContract:'state-v3', record: rec, photos: photos }).then(function (r) {
      draft.row = r.row; draft.recordId = r.recordId; savePending = false; busy();
      draft.sourceSheetId = r.sourceSheetId || ''; draft.sourceVersion = r.sourceVersion || '';
      draft.scoreFormat = 'preserve-v1'; draft.pendingSave = null;
      draft.revisionFormat=r.revisionFormat||''; draft.revisionVersion=r.revisionVersion||'none'; draft.baseVersion=r.baseVersion||''; draft.recordKey=r.recordKey||draft.recordKey; draft.stateVersion=r.stateVersion||draft.stateVersion; draft.revisionConflict=!!r.revisionConflict; ['pinned','archived','deletedAt','sortOrder','stateEligible'].forEach(function(k){if(r[k]!==undefined)draft[k]=r[k];});
      if (JSON.stringify(draft.scoreEdits) === submittedEdits) draft.scoreEdits = {};
      ['bottle','label'].forEach(function (slot) { if (draft.photos[slot] === submittedPhotos[slot]) draft.photos[slot] = null; });
      if (r.bottleUrl) draft.bottleUrl = r.bottleUrl;
      if (r.labelUrl) draft.labelUrl = r.labelUrl;
      if (draft.connectionVersion === connectionVersion) {
        Object.keys(editingDrafts).forEach(function (key) { if (editingDrafts[key] === draft) delete editingDrafts[key]; });
        rememberEditDraft(editKey(draft),draft);
        if (draft === newEntry) { newEntry = newDraft(); if (view === 'reg') { D = newEntry; resultEntry = newEntry; renderRegistration(); } }
      }
      if (draft.connectionVersion === connectionVersion) { invalidateListRead(); clearCache(scopeCopy()).catch(function () { cacheNotice = '以前の端末保存を消去できません。一覧を同期してください'; }); }
      draft.saveMessage = r.revisionConflict ? '改訂は受付済みですが原本との競合があります。一覧を同期してください' : r.acceptedRevision && r.latestView && r.latestView.status !== 'updated' ? '保存しました。最新内容タブは未更新または未確認です（改訂を再送しません）' : '保存しました'; if (D === draft) $('#save-msg').textContent = draft.saveMessage;updateDetailBack(); return !r.revisionConflict;
    }).catch(function (e) {
      savePending = false; busy();
      if (draft.connectionVersion === connectionVersion) { invalidateListRead(); clearCache(scopeCopy()).catch(function () { cacheNotice = '以前の端末保存を消去できません。一覧を同期してください'; }); }
      if (e.code === 'SAVE_REJECTED') draft.pendingSave = null;
      draft.saveMessage = '保存できませんでした: ' + e.message; if (D === draft) $('#save-msg').textContent = draft.saveMessage;updateDetailBack(); return false;
    });
  }

  /* ---------- 一覧 ---------- */
  function fromServer(r) {
    var d = newDraft(); d.started = true;
    ['row', 'recordId', 'sourceSheetId', 'sourceVersion', 'date', 'place', 'memo', 'brand', 'brewery', 'area', 'grade', 'method', 'rice', 'polish', 'ssi4', 'color', 'clarity', 'viscosity', 'rating', 'thumb', 'bottleUrl', 'labelUrl', 'deletedAt', 'pinned', 'archived', 'sortOrder', 'createdAt', 'creationKnown', 'recordKey', 'stateVersion', 'stateEligible', 'stateReason'].forEach(function (k) { if (r[k] != null) d[k] = r[k]; });
    d.brandId = r.brandId ? +r.brandId : null; d.scale = r.scale;
    d.scoreFormat = r.scoreFormat || '';
    PARAMS.forEach(function (p) {
      var k = p[0], raw = (r.scores || {})[k], info = Scores.describe(raw, r.scale, (r.scoreMeta || {})[k], k);
      d.scoreInfo[k] = info;
      if (info.number !== null) d.scores[k] = info.number;
    });
    ['revisionFormat','revisionVersion','baseVersion','revisionEligible','revisionReason','revisionConflict','recordKey','stateVersion'].forEach(function(k){if(r[k]!==undefined)d[k]=r[k];});
    d.gen = r.estimates || {};
    (r.fixed || []).forEach(function (k) { d.fixed[k] = true; });
    var det = (r.aromaDetail || '').split(/[、,，]/).map(function (s) { return s.trim(); }).filter(Boolean);
    d.aroma.sel = det; det.forEach(function (x) { if (AROMA_ALL.indexOf(x) < 0) d.aroma.custom.push({ n: x, c: 'ミネラル・他' }); });
    return d;
  }
  function invalidateListRead() { listRequest++; listLoading=false; lastSync=0; listFresh=false; }
  function loadList(force) {
    if (savePending || statePending || stateTask) { drawList(); return; }
    force = !!(force || mustSync);
    var request = ++listRequest; listLoading=true;
    listError = '';
    // The old sl_list has no source identity and is deliberately left unused.
    if (!API.configured()) { listLoading=false; records = []; listLoaded = false; listError = '設定でGASのURLと合言葉を入れてください'; drawList(); return; }
    if (!force && stateSupported && scoreProtocolKnown && cacheEnabled() && listLoaded && lastSync && Date.now() - lastSync < 300000) {
      listLoading=false; syncNote = (online() ? '端末内の一覧' : 'オフライン・閲覧のみ') + '（最終同期 ' + new Date(lastSync).toLocaleString('ja-JP') + '）'; drawList(); return;
    }
    function synchronize() {
      if (request !== listRequest) return;
      if (!online()) { listLoading=false; listFresh = false; syncNote = 'オフライン・閲覧のみ。変更は予約しません'; drawList(); return; }
      listFresh = false; syncNote = '同期中…'; drawList();
      API.call('list', { includeTrash:true, recordStateContract:'state-v3', revisionContract:'revision-v1' }).then(function (response) {
        if (request !== listRequest) return;
        listLoading=false; acceptList(response); drawList();
      }).catch(function (error) {
        if (request !== listRequest) return;
        listLoading=false; listFresh = false; stateStale = true;
        if (error.code === 'AUTH' || error.code === 'CONTEXT') { records = []; listLoaded = false; clearCache(scopeCopy()).catch(function () {}); }
        listError = '一覧を取得できませんでした: ' + error.message;
        syncNote = listLoaded ? '保存済みの一覧・最終同期後の更新は未確認です' : '最新の一覧は未確認です'; drawList();
      });
    }
    if (cacheEnabled() && !listLoaded && cacheSettings.sourceSheetId) {
      var epoch = cacheEpoch;
      cache.read(scopeCopy()).then(function (saved) {
        if (request !== listRequest || epoch !== cacheEpoch || !cacheEnabled()) return;
        if (saved) {
          stateSupported = saved.recordStateFormat === 'state-v3'; stateEnabled = saved.recordStateEnabled === true;
          scoreProtocolKnown = !saved.requiresRefresh && saved.records.every(function (r) { return r.scoreFormat === 'preserve-v1'; });
          records = saved.records; snapshotSource = saved.sourceSheetId; lastSync = saved.savedAt; listLoaded = true; listFresh = false;
          syncNote = '端末保存分（最終同期 ' + new Date(lastSync).toLocaleString('ja-JP') + '）' + (online() ? '' : ' ／ オフライン・閲覧のみ'); drawList();
          if (!scoreProtocolKnown) { cacheNotice = '旧形式の端末保存です。評価の最新状態は再同期後に確認できます'; drawList(); }
          if (!force && stateSupported && scoreProtocolKnown && Date.now() - saved.savedAt < 300000) { listLoading=false; return; }
        }
        synchronize();
      }).catch(function (error) {
        if (request !== listRequest || epoch !== cacheEpoch) return;
        cacheNotice = '端末保存を読み込めません: ' + error.message; synchronize();
      });
    } else synchronize();
  }
  function photoThumb(r) {
    if (/^data:image\/(jpeg|png|webp);base64,/i.test(r.thumb || '')) return r.thumb;
    try {
      var u = new URL(r.bottleUrl || r.labelUrl || '');
      if (u.protocol !== 'https:' || u.hostname !== 'drive.google.com') return '';
      var m = u.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/), id = m ? m[1] : u.searchParams.get('id');
      if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return '';
      return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w220';
    } catch (e) { return ''; }
  }
  function stateBlocked() {
    return statePending || !!stateTask || savePending || !!newEntry.pendingSave || Object.keys(editingDrafts).some(function (k) { return !!editingDrafts[k].pendingSave; });
  }
  function sameProof(a, b) { return a.revisionVersion === b.revisionVersion && a.baseVersion === b.baseVersion && a.sourceSheetId === b.sourceSheetId && a.sourceVersion === b.sourceVersion && (a.recordKey && b.recordKey ? a.recordKey === b.recordKey && a.stateVersion === b.stateVersion : a.row === b.row && a.recordId === b.recordId); }
  function stateAllowed(r) {
    return stateSupported && scoreProtocolKnown && stateEnabled && !stateStale && online() && !stateBlocked() && r && r.stateEligible === true && r.sourceSheetId === snapshotSource && /^[a-f0-9]{64}$/.test(r.sourceVersion || '');
  }
  function requestState(r, operation, confirmed) {
    if (!stateAllowed(r)) { stateMessage = !online() ? 'オフラインでは変更できません。変更は予約していません' : '操作できません。未確定の結果を確認するか一覧を同期してください'; drawList(); return; }
    if ((operation === 'delete' || operation === 'restore') && !confirmed) {
      var generation = connectionVersion, proof = Object.assign({}, r), title = operation === 'delete' ? '削除の確認' : '復元の確認';
      modal(title, '<p>' + (operation === 'delete' ? '本当に削除しますか？' : 'この記録を復元しますか？') + '</p><p><b>' + esc(r.brand) + '</b> ／ ' + esc(r.date) + '</p><p>対象: <a target="_blank" rel="noopener noreferrer" href="https://docs.google.com/spreadsheets/d/' + encodeURIComponent(r.sourceSheetId) + '/edit">接続中のシート</a> の ' + r.row + ' 行目</p><p>元の記録行は変更せず、同じシート内の別の状態表に変更を追記します。記録・評価・メモ・写真は残ります。端末保存にもごみ箱状態を反映し、写真ファイルは削除しません。</p><button type="button" id="state-cancel" class="sub-btn">キャンセル</button><button type="button" id="state-confirm" class="main">' + (operation === 'delete' ? '削除する' : '復元する') + '</button>');
      $('#state-cancel').onclick = hideModal;
      $('#state-confirm').onclick = function () {
        if (generation !== connectionVersion || !records.concat([resultEntry]).some(function (x) { return sameProof(x, proof); })) return;
        hideModal(); requestState(proof, operation, true);
      }; if ($('#state-confirm').focus) $('#state-confirm').focus(); return;
    }
    var payload = { recordStateContract:'state-v3', operation: operation, record: { row: r.row, recordId: r.recordId, recordKey: r.recordKey, stateVersion: r.stateVersion, sourceSheetId: r.sourceSheetId, sourceVersion: r.sourceVersion, baseVersion:r.baseVersion, revisionVersion:r.revisionVersion,
      saveOperationId: 'op-' + Date.now().toString(36) + '-' + (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0,30) } };
    if (operation === 'pin') payload.pinned = !r.pinned;
    stateTask = { payload: payload, before: Object.assign({}, r), connection: connectionVersion, fromDetail:view === 'res' };
    performState(false);
  }
  function performState(checkOnly) {
    if (!stateTask || statePending || !online()) return;
    var task = stateTask; statePending = true; listRequest++; lastSync = 0; listFresh = false; lastUndo = null;
    clearCache(scopeCopy()).catch(function () { cacheNotice = '古い端末保存を消去できません。一覧を同期してください'; });
    stateMessage = checkOnly ? '結果を確認中…' : '一覧操作を保存中…'; drawList();
    API.call(task.reorder ? (checkOnly ? 'recordReorderStatus' : 'recordReorder') : (checkOnly ? 'recordStateStatus' : 'recordState'), task.payload).then(function (response) {
      if (task.connection !== connectionVersion || task !== stateTask) return;
      if(task.reorder) {
        if(response.recordStateFormat !== 'state-v3' || response.sourceSheetId !== snapshotSource || !Array.isArray(response.results) || response.results.length !== task.payload.order.length || typeof response.targetMissing !== 'boolean')throw new Error('並び順の結果を確認できません');
        stateTask=null;statePending=false;stateStale=true;stateMessage=response.targetMissing?'対象の内容が変わりました。並び順は適用せず同期します':'並び順を保存しました';drawList();loadList(true);return;
      }
      if (response.recordStateFormat !== 'state-v3' || response.recordKey !== task.before.recordKey || response.sourceSheetId !== task.before.sourceSheetId || !/^[a-f0-9]{64}$/.test(response.stateVersion || '') || typeof response.targetMissing !== 'boolean' || typeof response.pinned !== 'boolean' || typeof response.archived !== 'boolean' || !Number.isInteger(response.sortOrder) || typeof response.deletedAt !== 'string' || (!response.targetMissing && (!Number.isInteger(response.row) || response.row < 2 || !/^[a-f0-9]{64}$/.test(response.sourceVersion || '')))) throw new Error('保存結果の形式を確認できません');
      var fields = { row: response.row, recordId: response.recordId, sourceVersion: response.sourceVersion, stateVersion: response.stateVersion, deletedAt: response.deletedAt, pinned: response.pinned, archived:response.archived, sortOrder:response.sortOrder };
      if (response.targetMissing) { stateTask = null; statePending = false; stateMessage = '状態は保存しましたが、対象の内容変更・欠落・重複により適用していません。一覧を同期します'; drawList(); loadList(true); return; }
      records.forEach(function (r) { if (sameProof(r, task.before)) Object.assign(r, { sourceVersion:fields.sourceVersion, stateVersion:fields.stateVersion, deletedAt:fields.deletedAt, pinned:fields.pinned, archived:fields.archived, sortOrder:fields.sortOrder }); });
      Object.keys(editingDrafts).forEach(function (key) {
        var draft = editingDrafts[key]; if (!sameProof(draft, task.before)) return;
        delete editingDrafts[key]; Object.assign(draft, fields); editingDrafts[editKey(draft)] = draft;
      });
      if (sameProof(resultEntry, task.before)) Object.assign(resultEntry, fields);
      if (task.payload.operation === 'delete') lastUndo = Object.assign({}, task.before, fields);
      stateTask = null; statePending = false; stateStale = true; stateMessage = '保存しました。ほかの端末には次の同期で反映されます'; if(task.fromDetail)show('list',true);drawList();loadList(true);
    }).catch(function (error) {
      if (task.connection !== connectionVersion || task !== stateTask) return;
      statePending = false;
      if (error.code === 'SAVE_REJECTED') { stateTask = null; stateStale = true; stateMessage = '操作は受け付けられませんでした: ' + error.message + '。一覧を同期して確認してください'; }
      else stateMessage = '結果が未確定です: ' + error.message + '。再送せず「結果を確認」を押してください';
      drawList();
    });
  }
  function listGroup(r) { return (r.archived?'archive':'active') + ':' + (r.pinned?'pinned':'date:'+(/^\d{4}-\d{2}-\d{2}/.test(String(r.date||''))?String(r.date).slice(0,10):'unknown')); }
  function listSort(a,b) {
    if(!!a.pinned!==!!b.pinned)return Number(!!b.pinned)-Number(!!a.pinned);
    if(!a.pinned&&String(a.date)!==String(b.date))return String(b.date).localeCompare(String(a.date));
    var x=Number(a.sortOrder)||0,y=Number(b.sortOrder)||0;
    if(x&&y)return x-y;
    if(!!x!==!!y)return oldestFirst?(x?-1:1):(x?1:-1);
    var ac=a.creationKnown?Date.parse(a.createdAt):0,bc=b.creationKnown?Date.parse(b.createdAt):0;
    return(oldestFirst?1:-1)*((ac&&bc?ac-bc:0)||a.row-b.row);
  }
  function requestReorder(group, keys) {
    var cohort=records.filter(function(r){return !r.deletedAt&&listGroup(r)===group;}), byKey={};cohort.forEach(function(r){byKey[r.recordKey]=r;});
    if($('#q').value.trim()||cohort.length<2||cohort.length>50||keys.length!==cohort.length||new Set(keys).size!==keys.length||cohort.some(function(r){return!stateAllowed(r);})||keys.some(function(k){return!byKey[k];})){stateMessage='同じ枠の2〜50件を全件表示・同期してから並べ替えてください';drawList();return;}
    stateTask={reorder:true,connection:connectionVersion,payload:{recordStateContract:'state-v3',saveOperationId:'op-'+Date.now().toString(36)+'-'+(Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2)).slice(0,30),group:group,order:keys.map(function(k){var r=byKey[k],p={};['recordKey','recordId','sourceSheetId','sourceVersion','baseVersion','revisionVersion','stateVersion'].forEach(function(f){p[f]=r[f];});return p;})}};performState(false);
  }
  function drawList() {
    updateDetailBack();
    if(window.Swipe&&window.Swipe.dispose)window.Swipe.dispose();
    var q = SN.norm($('#q').value), all=records.filter(function(r){return trashView?!!r.deletedAt:!r.deletedAt&&!!r.archived===archiveView;}),items=all.slice().sort(listSort).filter(function(r){return!q||SN.norm(r.brand+' '+r.brewery+' '+(r.memo||'')).indexOf(q)>=0;});
    $('#l-count').textContent = listError || (listLoaded ? (q ? '検索結果 ' + items.length + '件（全'+all.length+'件）' : (trashView?'削除した記録 ':archiveView?'アーカイブ ':'記録 ')+items.length+'件') : 'まだ記録を取得していません');
    $('#l-count').classList.toggle('err', !!listError); $('#l-sync').textContent=[syncNote,cacheNotice].filter(Boolean).join(' ／ ');
    $('#l-return-note').hidden=!listReturnNotice;$('#l-return-note').textContent=listReturnNotice;
    $('#l-archive').textContent=archiveView?'← メモに戻る':'アーカイブ';$('#l-archive').hidden=trashView;
    $('#l-order').textContent=oldestFirst?'古い順':'新しい順';$('#l-trash').textContent='← 一覧に戻る';$('#l-trash').hidden=!trashView;
    var missingIds=records.filter(function(r){return r.stateMissingId===true;}).length;$('#l-state-availability').hidden=!missingIds;
    $('#l-state-availability').textContent=missingIds?missingIds+'件'+(missingIds===records.length?'すべてが':'は')+'固定ID未付与のため、削除・復元・アーカイブ・ピン・並べ替えは利用できません。閲覧はできます。ID移行は未実施です。':'';
    $('#l-action-msg').textContent=stateMessage||(!stateSupported?'一覧操作は停止中です。対応GASへ同期してください':!stateEnabled?'一覧操作は移行と安全確認まで停止中です':!online()?'オフライン・閲覧のみ。変更は予約しません':'右スワイプでピン、左でアーカイブ／削除。同じ枠で長押しして並べ替え。旧記録の作成日時は不明のため日付・元の順を使います');
    $('#l-state-check').hidden=!stateTask;$('#l-state-check').disabled=statePending||!online();$('#l-refresh').disabled=!!stateTask;
    $('#l-undo').hidden=!trashView||!lastUndo;$('#l-undo').disabled=!stateAllowed(lastUndo);
    var previous=null;
    $('#l-items').innerHTML=items.map(function(r){
      var group=listGroup(r),heading=group===previous?'':'<div class="list-group">'+(r.pinned?'📌 ピン留め':r.date===today()?'今日':r.date===new Date(Date.now()-86400000).toLocaleDateString('sv-SE')?'昨日':esc(r.date||'日付未記録'))+'</div>';previous=group;
      var src=photoThumb(r),hasPhoto=!!(r.thumb||r.bottleUrl||r.labelUrl),controls='</div>',disabled=stateAllowed(r)?'':' disabled';
      if(stateSupported&&r.stateEligible===true){
        var left=r.deletedAt?'': '<button type="button" data-action="pin" data-target="'+r.row+'"'+disabled+'>'+(r.pinned?'ピン解除':'ピン留め')+'</button>',right=r.deletedAt?'<button type="button" data-action="restore" data-target="'+r.row+'"'+disabled+'>復元</button>':'<button type="button" data-action="'+(r.archived?'unarchive':'archive')+'" data-target="'+r.row+'"'+disabled+'>'+(r.archived?'戻す':'アーカイブ')+'</button><button type="button" data-action="delete" data-target="'+r.row+'"'+disabled+'>削除</button>';
        controls='<button class="row-menu" type="button" data-action="menu" data-target="'+r.row+'" aria-expanded="false" aria-controls="row-actions-'+r.row+'" aria-label="'+esc(r.brand)+'の操作">操作</button></div><div class="row-actions" id="row-actions-'+r.row+'" hidden><div class="row-left">'+left+'</div><div class="row-right">'+right+'</div></div>';
      }
      return heading+'<div class="record-row" data-key="'+esc(r.recordKey||'')+'" data-group="'+group+'"><div class="record-surface"><button class="li" type="button" data-row="'+r.row+'"><div class="thumb'+(src?' has':'')+'"><span>'+(hasPhoto?'写真あり':'写真なし')+'</span><img alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="'+esc(src)+'"></div><div class="tx"><b>'+esc(r.brand)+'</b><span>'+esc([r.date,r.area,r.rating].filter(Boolean).join(' ／ '))+'</span>'+(r.stateReason?'<span class="state-reason">'+esc(r.stateReason)+'</span>':'')+'</div></button>'+controls+'</div>';
    }).join('');
    $$('#l-items .thumb img').forEach(function (img) { img.onerror = function () { img.parentElement.classList.toggle('has', false); }; });
    $$('#l-items .record-row').forEach(function (row) { if (window.Swipe) window.Swipe.attach(row, $('.record-surface', row), { canReorder:function(){var group=records.filter(function(r){return!r.deletedAt&&listGroup(r)===row.dataset.group;});return !trashView&&!q&&group.length>1&&group.length<=50&&group.every(stateAllowed);},reorder:function(keys){requestReorder(row.dataset.group,keys);},container:$('#main') }); });
    $$('#l-items [data-action]').forEach(function (button) {
      button.onclick = function () {
        var r = records.filter(function (x) { return String(x.row) === button.dataset.target; })[0];
        if (button.dataset.action === 'menu') { var row = button.closest('.record-row'); if (window.Swipe) window.Swipe.setOpen(row, row.classList.contains('actions-open')?false:'menu'); return; }
        requestState(r, button.dataset.action, false);
      };
    });
    $$('#l-items .li').forEach(function (b) {
      b.onclick = function () {
        var row = b.closest ? b.closest('.record-row') : null;
        if (row && row.classList.contains('actions-open')) { if (window.Swipe) window.Swipe.setOpen(row, false); return; }
        var r = records.filter(function (x) { return String(x.row) === b.dataset.row; })[0];
        var candidates=[];Object.keys(editingDrafts).forEach(function(k){var d=editingDrafts[k];if(sameDraftIdentity(d,r)&&candidates.indexOf(d)<0)candidates.push(d);});
        var older=candidates.filter(function(d){return !sameProof(d,r)||staleDetailDrafts.has(d);});
        var openingOrigin=rememberList(r,b,null);
        function open(d){detailReturn=Object.assign({},openingOrigin,{draft:d});show('res',false,d);}
        function latest(){var d=candidates.filter(function(x){return sameProof(x,r)&&!staleDetailDrafts.has(x);})[0]||fromServer(r);rememberEditDraft(editKey(r),d);open(d);}
        if(older.length){
          var connection=connectionVersion;
          modal('記録が更新されています','<p>以前の画面の編集は保持しています。版が異なる編集を最新の記録へ自動保存しません。</p>'+older.map(function(d,i){return '<button class="sub-btn" type="button" data-retained-draft="'+i+'">以前の編集 '+(i+1)+' を確認（保存不可）</button>';}).join('')+'<button id="detail-open-latest" class="main" type="button">最新の記録を開く</button><button id="detail-open-cancel" class="sub-btn" type="button">キャンセル</button>');
          $$('#modal-content [data-retained-draft]').forEach(function(el){el.onclick=function(){if(connection!==connectionVersion||view!=='list')return;var d=older[+el.dataset.retainedDraft];staleDetailDrafts.add(d);hideModal();open(d);};});
          $('#detail-open-cancel').onclick=hideModal;
          $('#detail-open-latest').onclick=function(){if(connection!==connectionVersion||view!=='list')return;var current=records.filter(function(x){return returnIdentity(x,{source:r.sourceSheetId,key:r.recordKey,id:r.recordId,row:r.row,version:r.sourceVersion});});if(current.length!==1||!sameProof(current[0],r)){hideModal();stateMessage='一覧の内容が変わりました。同期してから記録を開いてください';drawList();return;}hideModal();latest();};
        }else latest();
      };
    });
    restoreListPosition();
  }
  $('#q').oninput = function(){cancelListRestoration();drawList();};
  $('#l-refresh').onclick = function () { cancelListRestoration();stateMessage = ''; loadList(true); };
  $('#l-trash').onclick = function () { cancelListRestoration();trashView=false;drawList(); };
  $('#l-archive').onclick=function(){cancelListRestoration();archiveView=!archiveView;trashView=false;drawList();};
  $('#l-order').onclick=function(){cancelListRestoration();oldestFirst=!oldestFirst;drawList();};
  $('#l-undo').onclick = function () { if (lastUndo) requestState(lastUndo, 'restore', true); };
  $('#l-state-check').onclick = function () { performState(true); };

  $('#detail-archive').onclick=function(){if(staleDetailDrafts.has(D))return;var draft=D,nav=navigationVersion;var saved=saveCurrentDraft();if(saved&&saved.then)saved.then(function(ok){if(ok&&D===draft&&nav===navigationVersion)requestState(draft,draft.archived?'unarchive':'archive',true);});};
  $('#detail-delete').onclick=function(){if(!staleDetailDrafts.has(D))requestState(D,'delete',false);};
  $('#modal').onclick=function(e){if(e.target===this){modalVersion++;hideModal();}};

  /* ---------- 設定 ---------- */
  $('#btn-set').onclick = function () {
    modal('設定', '<div class="form"><label>GASのURL<input id="s-url" type="url" value="' + esc(stored(CONFIG.URL_KEY) || CONFIG.GAS_URL) + '"></label>' +
      '<label>合言葉（GASのTOKENと同じ値）<input id="s-tok" type="password" value="' + esc(stored(CONFIG.TOKEN_KEY) || '') + '" autocomplete="off"></label>' +
      '<div id="s-msg" class="note" role="status" aria-live="polite"></div>' +
      '<button id="s-save" class="main" type="button" style="margin-top:4px">接続を確認して保存</button>' +
      '<div class="note">この端末に保存し、通常は次回から入力不要です。Safariとホーム画面版は別々に設定が必要な場合があります。プライベートブラウズや端末データの消去後は再設定してください。</div>' +
      '<div class="sec">記録の端末保存</div><label><input id="s-cache" type="checkbox"' + (cacheEnabled() ? ' checked' : '') + '>記録をこの端末に保存する</label>' +
      '<div class="note">メモを含む取得済み記録と既存の小さな縮小画像を保存します。初期はオフ。最長30日、1一覧1000件・5MB、全体10MBまで。写真原本や合言葉はここには保存しません。保存済みの一覧は先に表示し、5分経過・手動同期・オンライン復帰時に更新します。オフラインは閲覧のみです。Safariの自動消去やプライベートモードでは保持できない場合があります。</div>' +
      '<button id="s-cache-apply" class="sub-btn" type="button">端末保存の設定を適用</button><button id="s-clear-cache" class="sub-btn" type="button">端末保存を解除して消去</button>' +
      '<div id="s-cache-msg" class="note" role="status" aria-live="polite"></div>' +
      '<button id="s-trash" class="sub-btn" type="button">削除した記録を復元（日本酒の補助機能）</button>' +
      '<button id="s-latest" class="sub-btn" type="button">スプシの最新内容表示を更新</button><div id="s-latest-msg" class="note" role="status"></div><div class="note">既存記録の編集は改訂履歴に保存します。原本タブは書き換えません。スプシ内の最新内容タブは作成時点の表示専用で、直接編集しても正本へ反映されず、再生成で置き換わります。</div>' +
      '<button id="s-layout" class="sub-btn" type="button">画面配置を確認（秘密情報なし）</button>' +
      '<div class="note">さけのわデータ更新日: ' + esc(SN.updated || '読み込み前') + '</div></div>');
    function disableCache() {
      var scope = scopeCopy(), generation = modalVersion; cacheSettings.enabled = false; rememberScope(); $('#s-cache').checked = false;
      if (!listFresh) { records = []; listLoaded = false; lastSync = 0; drawList(); }
      clearCache(scope).then(function () { if (generation === modalVersion) $('#s-cache-msg').textContent = 'この接続先の端末保存を解除・消去しました。シートと合言葉は変更していません'; }).catch(function () { if (generation === modalVersion) $('#s-cache-msg').textContent = '端末保存は解除しましたが、消去できませんでした。ブラウザのサイトデータから消去してください'; });
    }
    $('#s-trash').onclick=function(){hideModal();trashView=true;show('list');};
    $('#s-latest').onclick = function () {
      var generation=modalVersion,button=$('#s-latest');if(button.disabled||!online()||savePending||stateTask)return;button.disabled=true;$('#s-latest-msg').textContent='表示専用タブを更新中…';
      API.call('latestView',{revisionContract:'revision-v1'}).then(function(r){if(generation!==modalVersion)return;$('#s-latest-msg').textContent='作成時点: '+r.latestView.generatedAt+' / 原本の手動変更には自動追従しません';}).catch(function(e){if(generation===modalVersion)$('#s-latest-msg').textContent='表示更新は未確認です: '+e.message+'。改訂の保存結果とは別です';}).then(function(){if(generation===modalVersion)button.disabled=false;});
    };
    $('#s-layout').onclick = function () {
      if (!window.LayoutMetrics) return;
      modal('画面配置の確認', '<p class="note">画面の寸法と位置だけを表示します。合言葉や記録内容は含まず、自動送信もしません。</p><pre style="font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;margin-top:12px">' + esc(window.LayoutMetrics.text()) + '</pre>');
    };
    $('#s-clear-cache').onclick = disableCache;
    $('#s-cache-apply').onclick = function () {
      if (!$('#s-cache').checked) { disableCache(); return; }
      if (!API.configured()) { $('#s-cache-msg').textContent = '先にGASの接続設定を確認して保存してください'; return; }
      cacheSettings.endpoint = endpoint(); cacheSettings.enabled = true;
      if (!cacheSettings.generation) cacheSettings.generation = 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      cacheSettings.sourceSheetId = snapshotSource || cacheSettings.sourceSheetId;
      if (!rememberScope()) { $('#s-cache').checked = false; $('#s-cache-msg').textContent = cacheNotice; return; }
      if (listFresh) persistList({ sourceSheetId: snapshotSource, records: records, recordStateFormat: stateSupported ? 'state-v3' : '', recordStateEnabled:stateEnabled });
      $('#s-cache-msg').textContent = '端末保存を有効にしました。一覧で取得できた記録を保存します';
    };
    $('#s-save').onclick = function () {
      var generation = modalVersion, button = $('#s-save'), endpoint = $('#s-url').value.trim(), passphrase = $('#s-tok').value.trim();
      if (button.disabled) return;
      button.disabled = true; $('#s-msg').classList.toggle('err', false); $('#s-msg').textContent = '接続を確認中…';
      API.checkConnection(endpoint, passphrase, { recordStateContract:'state-v3', revisionContract:'revision-v1' }).then(function (r) {
        if (generation !== modalVersion) return;
        var changed = endpoint !== (stored(CONFIG.URL_KEY) || CONFIG.GAS_URL) || passphrase !== (stored(CONFIG.TOKEN_KEY) || '');
        var oldScope = scopeCopy();
        localStorage.setItem(CONFIG.URL_KEY, endpoint); localStorage.setItem(CONFIG.TOKEN_KEY, passphrase);
        if (changed) {
          changedConnection(); clearCache(oldScope).catch(function () { cacheNotice = '以前の端末保存を消去できませんでした'; });
          cacheSettings = { endpoint: endpoint, generation: '', sourceSheetId: '', enabled: false }; rememberScope();
        }
        listRequest++; acceptList(r);
        hideModal(); button.disabled = false; loadCost(); show('list', true);
      }).catch(function (e) {
        if (generation !== modalVersion) return;
        button.disabled = false; $('#s-msg').classList.toggle('err', true);
        $('#s-msg').textContent = '接続できませんでした: ' + e.message + '。設定は保存していません。';
      });
    };
  };

  /* ---------- iPhone対策: 入力後のずれを戻す ---------- */
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { loadCost(); if (view === 'list') loadList(); } });

  if (window.addEventListener) {
    window.addEventListener('offline', function () { listFresh = false; syncNote = 'オフライン・閲覧のみ。変更は予約しません'; if (view === 'list') drawList(); });
    window.addEventListener('online', function () { mustSync = true; if (view === 'list') loadList(true); });
    window.addEventListener('storage', function (event) {
      if ([CACHE_KEY, CONFIG.URL_KEY, CONFIG.TOKEN_KEY].indexOf(event.key) < 0 && event.key !== null) return;
      changedConnection(); cacheSettings = readCacheSettings(); if (view === 'list') loadList(true);
    });
  }

  /* ---------- 起動 ---------- */
  if ('serviceWorker' in navigator && !API.mock) navigator.serviceWorker.register('sw.js').catch(function () {});
  SN.load();
  loadCost();
  show('reg');
})();
