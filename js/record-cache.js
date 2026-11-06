(function () {
  'use strict';
  var DEFAULTS = { maxAgeMs: 30 * 86400000, maxRecords: 1000, maxSnapshotBytes: 5 * 1024 * 1024, maxTotalBytes: 10 * 1024 * 1024, maxThumbChars: 32768 };
  var FIELDS = ['row','recordId','sourceSheetId','sourceVersion','date','brand','brewery','area','grade','method','rice','polish','place','memo','color','clarity','viscosity','aromaType','aromaDetail','ssi4','rating','brandId','bottleUrl','labelUrl','scale','updatedAt'];
  var AXES = ['aroma','attack','sweet','acid','bitter','umami','body','finish'];
  function connection(scope) {
    if (!scope || !scope.endpoint || !scope.generation || !/^[A-Za-z0-9_-]+$/.test(scope.sourceSheetId || '')) throw new Error('端末保存の接続先を確認できません');
    return JSON.stringify([scope.endpoint, scope.generation]);
  }
  function key(scope) { return JSON.stringify([connection(scope), scope.sourceSheetId]); }
  function bytes(value) { return new TextEncoder().encode(JSON.stringify(value)).length; }
  function create(options) {
    options = options || {};
    var limits = Object.assign({}, DEFAULTS, options.limits || {}), now = options.now || Date.now;
    var backend = options.backend || indexedDBBackend();
    function clean(record, source) {
      if (!record || record.sourceSheetId !== source || !/^[a-f0-9]{64}$/.test(record.sourceVersion || '') || !Number.isInteger(record.row) || record.row < 2) throw new Error('出所と版を確認できない記録は端末保存しません');
      var result = {};
      FIELDS.forEach(function (field) { if (['string','number','boolean'].indexOf(typeof record[field]) >= 0) result[field] = record[field]; });
      ['scores','estimates'].forEach(function (field) {
        result[field] = {};
        AXES.forEach(function (axis) { var value = (record[field] || {})[axis]; if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'string') result[field][axis] = value; });
        // Legacy finish descriptions are still needed for the 3-to-10 display conversion.
        if (field === 'scores' && typeof (record[field] || {}).finish === 'string') result[field].finish = record[field].finish;
      });
      result.fixed = Array.isArray(record.fixed) ? record.fixed.filter(function (axis) { return AXES.indexOf(axis) >= 0; }) : [];
      result.thumb = typeof record.thumb === 'string' && record.thumb.length <= limits.maxThumbChars && /^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(record.thumb) ? record.thumb : '';
      return result;
    }
    return {
      read: function (scope) { return Promise.resolve().then(function () {
        return backend.get(key(scope));
      }).then(function (entry) {
        if (!entry) return null;
        var age = now() - entry.savedAt;
        if (entry.schema !== 1 || entry.key !== key(scope) || entry.connection !== connection(scope) || entry.sourceSheetId !== scope.sourceSheetId || !Number.isFinite(age) || age < 0 || age > limits.maxAgeMs) return backend.remove(key(scope)).then(function () { return null; });
        if (!Array.isArray(entry.records) || entry.records.length > limits.maxRecords) throw new Error('端末保存データの形式を確認できません');
        entry.records = entry.records.map(function (r) { return clean(r, scope.sourceSheetId); });
        return entry;
      }); },
      write: function (scope, response) { return Promise.resolve().then(function () {
        var cacheKey = key(scope);
        if (!response || response.sourceSheetId !== scope.sourceSheetId || !Array.isArray(response.records) || response.records.length > limits.maxRecords) throw new Error('端末保存の件数または接続先を確認してください');
        var entry = { schema: 1, key: cacheKey, connection: connection(scope), sourceSheetId: scope.sourceSheetId, savedAt: now(), records: response.records.map(function (r) { return clean(r, scope.sourceSheetId); }) };
        entry.bytes = bytes(entry) + 32;
        if (entry.bytes > limits.maxSnapshotBytes) { entry.records.forEach(function (r) { r.thumb = ''; }); entry.bytes = bytes(entry) + 32; }
        if (entry.bytes > limits.maxSnapshotBytes) throw new Error('端末保存の容量上限を超えています。通信表示を続けます');
        return backend.commit(entry, limits.maxTotalBytes, now() - limits.maxAgeMs).then(function () { return { savedAt: entry.savedAt, bytes: entry.bytes }; });
      }); },
      clear: function (scope) { return Promise.resolve().then(function () { return backend.clear(connection(scope)); }); },
      limits: limits
    };
  }
  function indexedDBBackend() {
    var pending;
    function database() {
      if (pending) return pending;
      pending = new Promise(function (resolve, reject) {
        if (typeof indexedDB === 'undefined') { reject(new Error('この端末では記録の保存を利用できません')); return; }
        var request = indexedDB.open('sake-log-record-cache-v1', 1), rejected = false;
        request.onupgradeneeded = function () { request.result.createObjectStore('snapshots', { keyPath: 'key' }); };
        request.onblocked = function () { rejected = true; reject(new Error('別の画面を閉じてから端末保存を試してください')); };
        request.onerror = function () { reject(new Error('端末保存を開けません。通常の通信表示を続けます')); };
        request.onsuccess = function () { var db = request.result; if (rejected) { db.close(); return; } db.onversionchange = function () { db.close(); pending = null; }; resolve(db); };
      }).catch(function (error) { pending = null; throw error; });
      return pending;
    }
    function transaction(mode, work) { return database().then(function (db) { return new Promise(function (resolve, reject) {
      var tx = db.transaction('snapshots', mode), result, error;
      tx.oncomplete = function () { resolve(result); };
      tx.onabort = tx.onerror = function () { reject(error || new Error('端末保存に失敗しました。空き容量とブラウザの設定を確認してください')); };
      try { work(tx.objectStore('snapshots'), function (value) { result = value; }, function (e) { error = e; tx.abort(); }); } catch (e) { error = e; tx.abort(); }
    }); }); }
    return {
      get: function (key) { return transaction('readonly', function (store, done) { var request = store.get(key); request.onsuccess = function () { done(request.result || null); }; }); },
      commit: function (entry, max, oldest) { return transaction('readwrite', function (store, done, fail) {
        var request = store.getAll(); request.onsuccess = function () {
          var total = request.result.reduce(function (sum, value) {
            if (value.savedAt < oldest) { store.delete(value.key); return sum; }
            return sum + (value.key === entry.key ? 0 : value.bytes || bytes(value));
          }, entry.bytes);
          if (total > max) { fail(new Error('端末保存全体の上限10MBに達しました。不要な端末保存を消去してください')); return; }
          store.put(entry);
        };
      }); },
      remove: function (key) { return transaction('readwrite', function (store) { store.delete(key); }); },
      clear: function (connection) { return transaction('readwrite', function (store) { var request = store.getAll(); request.onsuccess = function () { request.result.forEach(function (entry) { if (entry.connection === connection) store.delete(entry.key); }); }; }); }
    };
  }
  window.RecordCache = { create: create };
})();
