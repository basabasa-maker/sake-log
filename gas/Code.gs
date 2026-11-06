/**
 * 日本酒ログ GAS
 * スクリプトプロパティ(プロジェクトの設定): ANTHROPIC_KEY / TOKEN(合言葉) / SHEET_ID(記録のスプシ) / USDJPY(任意, 既定155)
 * 鍵・合言葉・IDはコードに書かない。
 */
var CFG = {
  SHEET_NAME: 'テイスティングログ',
  COST_SHEET: '料金ログ',
  PHOTO_FOLDER: 'sake-log-photos',
  MODEL_READ: 'claude-sonnet-5-5',
  MODEL_EST: 'claude-haiku-5-5'
};
// 単価: USD / 100万トークン [入力, 出力]
var PRICE = { 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] };

var KEYMAP = {
  date: '日付', brand: '銘柄名', brewery: '蔵元', area: '産地', grade: '特定名称', method: '製法タイプ', rice: '使用米', polish: '精米歩合',
  place: '飲んだ場所', bottleUrl: '写真URL', color: '色調', clarity: '透明度', viscosity: '粘性', aromaType: '香り系統', aromaDetail: '香り具体表現',
  ssi4: 'SSI4タイプ', rating: '総合評価', memo: '自由メモ',
  labelUrl: 'ラベル写真URL', brandId: 'さけのわ銘柄ID', recordId: '記録ID', thumb: 'サムネ', scale: '評価尺度', updatedAt: '更新日時',
  fixedJson: '確定項目', estimatesJson: '推定値JSON'
};
var SCORE = { aroma: '香り強さ', attack: 'アタック', sweet: '甘味', acid: '酸味', bitter: '苦味', umami: 'うま味', body: 'ボディ', finish: '余韻' };

var AROMA_VOCAB = ['桃','白桃','洋梨','りんご','青りんご','メロン','バナナ','マスカット','ぶどう','いちご','さくらんぼ','パイン','マンゴー','ライチ','あんず','柿','レモン','グレープフルーツ','みかん','ゆず','すだち','かぼす',
  '桜','梅','バラ','ユリ','藤','金木犀','すみれ','ジャスミン','カモミール','菊',
  '米','炊きたてご飯','おかゆ','餅','栗','アーモンド','くるみ','ごま','きなこ','麦','甘酒','ポップコーン',
  'ヨーグルト','カルピス','チーズ','バター','生クリーム','酵母','パン','乳酸',
  'はちみつ','カラメル','黒糖','メープル','干しぶどう','干し柿','しょうゆ','味噌','みりん','コーヒー','カカオ','紹興酒',
  '若草','青葉','青竹','笹','ミント','バジル','しそ','お茶','きゅうり','セロリ','山菜',
  '胡椒','山椒','生姜','シナモン','クローブ','バニラ','杉','ヒノキ','樽',
  '石','濡れた石','土','きのこ','海藻','塩','墨','アルコール','薬品','ゴム'];

function doGet() { return out_({ ok: true, name: 'sake-log' }); }

function doPost(e) {
  try {
    var b = JSON.parse(e.postData.contents);
    var tok = prop_('TOKEN');
    if (!tok || b.token !== tok) return out_({ ok: false, error: '合言葉が違います' });
    switch (b.action) {
      case 'cost': return out_({ ok: true, costTotalYen: monthTotal_() });
      case 'read': return out_(actionRead_(b));
      case 'estimate': return out_(actionEstimate_(b));
      case 'save': return out_(actionSave_(b));
      case 'list': return out_(actionList_());
      default: return out_({ ok: false, error: '不明な操作: ' + b.action });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  }
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }

/* ---------- AI ---------- */
function claude_(model, system, content, maxTokens, kind) {
  var key = prop_('ANTHROPIC_KEY');
  if (!key) throw new Error('ANTHROPIC_KEY が未設定です');
  var payload = { model: model, max_tokens: maxTokens, system: system, messages: [{ role: 'user', content: content }], output_config: { effort: 'low' } };
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, payload: JSON.stringify(payload)
  });
  var code = res.getResponseCode(), j = JSON.parse(res.getContentText());
  if (code !== 200) throw new Error('AI呼び出しに失敗(' + code + '): ' + ((j.error && j.error.message) || ''));
  logCost_(kind, model, j.usage || {});
  if (j.stop_reason === 'refusal') throw new Error('AIが回答を断りました');
  var text = (j.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
  var m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AIの回答を読み取れませんでした');
  return JSON.parse(m[0]);
}

function actionRead_(b) {
  var p = b.photos || {}, content = [];
  ['label', 'bottle'].forEach(function (k) {
    if (p[k]) {
      content.push({ type: 'text', text: k === 'label' ? '【ラベルの写真】' : '【瓶の写真】' });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p[k] } });
    }
  });
  if (!content.length) throw new Error('写真がありません');
  content.push({ type: 'text', text: '写真に書かれている文字だけを根拠に、次のJSONだけを返してください。読めない項目・書かれていない項目は空文字にし、推測で補わないでください。\n' +
    '{"brand":"銘柄名(商品名。蔵元名・特定名称・製法は含めない)","brewery":"蔵元","prefecture":"都道府県","grade":"特定名称(純米大吟醸など)","method":"製法(生酛/山廃/生原酒/無濾過などをカンマ区切り)","rice":"使用米","polish":"精米歩合(例 55%)"}' });
  var r = claude_(CFG.MODEL_READ, 'あなたは日本酒のラベルを読み取る専門家です。日本語の筆文字・縦書きも読みます。JSONのみを返します。', content, 2000, 'read');
  return { ok: true, fields: r, costTotalYen: monthTotal_() };
}

function actionEstimate_(b) {
  var i = b.info || {}, axes = ['華やか', '芳醇', '重厚', '穏やか', 'ドライ', '軽快'];
  var chart = i.chart ? axes.map(function (a, k) { return a + ' ' + i.chart[k] + '/10'; }).join('、') : 'なし';
  var text = '次の日本酒について、利き酒師の評価項目を1〜10の整数で推定し、JSONだけを返してください。5が一般的な中間です。\n' +
    '銘柄: ' + (i.brand || '不明') + ' / 蔵元: ' + (i.brewery || '不明') + ' / 特定名称: ' + (i.grade || '不明') + ' / 製法: ' + (i.method || '不明') + ' / 使用米: ' + (i.rice || '不明') + ' / 精米歩合: ' + (i.polish || '不明') + '\n' +
    'さけのわのフレーバーチャート(みんなの評価を10段階の位置にしたもの): ' + chart + '\n' +
    '根拠が弱い項目は5に寄せてください。\n' +
    '{"scores":{"aroma":香り強さ,"attack":アタック,"sweet":甘味,"acid":酸味,"bitter":苦味,"umami":うま味,"body":ボディ,"finish":余韻},"aroma":["香り候補を最大5個。次の語彙から選ぶ"],"ssi4":"薫酒|爽酒|醇酒|熟酒のいずれか"}\n' +
    '語彙: ' + AROMA_VOCAB.join('、');
  var r = claude_(CFG.MODEL_EST, 'あなたは唎酒師の資格を持つ日本酒の専門家です。JSONのみを返します。', [{ type: 'text', text: text }], 1500, 'estimate');
  var sc = {};
  Object.keys(SCORE).forEach(function (k) { var v = Math.round(Number((r.scores || {})[k])); sc[k] = isNaN(v) ? 5 : Math.max(1, Math.min(10, v)); });
  var aroma = (r.aroma || []).filter(function (x) { return AROMA_VOCAB.indexOf(x) >= 0; }).slice(0, 5);
  var ssi = ['薫酒', '爽酒', '醇酒', '熟酒'].indexOf(r.ssi4) >= 0 ? r.ssi4 : '';
  return { ok: true, scores: sc, aroma: aroma, ssi4: ssi, costTotalYen: monthTotal_() };
}

/* ---------- 料金ログ ---------- */
function ss_() { return SpreadsheetApp.openById(prop_('SHEET_ID')); }
function costSheet_(sheetId) {
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : ss_(), sh = ss.getSheetByName(CFG.COST_SHEET);
  if (!sh) { sh = ss.insertSheet(CFG.COST_SHEET); sh.appendRow(['日時', '種別', 'モデル', '入力トークン', '出力トークン', '円']); }
  return sh;
}
function logCost_(kind, model, usage) {
  var pr = PRICE[model] || [0, 0], inT = usage.input_tokens || 0, outT = usage.output_tokens || 0;
  var yen = (inT * pr[0] + outT * pr[1]) / 1e6 * Number(prop_('USDJPY') || 155);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { costSheet_().appendRow([Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'), kind, model, inT, outT, yen]); } finally { lock.releaseLock(); }
}
function monthTotal_(sheetId) {
  var sh = costSheet_(sheetId), n = sh.getLastRow();
  if (n < 2) return 0;
  var ym = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM'), total = 0;
  sh.getRange(2, 1, n - 1, 6).getValues().forEach(function (r) { if (String(r[0]).indexOf(ym) === 0) total += Number(r[5]) || 0; });
  return total;
}

/* ---------- 記録シート ---------- */
function logSheet_(sheetId) {
  var ss = sheetId ? SpreadsheetApp.openById(sheetId) : ss_(), sh = ss.getSheetByName(CFG.SHEET_NAME);
  if (!sh) throw new Error('シート「' + CFG.SHEET_NAME + '」がありません');
  return sh;
}
function headers_(sh) { return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String); }
function ensureCol_(sh, headers, name) {
  var i = headers.indexOf(name);
  if (i >= 0) return i;
  var col = headers.length + 1;
  if (col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), col - sh.getMaxColumns());
  sh.getRange(1, col).setValue(name);
  headers.push(name);
  return headers.length - 1;
}

function saveBlob_(b64, name, sheetId) {
  if (typeof Drive === 'undefined' || !Drive.Files) throw new Error('写真保存には Advanced Drive v3 の設定が必要です');
  sheetId = String(sheetId || prop_('SHEET_ID') || '');
  if (!/^[A-Za-z0-9_-]+$/.test(sheetId)) throw new Error('写真保存先の SHEET_ID を確認してください');
  var blob;
  try { blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name); }
  catch (err) { throw new Error('写真データを読み取れませんでした。写真を選び直してください'); }
  // actionSave_ holds the script lock throughout folder lookup and photo creation.
  var folderId = photoFolder_(sheetId), file;
  try {
    file = Drive.Files.create({ name: name, mimeType: 'image/jpeg', parents: [folderId] }, blob, { fields: 'id' });
    if (!file || !file.id) throw new Error('Missing file ID');
  } catch (err) {
    // A timeout may happen after Drive has accepted the upload. Do not retry it here.
    throw new Error('写真の保存結果を確認できませんでした。重複を避けるため、Drive の写真を確認してから保存し直してください');
  }
  return 'https://drive.google.com/file/d/' + file.id + '/view?usp=drivesdk';
}

function checkedPhotoFolder_(folder, sheetId) {
  var tags = folder && folder.appProperties || {};
  if (!folder || !folder.id || folder.trashed || folder.mimeType !== 'application/vnd.google-apps.folder' ||
      tags.sakeLog !== 'photos-v1' || tags.sheetId !== sheetId ||
      !folder.capabilities || folder.capabilities.canAddChildren !== true) {
    throw new Error('写真保存先のフォルダが無効です。フォルダと PHOTO_FOLDER_ID_ 設定を確認してください');
  }
  return folder;
}

function photoFolder_(sheetId) {
  var props = PropertiesService.getScriptProperties(), key = 'PHOTO_FOLDER_ID_' + sheetId;
  var id = props.getProperty(key), folder;
  var fields = 'id,mimeType,trashed,appProperties,capabilities(canAddChildren)';
  if (id) {
    try { folder = Drive.Files.get(id, { fields: fields }); }
    catch (err) { throw new Error('写真保存先を確認できません。削除や権限変更がないか、フォルダと PHOTO_FOLDER_ID_ 設定を確認してください'); }
    // Invalid/inaccessible stored IDs are not silently replaced with another folder.
    return checkedPhotoFolder_(folder, sheetId).id;
  }

  var found;
  try {
    found = Drive.Files.list({
      q: "trashed = false and mimeType = 'application/vnd.google-apps.folder' and " +
        "appProperties has { key = 'sakeLog' and value = 'photos-v1' } and " +
        "appProperties has { key = 'sheetId' and value = '" + sheetId + "' }",
      pageSize: 2, fields: 'files(' + fields + '),nextPageToken,incompleteSearch'
    });
  } catch (err) { throw new Error('写真保存先の検索に失敗しました。Drive v3 の設定とアクセス権を確認してください'); }
  var folders = found && found.files || [];
  if (!found || found.incompleteSearch || found.nextPageToken || folders.length > 1) {
    throw new Error('写真保存先を一意に確認できません。フォルダを確認してください');
  }
  if (folders.length) {
    folder = checkedPhotoFolder_(folders[0], sheetId);
  } else {
    var created;
    try {
      created = Drive.Files.create({
        name: CFG.PHOTO_FOLDER + '-' + sheetId.slice(-8), mimeType: 'application/vnd.google-apps.folder',
        appProperties: { sakeLog: 'photos-v1', sheetId: sheetId }
      });
      if (!created || !created.id) throw new Error('Missing folder ID');
    } catch (err) { throw new Error('写真フォルダの作成結果を確認できません。Drive を確認してください'); }
    try { folder = Drive.Files.get(created.id, { fields: fields }); }
    catch (err) { throw new Error('作成した写真フォルダを確認できません。Drive を確認してください'); }
    folder = checkedPhotoFolder_(folder, sheetId);
  }
  // Recover marked app-created folders if an earlier create succeeded but ID storage failed.
  try { props.setProperty(key, folder.id); }
  catch (err) { throw new Error('写真保存先IDの記録に失敗しました。写真はまだ保存していません'); }
  return folder.id;
}

function recordVersion_(headers, values) {
  var normalized = values.map(function (v) { return v instanceof Date ? v.getTime() : v; });
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify([headers, normalized]), Utilities.Charset.UTF_8)
    .map(function (v) { return ('0' + (v & 255).toString(16)).slice(-2); }).join('');
}

function actionSave_(b) {
  var rec = b.record || {}, photos = b.photos || {};
  var sourceSheetId = String(prop_('SHEET_ID') || '');
  if (rec.sourceSheetId && String(rec.sourceSheetId) !== sourceSheetId) throw new Error('接続先が変わりました。一覧から記録を選び直してください');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = logSheet_(sourceSheetId), headers = headers_(sh);
    var isNew = rec.row === undefined || rec.row === null || rec.row === '';
    var recordId = rec.recordId === undefined || rec.recordId === null || rec.recordId === '' ? Utilities.getUuid() : rec.recordId;
    var row;
    if (!isNew) {
      row = Number(rec.row);
      if (!isFinite(row) || Math.floor(row) !== row || row < 2 || row > sh.getLastRow()) throw new Error('対象の行が見つかりません');
      if (!rec.sourceSheetId || !rec.sourceVersion) throw new Error('一覧を開き直してから保存してください');
      var current = sh.getRange(row, 1, 1, headers.length).getValues()[0];
      if (rec.sourceVersion !== recordVersion_(headers, current)) throw new Error('記録が更新または移動されました。一覧を開き直してください');
      var idCol = headers.indexOf('記録ID'), currentId = idCol >= 0 ? String(current[idCol] == null ? '' : current[idCol]) : '';
      if (currentId && String(rec.recordId) !== currentId) throw new Error('対象の記録が変わりました。一覧を開き直してください');
    }
    var vals = {};
    Object.keys(KEYMAP).forEach(function (k) { if (rec[k] !== undefined && rec[k] !== null && ['recordId', 'updatedAt', 'fixedJson', 'estimatesJson', 'bottleUrl', 'labelUrl'].indexOf(k) < 0) vals[KEYMAP[k]] = rec[k]; });
    Object.keys(SCORE).forEach(function (k) { var v = (rec.scores || {})[k]; if (v !== undefined && v !== null && v !== '') vals[SCORE[k]] = Number(v); });
    vals['評価尺度'] = 10;
    vals['記録ID'] = recordId;
    vals['確定項目'] = JSON.stringify(rec.fixed || []);
    vals['推定値JSON'] = JSON.stringify(rec.estimates || {});
    vals['更新日時'] = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
    if (photos.bottle) vals['写真URL'] = saveBlob_(photos.bottle, 'bottle-' + stamp + '.jpg', sourceSheetId);
    if (photos.label) vals['ラベル写真URL'] = saveBlob_(photos.label, 'label-' + stamp + '.jpg', sourceSheetId);

    Object.keys(vals).forEach(function (n) { ensureCol_(sh, headers, n); });
    if (isNew) {
      row = sh.getLastRow() + 1;
    }
    // 変えた項目(送られてきた列)だけ書く。他の列は触らない。
    Object.keys(vals).forEach(function (n) {
      var v = vals[n];
      sh.getRange(row, headers.indexOf(n) + 1).setValue(v);
    });
    var savedVersion = recordVersion_(headers, sh.getRange(row, 1, 1, headers.length).getValues()[0]);
    return { ok: true, row: row, recordId: recordId, sourceSheetId: sourceSheetId, sourceVersion: savedVersion, costTotalYen: monthTotal_(sourceSheetId) };
  } finally { lock.releaseLock(); }
}

function actionList_() {
  var sourceSheetId = String(prop_('SHEET_ID') || ''), sh = logSheet_(sourceSheetId), n = sh.getLastRow();
  if (n < 2) return { ok: true, sourceSheetId: sourceSheetId, records: [] };
  var headers = headers_(sh), data = sh.getRange(2, 1, n - 1, headers.length).getValues(), rev = {}, scRev = {};
  Object.keys(KEYMAP).forEach(function (k) { rev[KEYMAP[k]] = k; });
  Object.keys(SCORE).forEach(function (k) { scRev[SCORE[k]] = k; });
  var records = data.map(function (r, idx) {
    var o = { row: idx + 2, scores: {}, sourceSheetId: sourceSheetId, sourceVersion: recordVersion_(headers, r) };
    headers.forEach(function (h, c) {
      var v = r[c];
      if (v === '' || v === null) return;
      if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
      if (scRev[h]) o.scores[scRev[h]] = v;
      else if (rev[h]) o[rev[h]] = v;
    });
    if (!String(o.brand == null ? '' : o.brand).trim()) return null;
    if (o.recordId === undefined || o.recordId === null || o.recordId === '') o.recordId = 'r' + o.row;
    try { o.fixed = o.fixedJson ? JSON.parse(o.fixedJson) : []; } catch (e) { o.fixed = []; }
    try { o.estimates = o.estimatesJson ? JSON.parse(o.estimatesJson) : {}; } catch (e) { o.estimates = {}; }
    delete o.fixedJson; delete o.estimatesJson;
    return o;
  }).filter(Boolean);
  return { ok: true, sourceSheetId: sourceSheetId, records: records };
}
