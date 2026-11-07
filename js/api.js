(function () {
  var C = window.CONFIG;
  var MOCK = /[?&]mock=1/.test(location.search);
  var listeners = [];
  var contextVersion = 0;
  function stored(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  function url() { return stored(C.URL_KEY) || C.GAS_URL; }
  function token() { return stored(C.TOKEN_KEY) || ''; }

  function mock(action, p) {
    var wait = function (v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 600); }); };
    if (action === 'read') return wait({ ok: true, fields: { brand: '山本', brewery: '山本酒造店', prefecture: '秋田県', grade: '純米吟醸', method: '', rice: '', polish: '55%' }, costTotalYen: 318 });
    if (action === 'estimate') return wait({ ok: true, scores: { aroma: 6, attack: 5, sweet: 3, acid: 4, bitter: 2, umami: 6, body: 5, finish: 7 }, aroma: ['桃', '洋梨', '米'], ssi4: '薫酒', costTotalYen: 320 });
    if (action === 'cost') return wait({ ok: true, costTotalYen: 318 });
    if (action === 'list') return wait({ ok: true, sourceSheetId: 'mock-sheet', records: [
      { row: 2, recordId: 'r2', date: '2026-02-17', brand: '山本 ブルーバタフライ 生原酒', brewery: '山本酒造店', area: '秋田県', grade: '不明', rating: '★★★★', scale: 3, scores: {}, ssi4: '薫酒', aromaDetail: '' },
      { row: 5, recordId: 'r5', date: '2026-02-17', brand: '五十嵐 純米吟醸 直汲み', brewery: '五十嵐酒造', area: '埼玉県', grade: '純米吟醸', rating: '★★★', scale: 3, scores: { aroma: 3, attack: 1, sweet: 2, acid: 1, bitter: 1, umami: 1, body: 1, finish: 'やや長い' }, ssi4: '薫酒', aromaDetail: '' }
    ].map(function (record) { return Object.assign(record, { sourceSheetId: 'mock-sheet', sourceVersion: 'a'.repeat(64) }); }) });
    if (action === 'save') return wait({ ok: true, row: 99, recordId: 'mock', costTotalYen: 320 });
    return wait({ ok: false, error: 'mock未対応' });
  }

  function call(action, payload) {
    if (MOCK) return checked(mock(action, payload), contextVersion, action);
    if (!url()) return Promise.reject(new Error('設定でGASのURLを入れてください'));
    return request(url(), token(), action, payload);
  }
  function request(endpoint, passphrase, action, payload) {
    var body = Object.assign({ token: passphrase, action: action }, payload || {});
    return checked(fetch(endpoint, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.json(); }), contextVersion, action);
  }
  function checked(promise, version, action) {
    return promise.then(function (response) {
      if (version !== contextVersion) { var error = new Error('接続先が変わりました。最新の一覧を取得してください'); error.code = 'CONTEXT'; throw error; }
      var result = done(response); return action === 'list' ? checkedList(result) : result;
    });
  }
  function checkedList(j) {
    if (!Array.isArray(j.records)) throw new Error('一覧データの形式が違います。GASの公開URLを確認してください');
    return j;
  }
  function checkConnection(endpoint, passphrase, options) {
    var listOptions = options && options.recordStateContract === 'state-v3' ? { includeTrash:true, recordStateContract:'state-v3' } : {};
    if(options && options.revisionContract === 'revision-v1')listOptions.revisionContract='revision-v1';
    try {
      var u = new URL(endpoint);
      if (u.protocol !== 'https:' || u.hostname !== 'script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname) || u.search || u.hash) throw new Error();
    } catch (e) { return Promise.reject(new Error('GASのウェブアプリURL（https://script.google.com/macros/s/…/exec）を入力してください')); }
    if (!passphrase) return Promise.reject(new Error('GASに保存した合言葉を入力してください'));
    return (MOCK ? checked(mock('list', listOptions), contextVersion, 'list') : request(endpoint, passphrase, 'list', listOptions)).then(checkedList);
  }

  function done(j) {
    if (!j || !j.ok) { var error = new Error(j && j.error || '通信に失敗しました'); error.code = j && j.code || (j && j.error === '合言葉が違います' ? 'AUTH' : ''); throw error; }
    if (typeof j.costTotalYen === 'number') listeners.forEach(function (f) { f(j.costTotalYen); });
    return j;
  }

  window.API = {
    mock: MOCK,
    call: call,
    checkConnection: checkConnection,
    invalidate: function () { contextVersion++; },
    onCost: function (f) { listeners.push(f); },
    configured: function () { return MOCK || !!(url() && token()); }
  };
})();
