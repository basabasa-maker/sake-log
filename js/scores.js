(function () {
  var OLD = { 1: 2, 2: 5, 3: 8 };
  var FINISH = { '短い': 3, 'やや短い': 4, '中程度': 5, 'やや長い': 6, '長い': 9 };
  function number(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
    var n = Number(value); return Number.isFinite(n) ? n : null;
  }
  function ten(value) { var n = number(value); return n !== null && Math.floor(n) === n && n >= 1 && n <= 10 ? n : null; }
  function describe(raw, scale, meta, axis) {
    if (raw === undefined || raw === null || raw === '') return { kind: 'missing', number: null, raw: raw, label: '未記録' };
    var n = number(raw), axisScale = meta && meta.scale === 10 ? 10 : scale;
    if (Number(axisScale) === 10 && ten(raw) !== null) return { kind: 'ten', number: n, raw: raw, label: meta && meta.origin === 'ai' ? 'AI推定（10段階）' : meta && meta.origin === 'user' ? '入力値（10段階）' : '記録値（10段階）' };
    if ((axisScale === undefined || axisScale === null || axisScale === '' || Number(axisScale) === 3) && OLD[n] !== undefined) {
      return { kind: 'legacy-number', number: OLD[n], raw: raw, label: '旧1〜3の換算表示（原値 ' + raw + '）' };
    }
    if (axis === 'finish' && (axisScale === undefined || axisScale === null || axisScale === '' || Number(axisScale) === 3) && typeof raw === 'string' && Object.prototype.hasOwnProperty.call(FINISH, raw)) {
      return { kind: 'legacy-finish', number: FINISH[raw], raw: raw, label: '旧余韻の換算表示（原文「' + raw + '」）' };
    }
    // Text, zero, unknown scales and out-of-range numbers remain original data.
    var reason = n !== null ? (Number(axisScale) === 10 ? '元の数値・1〜10の範囲外' : '元の数値・尺度未確認') : typeof raw === 'string' && !raw.trim() ? '原記録は空白文字・未換算' : '原記録・文字評価の換算表なし';
    return { kind: 'original', number: null, raw: raw, label: reason };
  }
  function cleanAI(scores) {
    var result = {};
    ['aroma','attack','sweet','acid','bitter','umami','body','finish'].forEach(function (k) {
      var n = ten((scores || {})[k]); if (n !== null) result[k] = n;
    });
    return result;
  }
  window.Scores = { describe: describe, ten: ten, cleanAI: cleanAI };
})();
