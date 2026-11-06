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
    return out_({ ok: false, error: String(err && err.message || err), code: err && err.code || (b && b.action === 'save' ? 'SAVE_REJECTED' : '') });
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
  var i = b.info || {};
  var text = '次の日本酒について、利き酒師の評価項目を1〜10の整数で推定し、JSONだけを返してください。5が一般的な中間です。\n' +
    '銘柄: ' + (i.brand || '不明') + ' / 蔵元: ' + (i.brewery || '不明') + ' / 特定名称: ' + (i.grade || '不明') + ' / 製法: ' + (i.method || '不明') + ' / 使用米: ' + (i.rice || '不明') + ' / 精米歩合: ' + (i.polish || '不明') + '\n' +
    '根拠が弱い項目は5に寄せてください。\n' +
    '{"scores":{"aroma":香り強さ,"attack":アタック,"sweet":甘味,"acid":酸味,"bitter":苦味,"umami":うま味,"body":ボディ,"finish":余韻},"aroma":["香り候補を最大5個。次の語彙から選ぶ"],"ssi4":"薫酒|爽酒|醇酒|熟酒のいずれか"}\n' +
    '語彙: ' + AROMA_VOCAB.join('、');
  var r = claude_(CFG.MODEL_EST, 'あなたは唎酒師の資格を持つ日本酒の専門家です。JSONのみを返します。', [{ type: 'text', text: text }], 1500, 'estimate');
  var sc = {};
  Object.keys(SCORE).forEach(function (k) { var v = tenScore_((r.scores || {})[k]); if (v !== null) sc[k] = v; });
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
  sh.getRange(2, 1, n - 1, 6).getValues().forEach(function (r) {
    var d = r[0] instanceof Date ? Utilities.formatDate(r[0], 'Asia/Tokyo', 'yyyy-MM') : String(r[0]);
    if (d.indexOf(ym) === 0) total += Number(r[5]) || 0;
  });
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
    throw saveError_('PHOTO_UNKNOWN', '写真の保存結果を確認できません。再送せず、Driveと保存待機情報を管理者に確認してください');
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

function saveError_(code, message) { var e = new Error(message); e.code = code; return e; }
function digest_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(value), Utilities.Charset.UTF_8)
    .map(function (v) { return ('0' + (v & 255).toString(16)).slice(-2); }).join('');
}
function sorted_(v) {
  if (Array.isArray(v)) return v.map(sorted_);
  if (v && typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { o[k] = sorted_(v[k]); }); return o; }
  return v;
}
function recordVersion_(headers, values, formulas) {
  var normalized = headers.map(function (h, i) {
    var v = values[i] == null ? '' : values[i];
    if (formulas && formulas[i]) return { formula: formulas[i] };
    if (h === '保存操作JSON' && v) { try { var receipt = JSON.parse(v); delete receipt.resultVersion; return sorted_(receipt); } catch (e) {} }
    return v instanceof Date ? v.getTime() : v;
  });
  return digest_([headers, normalized]);
}
function sheetApi_(sheetId, suffix, method, payload) {
  var response = UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(sheetId) + suffix, {
    method: method || 'get', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: payload ? JSON.stringify(payload) : undefined
  });
  var code = response.getResponseCode();
  // A definite 4xx rejection is not applied. Timeouts/5xx remain uncertain.
  if (code < 200 || code >= 300) throw saveError_(code >= 400 && code < 500 && code !== 408 && code !== 429 ? 'SAVE_REJECTED' : 'SAVE_UNKNOWN', 'Sheets APIで保存を確認できません (' + code + ')');
  return JSON.parse(response.getContentText());
}
function colName_(n) { var s = ''; for (; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; }
function entered_(v) {
  if (v === '' || v === null || v === undefined) return {};
  if (typeof v === 'number') { if (!isFinite(v)) throw new Error('保存値に無効な数値があります'); return { numberValue: v }; }
  if (typeof v === 'boolean') return { boolValue: v };
  return { stringValue: String(v) }; // Literal '=...' remains text, never a formula.
}
function freshRow_(sheetId, sh, width, row) {
  var title = "'" + sh.getName().replace(/'/g, "''") + "'!A";
  var j = sheetApi_(sheetId, '?includeGridData=true&ranges=' + encodeURIComponent(title + '1:' + colName_(width) + '1') + '&ranges=' + encodeURIComponent(title + row + ':' + colName_(width) + row) + '&fields=sheets(properties(sheetId),data(startRow,startColumn,rowData(values(userEnteredValue))))');
  var result = {};
  (j.sheets || []).filter(function (x) { return x.properties.sheetId === sh.getSheetId(); }).forEach(function (x) {
    (x.data || []).forEach(function (block) { (block.rowData || []).forEach(function (r, dy) { result[(block.startRow || 0) + dy + 1] = (r.values || []).map(function (c) { return c.userEnteredValue || {}; }); }); });
  });
  return { headers: result[1] || [], row: result[row] || [] };
}
function verifySave_(sheetId, sh, journal) {
  var fresh = freshRow_(sheetId, sh, journal.width, journal.row), receipt;
  try { receipt = JSON.parse((fresh.row[journal.receiptCol] || {}).stringValue || ''); } catch (e) { return null; }
  if (receipt.id !== journal.id || receipt.digest !== journal.digest || receipt.resultVersion !== journal.resultVersion) return null;
  var actual = journal.columns.map(function (col) { return [col, fresh.headers[col] || {}, fresh.row[col] || {}]; });
  if (digest_(actual) !== journal.changesDigest) return null;
  var values = fresh.row;
  function text(name) { var col = fresh.headers.findIndex(function (c) { return c.stringValue === name; }); return col < 0 ? '' : (values[col] || {}).stringValue || ''; }
  return { ok: true, row: journal.row, recordId: journal.recordId, sourceSheetId: sheetId, sourceVersion: journal.resultVersion, bottleUrl: text('写真URL'), labelUrl: text('ラベル写真URL') };
}
function finishSave_(props, pendingKey, doneKey, journal, result) {
  // Persist the acknowledgement before releasing the barrier. No record/photo/token values.
  props.setProperty(doneKey, JSON.stringify(journal));
  props.deleteProperty(pendingKey);
  return result;
}
function saveKeys_(sheetId, id) { var prefix = 'SAKE_SAVE_V1_' + digest_(sheetId).slice(0, 20) + '_'; return { pending: prefix + 'PENDING', done: prefix + 'DONE_' + digest_(id) }; }
function reconcileSave_(props, keys, journal, sheetId, sh) {
  var result;
  try { result = journal.phase === 'batch' ? verifySave_(sheetId, sh, journal) : null; } catch (e) { result = null; }
  if (!result) throw saveError_('SAVE_UNKNOWN', '前の保存結果が未確定です。再送は停止しています。管理者が保存操作JSONと待機情報を確認してください');
  try { return finishSave_(props, keys.pending, saveKeys_(sheetId, journal.id).done, journal, result); }
  catch (e) { throw saveError_('SAVE_UNKNOWN', '記録は反映済みの可能性があります。確認情報の記録が完了するまで再送しません'); }
}

function pruneSaveReceipts_(props) {
  var now = Date.now(), count = 0;
  props.getKeys().filter(function (k) { return /^SAKE_SAVE_V1_[a-f0-9]{20}_DONE_[a-f0-9]{64}$/.test(k); }).forEach(function (k) {
    var value; try { value = JSON.parse(props.getProperty(k)); } catch (e) { throw new Error('保存確認情報が壊れています。管理者に確認してください'); }
    if (!value || !isFinite(value.createdAt)) throw new Error('保存確認情報を確認できません');
    if (now - value.createdAt > 7 * 86400000) props.deleteProperty(k); else count++;
  });
  if (count >= 200) throw new Error('保存確認情報の安全上限（7日間200件）です。管理者に確認してください');
}

function actionSave_(b) {
  var rec = b.record || {}, photos = b.photos || {};
  var sourceSheetId = String(prop_('SHEET_ID') || '');
  if (rec.sourceSheetId && String(rec.sourceSheetId) !== sourceSheetId) throw new Error('接続先が変わりました。一覧から記録を選び直してください');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var sh = logSheet_(sourceSheetId), headers = headers_(sh);
    var op = String(rec.saveOperationId || ''), stampMs = parseInt(op.split('-')[1], 36);
    if (!/^op-[a-z0-9]+-[A-Za-z0-9_-]{20,100}$/.test(op) || !isFinite(stampMs) || Math.abs(Date.now() - stampMs) > 7 * 86400000) throw new Error('更新版アプリで保存してください（保存操作IDの期限は7日です）');
    var payloadDigest = digest_(sorted_({ record: rec, photos: photos })), keys = saveKeys_(sourceSheetId, op), props = PropertiesService.getScriptProperties();
    var pending = props.getProperty(keys.pending), done = props.getProperty(keys.done);
    if (pending) {
      var previous = JSON.parse(pending), recovered = reconcileSave_(props, keys, previous, sourceSheetId, sh);
      if (previous.id === op) { if (previous.digest !== payloadDigest) throw new Error('同じ保存操作の内容が変わっています'); return recovered; }
      throw saveError_('SAVE_REJECTED', '前の保存は確認できました。今回の別操作は実行していません。一覧を同期して重複がないか確認してください');
    }
    if (done) {
      var applied = JSON.parse(done);
      if (applied.digest !== payloadDigest) throw new Error('同じ保存操作の内容が変わっています');
      var replay = verifySave_(sourceSheetId, sh, applied);
      if (!replay) throw new Error('保存後に記録が変わりました。一覧から開き直してください');
      return replay;
    }
    pruneSaveReceipts_(props);
    var isNew = rec.row === undefined || rec.row === null || rec.row === '';
    var recordId = rec.recordId === undefined || rec.recordId === null || rec.recordId === '' ? Utilities.getUuid() : rec.recordId;
    var row;
    if (!isNew) {
      row = Number(rec.row);
      if (!isFinite(row) || Math.floor(row) !== row || row < 2 || row > sh.getLastRow()) throw new Error('対象の行が見つかりません');
      if (!rec.sourceSheetId || !rec.sourceVersion) throw new Error('一覧を開き直してから保存してください');
      var current = sh.getRange(row, 1, 1, headers.length).getValues()[0], formulas = sh.getRange(row, 1, 1, headers.length).getFormulas()[0];
      if (rec.sourceVersion !== recordVersion_(headers, current, formulas)) throw new Error('記録が更新または移動されました。一覧を開き直してください');
      var idCol = headers.indexOf('記録ID'), currentId = idCol >= 0 ? String(current[idCol] == null ? '' : current[idCol]) : '';
      if (currentId && String(rec.recordId) !== currentId) throw new Error('対象の記録が変わりました。一覧を開き直してください');
    }
    // Validate the score protocol before photos, columns, or cells can be changed.
    if (!isNew && rec.scoreMode !== 'preserve-v1') throw new Error('評価を保持する更新版アプリで一覧を開き直してから保存してください');
    var scoreEdits = validatedScoreEdits_(rec, isNew);
    var scoreMeta = {};
    var metaCol = headers.indexOf('評価尺度JSON');
    if (!isNew && Object.keys(scoreEdits).length && metaCol >= 0 && current[metaCol]) {
      try { scoreMeta = JSON.parse(current[metaCol]); } catch (e) { throw new Error('評価尺度の補助情報を確認できません。記録を変更せず管理者に確認してください'); }
      if (!scoreMeta || typeof scoreMeta !== 'object' || Array.isArray(scoreMeta)) throw new Error('評価尺度の補助情報が無効です');
    }
    var vals = {};
    Object.keys(KEYMAP).forEach(function (k) { if (rec[k] !== undefined && rec[k] !== null && ['recordId', 'updatedAt', 'fixedJson', 'estimatesJson', 'bottleUrl', 'labelUrl', 'scale'].indexOf(k) < 0) vals[KEYMAP[k]] = rec[k]; });
    Object.keys(scoreEdits).forEach(function (k) {
      var edit = scoreEdits[k], col = headers.indexOf(SCORE[k]);
      var previous = !isNew && col >= 0 ? current[col] : null, previousMeta = scoreMeta[k];
      var scaleCol = headers.indexOf('評価尺度');
      scoreMeta[k] = { scale: 10, origin: edit.origin };
      if (!isNew) scoreMeta[k].previous = { value: previous, scale: previousMeta && previousMeta.scale === 10 ? 10 : scaleCol >= 0 ? current[scaleCol] : null };
      if (!isNew) scoreMeta[k].original = previousMeta && previousMeta.original || scoreMeta[k].previous;
      vals[SCORE[k]] = edit.value;
    });
    if (Object.keys(scoreEdits).length) vals['評価尺度JSON'] = JSON.stringify(scoreMeta);
    // Existing row-wide scale stays unchanged; explicit edits carry per-axis scale.
    if (isNew) vals['評価尺度'] = 10;
    vals['記録ID'] = recordId;
    if (rec.fixed !== undefined) vals['確定項目'] = JSON.stringify(rec.fixed || []);
    if (rec.estimates !== undefined) vals['推定値JSON'] = JSON.stringify(rec.estimates || {});
    vals['更新日時'] = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    // Formula targets are rejected, rather than overwritten with displayed values.
    var names = Object.keys(vals).concat(photos.bottle ? ['写真URL'] : [], photos.label ? ['ラベル写真URL'] : [], ['保存操作JSON']);
    names.forEach(function (name) { var col = headers.indexOf(name); if (!isNew && col >= 0 && formulas[col]) throw new Error('数式のある項目はアプリから変更できません: ' + name); });
    // Fail before photo creation if this Cloud project cannot use Sheets API.
    sheetApi_(sourceSheetId, '?fields=sheets.properties');
    if (isNew) row = sh.getLastRow() + 1;
    var journal = { id: op, digest: payloadDigest, row: row, recordId: recordId, phase: 'preparing', createdAt: Date.now() };
    props.setProperty(keys.pending, JSON.stringify(journal));
    var dispatched = false, uploaded = false;
    try {
      var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
      if (photos.bottle) { vals['写真URL'] = saveBlob_(photos.bottle, 'bottle-' + stamp + '.jpg', sourceSheetId); uploaded = true; }
      if (photos.label) { vals['ラベル写真URL'] = saveBlob_(photos.label, 'label-' + stamp + '.jpg', sourceSheetId); uploaded = true; }
      var nextHeaders = headers.slice(), requests = [], numericSheetId = sh.getSheetId();
      Object.keys(vals).concat(['保存操作JSON']).forEach(function (name) { if (nextHeaders.indexOf(name) < 0) nextHeaders.push(name); });
      if (nextHeaders.length > sh.getMaxColumns()) requests.push({ appendDimension: { sheetId: numericSheetId, dimension: 'COLUMNS', length: nextHeaders.length - sh.getMaxColumns() } });
      if (row > sh.getMaxRows()) requests.push({ appendDimension: { sheetId: numericSheetId, dimension: 'ROWS', length: row - sh.getMaxRows() } });
      function update(r, c, v) { requests.push({ updateCells: { start: { sheetId: numericSheetId, rowIndex: r - 1, columnIndex: c }, rows: [{ values: [{ userEnteredValue: entered_(v) }] }], fields: 'userEnteredValue' } }); }
      nextHeaders.forEach(function (name, col) { if (col >= headers.length) update(1, col, name); });
      var nextValues = nextHeaders.map(function (name, col) { return !isNew && col < current.length ? current[col] : ''; });
      Object.keys(vals).forEach(function (name) { var col = nextHeaders.indexOf(name); nextValues[col] = vals[name]; update(row, col, vals[name]); });
      var receiptCol = nextHeaders.indexOf('保存操作JSON'), receipt = { id: op, digest: payloadDigest };
      nextValues[receiptCol] = JSON.stringify(receipt);
      var resultVersion = recordVersion_(nextHeaders, nextValues, formulas);
      receipt.resultVersion = resultVersion; nextValues[receiptCol] = JSON.stringify(receipt); update(row, receiptCol, nextValues[receiptCol]);
      journal.phase = 'batch'; journal.width = nextHeaders.length; journal.receiptCol = receiptCol; journal.resultVersion = resultVersion;
      journal.columns = Object.keys(vals).map(function (name) { return nextHeaders.indexOf(name); });
      journal.changesDigest = digest_(journal.columns.map(function (col) { return [col, entered_(nextHeaders[col]), entered_(nextValues[col])]; }));
      props.setProperty(keys.pending, JSON.stringify(journal));
      dispatched = true;
      try { sheetApi_(sourceSheetId, ':batchUpdate', 'post', { requests: requests }); }
      catch (err) { if (err.code === 'SAVE_REJECTED' && !uploaded) { props.deleteProperty(keys.pending); throw err; } }
      return reconcileSave_(props, keys, journal, sourceSheetId, sh);
    } catch (err) {
      if (!dispatched && !uploaded && err.code !== 'PHOTO_UNKNOWN') { props.deleteProperty(keys.pending); throw err; }
      if (err.code === 'SAVE_REJECTED' && !uploaded) throw err;
      throw saveError_('SAVE_UNKNOWN', '保存結果を確定できません。重複を避けて再送を止めています。' + (err.code === 'PHOTO_UNKNOWN' ? ' 写真も管理者の確認が必要です。' : ''));
    }
  } finally { lock.releaseLock(); }
}

function actionList_() {
  var sourceSheetId = String(prop_('SHEET_ID') || ''), sh = logSheet_(sourceSheetId), n = sh.getLastRow();
  if (n < 2) return { ok: true, sourceSheetId: sourceSheetId, records: [] };
  var headers = headers_(sh), range = sh.getRange(2, 1, n - 1, headers.length), data = range.getValues(), formulaRows = range.getFormulas(), rev = {}, scRev = {};
  Object.keys(KEYMAP).forEach(function (k) { rev[KEYMAP[k]] = k; });
  Object.keys(SCORE).forEach(function (k) { scRev[SCORE[k]] = k; });
  var records = data.map(function (r, idx) {
    var o = { row: idx + 2, scores: {}, scoreFormat: 'preserve-v1', sourceSheetId: sourceSheetId, sourceVersion: recordVersion_(headers, r, formulaRows[idx]) };
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
    var metaCol = headers.indexOf('評価尺度JSON');
    try { o.scoreMeta = metaCol >= 0 && r[metaCol] ? JSON.parse(r[metaCol]) : {}; } catch (e) { o.scoreMeta = {}; }
    if (!o.scoreMeta || typeof o.scoreMeta !== 'object' || Array.isArray(o.scoreMeta)) o.scoreMeta = {};
    delete o.fixedJson; delete o.estimatesJson;
    return o;
  }).filter(Boolean);
  return { ok: true, sourceSheetId: sourceSheetId, records: records };
}


function tenScore_(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  var n = Number(value);
  return isFinite(n) && Math.floor(n) === n && n >= 1 && n <= 10 ? n : null;
}
function validatedScoreEdits_(rec, isNew) {
  var input = rec.scoreMode === 'preserve-v1' ? (rec.scoreEdits || {}) : (rec.scores || {}), result = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('評価の変更内容が無効です');
  Object.keys(input).forEach(function (k) {
    if (!Object.prototype.hasOwnProperty.call(SCORE, k)) throw new Error('不明な評価項目です');
    var edit = rec.scoreMode === 'preserve-v1' ? input[k] : { value: input[k], origin: 'unknown' };
    if (!edit || typeof edit !== 'object') throw new Error('評価の変更内容が無効です');
    var value = tenScore_(edit.value);
    if (value === null || ['user','ai','unknown'].indexOf(edit.origin) < 0) throw new Error('変更した評価は1〜10の整数で指定してください');
    result[k] = { value: value, origin: edit.origin };
  });
  return result;
}
